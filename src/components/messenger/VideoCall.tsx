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

const ICE_SERVERS: RTCConfiguration = {
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
  const initializedRef = useRef(false);
  const disconnectTimeoutRef = useRef<number | null>(null);
  const queuedSignalsRef = useRef<any[]>([]);
  const processedSignalIdsRef = useRef<Set<string>>(new Set());
  const pendingIceCandidatesRef = useRef<RTCIceCandidateInit[]>([]);

  const clearDisconnectTimeout = useCallback(() => {
    if (disconnectTimeoutRef.current !== null) {
      window.clearTimeout(disconnectTimeoutRef.current);
      disconnectTimeoutRef.current = null;
    }
  }, []);

  const sendSignal = useCallback(async (type: string, data: object) => {
    if (!user || !partnerId) return;

    const { error } = await supabase.from('call_signals').insert({
      conversation_id: conversationId,
      sender_id: user.id,
      receiver_id: partnerId,
      signal_type: type,
      signal_data: data as any,
    });

    if (error) {
      throw error;
    }
  }, [user, partnerId, conversationId]);

  const cleanup = useCallback(() => {
    localStreamRef.current?.getTracks().forEach((track) => track.stop());
    localStreamRef.current = null;

    pcRef.current?.close();
    pcRef.current = null;

    pendingIceCandidatesRef.current = [];
    queuedSignalsRef.current = [];
    processedSignalIdsRef.current.clear();
  }, []);

  const endCall = useCallback(async (sendHangUpSignal: boolean) => {
    if (endedRef.current) return;
    endedRef.current = true;

    clearDisconnectTimeout();

    if (sendHangUpSignal) {
      try {
        await sendSignal('hang-up', {});
      } catch {
        // ignore network errors when ending call
      }
    }

    cleanup();
    setStatus('ended');
    onEnd();
  }, [clearDisconnectTimeout, sendSignal, cleanup, onEnd]);

  const addOrQueueIceCandidate = useCallback(async (pc: RTCPeerConnection, candidateInit: RTCIceCandidateInit | undefined) => {
    if (!candidateInit) return;

    if (!pc.remoteDescription) {
      pendingIceCandidatesRef.current.push(candidateInit);
      return;
    }

    try {
      await pc.addIceCandidate(new RTCIceCandidate(candidateInit));
    } catch {
      // ignore invalid candidate race conditions
    }
  }, []);

  const flushPendingIceCandidates = useCallback(async (pc: RTCPeerConnection) => {
    if (!pc.remoteDescription || pendingIceCandidatesRef.current.length === 0) return;

    const queued = [...pendingIceCandidatesRef.current];
    pendingIceCandidatesRef.current = [];

    for (const candidate of queued) {
      try {
        await pc.addIceCandidate(new RTCIceCandidate(candidate));
      } catch {
        // ignore invalid candidate race conditions
      }
    }
  }, []);

  const applyRemoteDescription = useCallback(async (pc: RTCPeerConnection, signalData: any) => {
    if (!signalData?.sdp || !signalData?.type) return;

    if (pc.currentRemoteDescription?.sdp === signalData.sdp) {
      await flushPendingIceCandidates(pc);
      return;
    }

    await pc.setRemoteDescription(new RTCSessionDescription({
      type: signalData.type,
      sdp: signalData.sdp,
    }));

    await flushPendingIceCandidates(pc);
  }, [flushPendingIceCandidates]);

  const processSignal = useCallback(async (signal: any, pc: RTCPeerConnection) => {
    if (!signal?.signal_type) return;

    const signalId = signal.id as string | undefined;
    if (signalId && processedSignalIdsRef.current.has(signalId)) return;
    if (signalId) processedSignalIdsRef.current.add(signalId);

    try {
      if (signal.signal_type === 'offer') {
        if (isCaller) return;

        await applyRemoteDescription(pc, signal.signal_data);
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        await sendSignal('answer', { sdp: answer.sdp, type: answer.type });
        return;
      }

      if (signal.signal_type === 'answer') {
        if (!isCaller) return;
        await applyRemoteDescription(pc, signal.signal_data);
        return;
      }

      if (signal.signal_type === 'ice-candidate') {
        await addOrQueueIceCandidate(pc, signal.signal_data?.candidate);
        return;
      }

      if (signal.signal_type === 'hang-up' || signal.signal_type === 'reject') {
        await endCall(false);
      }
    } catch (error) {
      console.error('Signal handling error:', error);
    }
  }, [isCaller, applyRemoteDescription, sendSignal, addOrQueueIceCandidate, endCall]);

  const drainQueuedSignals = useCallback(async (pc: RTCPeerConnection) => {
    if (queuedSignalsRef.current.length === 0) return;

    const queued = [...queuedSignalsRef.current];
    queuedSignalsRef.current = [];

    for (const signal of queued) {
      await processSignal(signal, pc);
    }
  }, [processSignal]);

  const setupPeerConnection = useCallback(async () => {
    if (!user) return null;

    const stream = await navigator.mediaDevices.getUserMedia({
      audio: true,
      video: isVideo,
    });

    localStreamRef.current = stream;

    if (localVideoRef.current) {
      localVideoRef.current.srcObject = stream;
    }

    const pc = new RTCPeerConnection(ICE_SERVERS);
    pcRef.current = pc;

    stream.getTracks().forEach((track) => pc.addTrack(track, stream));

    pc.onicecandidate = (event) => {
      if (event.candidate) {
        void sendSignal('ice-candidate', { candidate: event.candidate.toJSON() });
      }
    };

    pc.ontrack = (event) => {
      if (remoteVideoRef.current && event.streams[0]) {
        remoteVideoRef.current.srcObject = event.streams[0];
        setStatus('connected');
      }
    };

    pc.oniceconnectionstatechange = () => {
      if (pc.iceConnectionState === 'failed' || pc.iceConnectionState === 'closed') {
        void endCall(true);
        return;
      }

      if (pc.iceConnectionState === 'disconnected') {
        clearDisconnectTimeout();
        disconnectTimeoutRef.current = window.setTimeout(() => {
          if (pc.iceConnectionState === 'disconnected') {
            void endCall(true);
          }
        }, 8000);
        return;
      }

      if (pc.iceConnectionState === 'connected' || pc.iceConnectionState === 'completed') {
        clearDisconnectTimeout();
      }
    };

    return pc;
  }, [user, isVideo, sendSignal, clearDisconnectTimeout, endCall]);

  const startAsCaller = useCallback(async () => {
    if (!user || !partnerId) return;

    try {
      await supabase
        .from('call_signals')
        .delete()
        .eq('conversation_id', conversationId)
        .or(`sender_id.eq.${user.id},receiver_id.eq.${user.id},sender_id.eq.${partnerId},receiver_id.eq.${partnerId}`);

      const pc = await setupPeerConnection();
      if (!pc) return;

      await drainQueuedSignals(pc);

      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);

      await sendSignal('offer', {
        sdp: offer.sdp,
        type: offer.type,
        call_type: isVideo ? 'video' : 'audio',
      });
    } catch (error) {
      console.error('Failed to start call:', error);
      await endCall(false);
    }
  }, [user, partnerId, conversationId, setupPeerConnection, drainQueuedSignals, sendSignal, isVideo, endCall]);

  const startAsCallee = useCallback(async () => {
    if (!user || !partnerId) return;

    try {
      const pc = await setupPeerConnection();
      if (!pc) return;

      await drainQueuedSignals(pc);

      const { data: existingSignals } = await supabase
        .from('call_signals')
        .select('*')
        .eq('conversation_id', conversationId)
        .eq('receiver_id', user.id)
        .eq('sender_id', partnerId)
        .in('signal_type', ['offer', 'ice-candidate'])
        .order('created_at', { ascending: true });

      const latestOffer = [...(existingSignals || [])].reverse().find((signal) => signal.signal_type === 'offer');

      if (latestOffer) {
        await processSignal(latestOffer, pc);

        for (const signal of existingSignals || []) {
          if (signal.signal_type !== 'ice-candidate') continue;
          if (signal.created_at < latestOffer.created_at) continue;
          await processSignal(signal, pc);
        }
      }
    } catch (error) {
      console.error('Failed to setup call:', error);
      await endCall(false);
    }
  }, [user, partnerId, setupPeerConnection, drainQueuedSignals, conversationId, processSignal, endCall]);

  useEffect(() => {
    if (!user) return;

    const channel = supabase
      .channel(`call-${conversationId}-${user.id}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'call_signals',
          filter: `receiver_id=eq.${user.id}`,
        },
        (payload) => {
          const signal = payload.new as any;
          if (signal.conversation_id !== conversationId) return;

          const pc = pcRef.current;
          if (!pc) {
            queuedSignalsRef.current.push(signal);
            return;
          }

          void processSignal(signal, pc);
        },
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [user, conversationId, processSignal]);

  useEffect(() => {
    if (initializedRef.current) return;
    initializedRef.current = true;

    if (isCaller) {
      void startAsCaller();
    } else {
      void startAsCallee();
    }

    return () => {
      clearDisconnectTimeout();
      cleanup();
    };
  }, [isCaller, startAsCaller, startAsCallee, clearDisconnectTimeout, cleanup]);

  useEffect(() => {
    if (status !== 'connected') return;
    const interval = setInterval(() => setCallDuration((duration) => duration + 1), 1000);
    return () => clearInterval(interval);
  }, [status]);

  const formatDuration = (seconds: number) => {
    const minutes = Math.floor(seconds / 60);
    const sec = seconds % 60;
    return `${minutes}:${sec.toString().padStart(2, '0')}`;
  };

  const toggleMute = () => {
    const audioTrack = localStreamRef.current?.getAudioTracks()[0];
    if (!audioTrack) return;

    audioTrack.enabled = !audioTrack.enabled;
    setIsMuted(!audioTrack.enabled);
  };

  const toggleVideo = () => {
    const videoTrack = localStreamRef.current?.getVideoTracks()[0];
    if (!videoTrack) return;

    videoTrack.enabled = !videoTrack.enabled;
    setIsVideoOff(!videoTrack.enabled);
  };

  return (
    <div className="relative flex h-full flex-col items-center justify-center bg-background">
      <video ref={remoteVideoRef} autoPlay playsInline className="absolute inset-0 h-full w-full object-cover" />

      {status === 'connecting' && (
        <div className="absolute inset-0 z-10 flex flex-col items-center justify-center bg-background/80">
          <div className="gradient-primary mb-4 flex h-20 w-20 items-center justify-center rounded-full shadow-glow">
            <span className="text-3xl font-bold text-primary-foreground">{partnerName.charAt(0).toUpperCase()}</span>
          </div>
          <p className="text-lg font-semibold text-foreground">{partnerName}</p>
          <p className="mt-1 animate-pulse text-sm text-muted-foreground">{isCaller ? 'Вызов...' : 'Подключение...'}</p>
        </div>
      )}

      {status === 'connected' && (
        <div className="absolute left-1/2 top-4 z-20 -translate-x-1/2 rounded-full bg-secondary/80 px-3 py-1">
          <span className="text-xs text-foreground">{formatDuration(callDuration)}</span>
        </div>
      )}

      <video
        ref={localVideoRef}
        autoPlay
        muted
        playsInline
        className="absolute bottom-24 right-4 z-20 h-32 w-24 rounded-xl border-2 border-border object-cover"
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
          onClick={() => void endCall(true)}
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
