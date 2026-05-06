import { useState, useEffect, useRef, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { PhoneOff, Mic, MicOff, Video, VideoOff } from 'lucide-react';
import { Button } from '@/components/ui/button';

interface VideoCallProps {
  conversationId: string;
  partnerId: string;
  partnerName: string;
  isVideo: boolean;
  isCaller: boolean;
  callId?: string | null;
  initialStream?: MediaStream | null;
  onEnd: () => void;
}

type CallSignalRow = {
  conversation_id: string;
  sender_id: string;
  receiver_id: string;
  signal_type: string;
  signal_data: unknown;
  call_id?: string;
  created_at?: string;
};

const isSessionDescription = (data: unknown): data is RTCSessionDescriptionInit => {
  if (!data || typeof data !== 'object') return false;
  const type = (data as { type?: unknown }).type;
  return type === 'offer' || type === 'answer' || type === 'pranswer' || type === 'rollback';
};

const getSignalCandidate = (data: unknown): RTCIceCandidateInit | null => {
  if (!data || typeof data !== 'object') return null;
  const candidate = (data as { candidate?: unknown }).candidate;
  return candidate && typeof candidate === 'object' ? candidate as RTCIceCandidateInit : null;
};

const ICE_SERVERS: RTCConfiguration = {
  iceServers: [
    { urls: 'stun:stun.relay.metered.ca:80' },
    { urls: 'stun:openrelay.metered.ca:80' },
    { urls: 'stun:stun.cloudflare.com:3478' },
    { urls: 'stun:stun.nextcloud.com:443' },
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
    {
      urls: 'turn:openrelay.metered.ca:80',
      username: 'openrelayproject',
      credential: 'openrelayproject',
    },
    {
      urls: 'turn:openrelay.metered.ca:443',
      username: 'openrelayproject',
      credential: 'openrelayproject',
    },
    {
      urls: 'turn:openrelay.metered.ca:443?transport=tcp',
      username: 'openrelayproject',
      credential: 'openrelayproject',
    },
    {
      urls: 'turns:openrelay.metered.ca:443',
      username: 'openrelayproject',
      credential: 'openrelayproject',
    },
  ],
  iceCandidatePoolSize: 10,
  bundlePolicy: 'max-bundle',
  rtcpMuxPolicy: 'require',
};

const VideoCall = ({ conversationId, partnerId, partnerName, isVideo, isCaller, callId, initialStream, onEnd }: VideoCallProps) => {
  const { user } = useAuth();
  const [isMuted, setIsMuted] = useState(false);
  const [isVideoOff, setIsVideoOff] = useState(!isVideo);
  const [status, setStatus] = useState<'connecting' | 'connected' | 'ended'>('connecting');
  const [callDuration, setCallDuration] = useState(0);

  const localVideoRef = useRef<HTMLVideoElement>(null);
  const remoteVideoRef = useRef<HTMLVideoElement>(null);
  const pcRef = useRef<RTCPeerConnection | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const endedRef = useRef(false);
  const pendingCandidatesRef = useRef<RTCIceCandidateInit[]>([]);
  const remoteDescSetRef = useRef(false);
  const relayRestartedRef = useRef(false);
  const callIdRef = useRef(callId || crypto.randomUUID());

  const sendSignal = useCallback(async (type: string, data: object) => {
    if (!user) return;
    await supabase.from('call_signals').insert({
      conversation_id: conversationId,
      sender_id: user.id,
      receiver_id: partnerId,
      signal_type: type,
      call_id: callIdRef.current,
      signal_data: data,
    } as never);
  }, [user, conversationId, partnerId]);

  const cleanup = useCallback(() => {
    localStreamRef.current?.getTracks().forEach(t => t.stop());
    pcRef.current?.close();
    pcRef.current = null;
    localStreamRef.current = null;
    remoteDescSetRef.current = false;
    pendingCandidatesRef.current = [];
  }, []);

  const hangUp = useCallback(() => {
    if (endedRef.current) return;
    endedRef.current = true;
    sendSignal('hang-up', {});
    cleanup();
    setStatus('ended');
    onEnd();
  }, [sendSignal, cleanup, onEnd]);

  const addIceCandidate = useCallback(async (candidate: RTCIceCandidateInit) => {
    const pc = pcRef.current;
    if (!pc) return;
    if (remoteDescSetRef.current) {
      try {
        await pc.addIceCandidate(new RTCIceCandidate(candidate));
      } catch (e) { console.warn('ICE candidate error:', e); }
    } else {
      pendingCandidatesRef.current.push(candidate);
    }
  }, []);

  const flushCandidates = useCallback(async () => {
    const pc = pcRef.current;
    if (!pc) return;
    for (const c of pendingCandidatesRef.current) {
      try { await pc.addIceCandidate(new RTCIceCandidate(c)); } catch { /* ignore */ }
    }
    pendingCandidatesRef.current = [];
  }, []);

  const fetchMissedIceCandidates = useCallback(async () => {
    if (!user) return;
    const { data } = await supabase
      .from('call_signals')
      .select('*')
      .eq('conversation_id', conversationId)
      .eq('sender_id', partnerId)
      .eq('receiver_id', user.id)
      .eq('signal_type', 'ice-candidate')
      .eq('call_id', callIdRef.current)
      .order('created_at', { ascending: true });

    for (const signal of (data as unknown as CallSignalRow[] | null) || []) {
      const candidate = getSignalCandidate(signal.signal_data);
      if (candidate) await addIceCandidate(candidate);
    }
  }, [user, conversationId, partnerId, addIceCandidate]);

  const setupPeerConnection = useCallback(async () => {
    if (!user) return null;

    let stream: MediaStream;
    try {
      stream = initialStream || await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
        video: isVideo,
      });
    } catch (error) {
      if (!isVideo) throw error;
      stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
        video: false,
      });
      setIsVideoOff(true);
    }
    localStreamRef.current = stream;
    if (localVideoRef.current) localVideoRef.current.srcObject = stream;

    const pc = new RTCPeerConnection(ICE_SERVERS);
    pcRef.current = pc;

    stream.getTracks().forEach(track => pc.addTrack(track, stream));

    pc.onicecandidate = (e) => {
      if (e.candidate) {
        sendSignal('ice-candidate', { candidate: e.candidate.toJSON() });
      }
    };

    pc.ontrack = (e) => {
      if (remoteVideoRef.current && e.streams[0]) {
        remoteVideoRef.current.srcObject = e.streams[0];
        setStatus('connected');
      }
    };

    pc.oniceconnectionstatechange = () => {
      console.log('ICE state:', pc.iceConnectionState);
      if (pc.iceConnectionState === 'failed') {
        // Try ICE restart
        pc.restartIce();
        if (isCaller && pc.signalingState === 'stable') {
          pc.createOffer({ iceRestart: true }).then(async (offer) => {
            await pc.setLocalDescription(offer);
            await sendSignal('offer', { sdp: offer.sdp, type: offer.type, isVideo });
          }).catch(() => undefined);
        }
      }
      if (pc.iceConnectionState === 'disconnected') {
        setTimeout(() => {
          if (pcRef.current?.iceConnectionState === 'disconnected' && !relayRestartedRef.current) {
            relayRestartedRef.current = true;
            pc.restartIce();
            if (isCaller && pc.signalingState === 'stable') {
              pc.createOffer({ iceRestart: true }).then(async (offer) => {
                await pc.setLocalDescription(offer);
                await sendSignal('offer', { sdp: offer.sdp, type: offer.type, isVideo, iceRestart: true });
              }).catch(() => undefined);
            }
          }
        }, 2500);
      }
    };

    pc.onconnectionstatechange = () => {
      console.log('Connection state:', pc.connectionState);
      if (pc.connectionState === 'connected') {
        setStatus('connected');
      }
    };

    return pc;
  }, [user, initialStream, isVideo, sendSignal, isCaller]);

  const startAsCaller = useCallback(async () => {
    try {
      if (!user) return;
      // Clean old signals
      await supabase
        .from('call_signals')
        .delete()
        .eq('conversation_id', conversationId)
        .or(`sender_id.eq.${user.id},receiver_id.eq.${user.id}`);

      const pc = await setupPeerConnection();
      if (!pc) return;
      const offer = await pc.createOffer({
        offerToReceiveAudio: true,
        offerToReceiveVideo: isVideo,
      });
      await pc.setLocalDescription(offer);
      await sendSignal('offer', { sdp: offer.sdp, type: offer.type, isVideo });

      for (let i = 0; i < 60 && !remoteDescSetRef.current && !endedRef.current; i++) {
        const { data: answers } = await supabase
          .from('call_signals')
          .select('*')
          .eq('conversation_id', conversationId)
          .eq('receiver_id', user.id)
          .eq('signal_type', 'answer')
          .eq('call_id', callIdRef.current)
          .order('created_at', { ascending: false })
          .limit(1);

        const answer = (answers as unknown as CallSignalRow[] | null)?.[0];
        if (answer && isSessionDescription(answer.signal_data) && pc.signalingState === 'have-local-offer') {
          await pc.setRemoteDescription(new RTCSessionDescription(answer.signal_data));
          remoteDescSetRef.current = true;
          await flushCandidates();
          await fetchMissedIceCandidates();
          break;
        }
        await new Promise(r => setTimeout(r, 500));
      }
    } catch (err) {
      console.error('Failed to start call:', err);
      onEnd();
    }
  }, [setupPeerConnection, sendSignal, onEnd, user, conversationId, isVideo, flushCandidates, fetchMissedIceCandidates]);

  const startAsCallee = useCallback(async () => {
    try {
      const pc = await setupPeerConnection();
      if (!pc || !user) return;

      // Poll for offer with retry
      let offer: CallSignalRow | null = null;
      for (let i = 0; i < 10; i++) {
        const { data: signals } = await supabase
          .from('call_signals')
          .select('*')
          .eq('conversation_id', conversationId)
          .eq('receiver_id', user.id)
          .eq('signal_type', 'offer')
          .eq('call_id', callIdRef.current)
          .order('created_at', { ascending: false })
          .limit(1);

        if (signals && signals.length > 0) {
          offer = signals[0];
          break;
        }
        await new Promise(r => setTimeout(r, 500));
      }

      if (!offer) {
        console.error('No offer found');
        onEnd();
        return;
      }

      if (!isSessionDescription(offer.signal_data)) {
        onEnd();
        return;
      }
      await pc.setRemoteDescription(new RTCSessionDescription(offer.signal_data));
      remoteDescSetRef.current = true;
      await flushCandidates();

      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      await sendSignal('answer', { sdp: answer.sdp, type: answer.type });

      await fetchMissedIceCandidates();
    } catch (err) {
      console.error('Failed to setup call:', err);
      onEnd();
    }
  }, [setupPeerConnection, onEnd, user, conversationId, sendSignal, flushCandidates, fetchMissedIceCandidates]);

  // Listen for signals via realtime
  useEffect(() => {
    if (!user) return;

    const channel = supabase
      .channel(`call-${conversationId}-${user.id}`)
      .on('postgres_changes', {
        event: 'INSERT',
        schema: 'public',
        table: 'call_signals',
        filter: `receiver_id=eq.${user.id}`,
      }, async (payload) => {
        const signal = payload.new as CallSignalRow;
        if (signal.conversation_id !== conversationId) return;
        if (signal.call_id && signal.call_id !== callIdRef.current) return;
        const pc = pcRef.current;
        if (!pc && signal.signal_type !== 'hang-up') return;

        try {
          if (signal.signal_type === 'answer' && pc && isSessionDescription(signal.signal_data)) {
            if (pc.signalingState === 'have-local-offer') {
              await pc.setRemoteDescription(new RTCSessionDescription(signal.signal_data));
              remoteDescSetRef.current = true;
              await flushCandidates();
            }
          } else if (signal.signal_type === 'ice-candidate') {
            const candidate = getSignalCandidate(signal.signal_data);
            if (candidate) await addIceCandidate(candidate);
          } else if (signal.signal_type === 'hang-up') {
            if (!endedRef.current) {
              endedRef.current = true;
              cleanup();
              setStatus('ended');
              onEnd();
            }
          }
        } catch (err) {
          console.error('Signal handling error:', err);
        }
      })
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [user, conversationId, cleanup, onEnd, addIceCandidate, flushCandidates]);

  // Start call
  useEffect(() => {
    if (isCaller) {
      startAsCaller();
    } else {
      startAsCallee();
    }
    return cleanup;
  }, []);

  // Timer
  useEffect(() => {
    if (status !== 'connected') return;
    const interval = setInterval(() => setCallDuration(d => d + 1), 1000);
    return () => clearInterval(interval);
  }, [status]);

  // Timeout - auto hang up after 60s if not connected
  useEffect(() => {
    if (status !== 'connecting') return;
    const timeout = setTimeout(() => {
      if (status === 'connecting') {
        hangUp();
      }
    }, 60000);
    return () => clearTimeout(timeout);
  }, [status]);

  const formatDuration = (s: number) => {
    const m = Math.floor(s / 60);
    const sec = s % 60;
    return `${m}:${sec.toString().padStart(2, '0')}`;
  };

  const toggleMute = () => {
    const audioTrack = localStreamRef.current?.getAudioTracks()[0];
    if (audioTrack) {
      audioTrack.enabled = !audioTrack.enabled;
      setIsMuted(!audioTrack.enabled);
    }
  };

  const toggleVideo = () => {
    const videoTrack = localStreamRef.current?.getVideoTracks()[0];
    if (videoTrack) {
      videoTrack.enabled = !videoTrack.enabled;
      setIsVideoOff(!videoTrack.enabled);
    }
  };

  return (
    <div className="flex h-full flex-col items-center justify-center bg-background relative animate-fade-in">
      <video ref={remoteVideoRef} autoPlay playsInline className="absolute inset-0 h-full w-full object-cover" />

      {status === 'connecting' && (
        <div className="absolute inset-0 flex flex-col items-center justify-center bg-background/80 z-10">
          <div className="h-20 w-20 rounded-full gradient-primary flex items-center justify-center mb-4 shadow-glow animate-pulse">
            <span className="text-3xl font-bold text-primary-foreground">{partnerName.charAt(0).toUpperCase()}</span>
          </div>
          <p className="text-lg font-semibold text-foreground">{partnerName}</p>
          <p className="text-sm text-muted-foreground animate-pulse mt-1">
            {isCaller ? 'Вызов...' : 'Подключение...'}
          </p>
        </div>
      )}

      {status === 'connected' && (
        <div className="absolute top-4 left-1/2 -translate-x-1/2 z-20 bg-secondary/80 px-3 py-1 rounded-full">
          <span className="text-xs text-foreground">{formatDuration(callDuration)}</span>
        </div>
      )}

      <video
        ref={localVideoRef}
        autoPlay
        muted
        playsInline
        className="absolute bottom-24 right-4 h-32 w-24 rounded-xl object-cover border-2 border-border z-20"
      />

      <div className="absolute bottom-6 z-20 flex gap-4">
        <Button
          onClick={toggleMute}
          variant="ghost"
          size="icon"
          className={`h-14 w-14 rounded-full ${isMuted ? 'bg-destructive text-destructive-foreground' : 'bg-secondary text-foreground'}`}
        >
          {isMuted ? <MicOff className="h-6 w-6" /> : <Mic className="h-6 w-6" />}
        </Button>
        <Button
          onClick={hangUp}
          variant="ghost"
          size="icon"
          className="h-14 w-14 rounded-full bg-destructive text-destructive-foreground hover:bg-destructive/80"
        >
          <PhoneOff className="h-6 w-6" />
        </Button>
        {isVideo && (
          <Button
            onClick={toggleVideo}
            variant="ghost"
            size="icon"
            className={`h-14 w-14 rounded-full ${isVideoOff ? 'bg-destructive text-destructive-foreground' : 'bg-secondary text-foreground'}`}
          >
            {isVideoOff ? <VideoOff className="h-6 w-6" /> : <Video className="h-6 w-6" />}
          </Button>
        )}
      </div>
    </div>
  );
};

export default VideoCall;
