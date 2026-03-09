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
  onEnd: () => void;
}

const ICE_SERVERS = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
    { urls: 'stun:stun2.l.google.com:19302' },
  ],
};

const VideoCall = ({ conversationId, partnerId, partnerName, isVideo, isCaller, onEnd }: VideoCallProps) => {
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

  const sendSignal = useCallback(async (type: string, data: object) => {
    if (!user) return;
    await supabase.from('call_signals').insert({
      conversation_id: conversationId,
      sender_id: user.id,
      receiver_id: partnerId,
      signal_type: type,
      signal_data: data as any,
    });
  }, [user, conversationId, partnerId]);

  const cleanup = useCallback(() => {
    localStreamRef.current?.getTracks().forEach(t => t.stop());
    pcRef.current?.close();
    pcRef.current = null;
  }, []);

  const hangUp = useCallback(() => {
    if (endedRef.current) return;
    endedRef.current = true;
    sendSignal('hang-up', {});
    cleanup();
    setStatus('ended');
    onEnd();
  }, [sendSignal, cleanup, onEnd]);

  // Setup peer connection and local stream
  const setupPeerConnection = useCallback(async () => {
    if (!user) return null;

    const stream = await navigator.mediaDevices.getUserMedia({
      audio: true,
      video: isVideo,
    });
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
      if (pc.iceConnectionState === 'disconnected' || pc.iceConnectionState === 'failed') {
        hangUp();
      }
    };

    return pc;
  }, [user, isVideo, sendSignal, hangUp]);

  // Caller: clean old signals, then create offer
  const startAsCalller = useCallback(async () => {
    try {
      if (!user) return;
      // Clean old call signals for this conversation
      await supabase
        .from('call_signals')
        .delete()
        .eq('conversation_id', conversationId)
        .or(`sender_id.eq.${user.id},receiver_id.eq.${user.id}`);

      const pc = await setupPeerConnection();
      if (!pc) return;
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      await sendSignal('offer', { sdp: offer.sdp, type: offer.type });
    } catch (err) {
      console.error('Failed to start call:', err);
      onEnd();
    }
  }, [setupPeerConnection, sendSignal, onEnd, user, conversationId]);

  // Callee: setup PC, then check for existing offer in DB
  const startAsCallee = useCallback(async () => {
    try {
      const pc = await setupPeerConnection();
      if (!pc || !user) return;

      // Fetch existing offer that was sent before we subscribed to realtime
      const { data: signals } = await supabase
        .from('call_signals')
        .select('*')
        .eq('conversation_id', conversationId)
        .eq('receiver_id', user.id)
        .eq('signal_type', 'offer')
        .order('created_at', { ascending: false })
        .limit(1);

      if (signals && signals.length > 0) {
        const signal = signals[0] as any;
        await pc.setRemoteDescription(new RTCSessionDescription(signal.signal_data));
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        await sendSignal('answer', { sdp: answer.sdp, type: answer.type });

        // Also apply any ice candidates that arrived before
        const { data: iceCandidates } = await supabase
          .from('call_signals')
          .select('*')
          .eq('conversation_id', conversationId)
          .eq('receiver_id', user.id)
          .eq('signal_type', 'ice-candidate')
          .gt('created_at', signal.created_at);

        if (iceCandidates) {
          for (const ic of iceCandidates) {
            try {
              await pc.addIceCandidate(new RTCIceCandidate((ic.signal_data as any).candidate));
            } catch { /* ignore */ }
          }
        }
      }
    } catch (err) {
      console.error('Failed to setup call:', err);
      onEnd();
    }
  }, [setupPeerConnection, onEnd, user, conversationId, sendSignal]);

  // Listen for signals
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
        const signal = payload.new as any;
        if (signal.conversation_id !== conversationId) return;

        const pc = pcRef.current;
        if (!pc) return;

        try {
          if (signal.signal_type === 'offer') {
            await pc.setRemoteDescription(new RTCSessionDescription(signal.signal_data));
            const answer = await pc.createAnswer();
            await pc.setLocalDescription(answer);
            await sendSignal('answer', { sdp: answer.sdp, type: answer.type });
          } else if (signal.signal_type === 'answer') {
            await pc.setRemoteDescription(new RTCSessionDescription(signal.signal_data));
          } else if (signal.signal_type === 'ice-candidate') {
            await pc.addIceCandidate(new RTCIceCandidate(signal.signal_data.candidate));
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
  }, [user, conversationId, sendSignal, cleanup, onEnd]);

  // Init call based on role
  useEffect(() => {
    if (isCaller) {
      startAsCalller();
    } else {
      startAsCallee();
    }
    return cleanup;
  }, []);

  // Call timer
  useEffect(() => {
    if (status !== 'connected') return;
    const interval = setInterval(() => setCallDuration(d => d + 1), 1000);
    return () => clearInterval(interval);
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
    <div className="flex h-full flex-col items-center justify-center bg-background relative">
      <video ref={remoteVideoRef} autoPlay playsInline className="absolute inset-0 h-full w-full object-cover" />

      {status === 'connecting' && (
        <div className="absolute inset-0 flex flex-col items-center justify-center bg-background/80 z-10">
          <div className="h-20 w-20 rounded-full gradient-primary flex items-center justify-center mb-4 shadow-glow">
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
