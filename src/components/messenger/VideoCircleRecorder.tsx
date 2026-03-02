import { useState, useRef } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { Circle, Square } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';

interface VideoCircleRecorderProps {
  conversationId: string;
}

const VideoCircleRecorder = ({ conversationId }: VideoCircleRecorderProps) => {
  const { user } = useAuth();
  const [recording, setRecording] = useState(false);
  const [duration, setDuration] = useState(0);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<NodeJS.Timeout | null>(null);
  const videoPreviewRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);

  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user', width: 480, height: 480 }, audio: true });
      streamRef.current = stream;
      if (videoPreviewRef.current) videoPreviewRef.current.srcObject = stream;

      const mediaRecorder = new MediaRecorder(stream, { mimeType: 'video/webm' });
      mediaRecorderRef.current = mediaRecorder;
      chunksRef.current = [];

      mediaRecorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };

      mediaRecorder.onstop = async () => {
        stream.getTracks().forEach(t => t.stop());
        if (timerRef.current) clearInterval(timerRef.current);
        setDuration(0);

        const blob = new Blob(chunksRef.current, { type: 'video/webm' });
        if (blob.size < 5000) return;

        const path = `${user!.id}/video_circle_${Date.now()}.webm`;
        const { error } = await supabase.storage.from('chat-media').upload(path, blob);
        if (error) { toast.error('Ошибка загрузки'); return; }

        const { data: urlData } = supabase.storage.from('chat-media').getPublicUrl(path);
        await supabase.from('messages').insert({
          conversation_id: conversationId,
          sender_id: user!.id,
          message_type: 'video_circle',
          file_url: urlData.publicUrl,
          file_name: 'video_circle.webm',
        });
      };

      mediaRecorder.start();
      setRecording(true);
      setDuration(0);
      timerRef.current = setInterval(() => setDuration(d => d + 1), 1000);
    } catch {
      toast.error('Нет доступа к камере');
    }
  };

  const stopRecording = () => {
    mediaRecorderRef.current?.stop();
    setRecording(false);
  };

  const formatDuration = (s: number) => {
    const m = Math.floor(s / 60);
    const sec = s % 60;
    return `${m}:${sec.toString().padStart(2, '0')}`;
  };

  if (recording) {
    return (
      <div className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-background/90 backdrop-blur-sm">
        <div className="relative">
          <video
            ref={videoPreviewRef}
            autoPlay
            muted
            playsInline
            className="h-64 w-64 rounded-full object-cover border-4 border-primary shadow-glow"
          />
          <div className="absolute -bottom-2 left-1/2 -translate-x-1/2 flex items-center gap-2 bg-card rounded-full px-3 py-1">
            <span className="text-xs text-destructive animate-pulse">●</span>
            <span className="text-sm text-foreground font-mono">{formatDuration(duration)}</span>
          </div>
        </div>
        <Button onClick={stopRecording} className="mt-6 bg-destructive text-destructive-foreground rounded-full px-6">
          <Square className="h-4 w-4 mr-2" /> Остановить
        </Button>
      </div>
    );
  }

  return (
    <Button type="button" variant="ghost" size="icon" onClick={startRecording} className="text-muted-foreground hover:text-primary shrink-0" title="Видеокружок">
      <Circle className="h-5 w-5" />
    </Button>
  );
};

export default VideoCircleRecorder;
