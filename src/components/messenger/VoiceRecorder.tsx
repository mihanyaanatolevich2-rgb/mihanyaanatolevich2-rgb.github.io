import { useState, useRef } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { Mic, Square } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';

interface VoiceRecorderProps {
  conversationId: string;
}

const VoiceRecorder = ({ conversationId }: VoiceRecorderProps) => {
  const { user } = useAuth();
  const [recording, setRecording] = useState(false);
  const [duration, setDuration] = useState(0);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<NodeJS.Timeout | null>(null);

  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mediaRecorder = new MediaRecorder(stream, { mimeType: 'audio/webm' });
      mediaRecorderRef.current = mediaRecorder;
      chunksRef.current = [];

      mediaRecorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };

      mediaRecorder.onstop = async () => {
        stream.getTracks().forEach(t => t.stop());
        if (timerRef.current) clearInterval(timerRef.current);
        setDuration(0);

        const blob = new Blob(chunksRef.current, { type: 'audio/webm' });
        if (blob.size < 1000) return; // too short

        const path = `${user!.id}/voice_${Date.now()}.webm`;
        const { error } = await supabase.storage.from('chat-media').upload(path, blob);
        if (error) { toast.error('Ошибка загрузки'); return; }

        const { data: urlData } = supabase.storage.from('chat-media').getPublicUrl(path);
        await supabase.from('messages').insert({
          conversation_id: conversationId,
          sender_id: user!.id,
          message_type: 'voice',
          file_url: urlData.publicUrl,
          file_name: 'voice.webm',
        });
      };

      mediaRecorder.start();
      setRecording(true);
      setDuration(0);
      timerRef.current = setInterval(() => setDuration(d => d + 1), 1000);
    } catch {
      toast.error('Нет доступа к микрофону');
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

  return recording ? (
    <div className="flex items-center gap-2">
      <span className="text-xs text-destructive animate-pulse">● {formatDuration(duration)}</span>
      <Button type="button" variant="ghost" size="icon" onClick={stopRecording} className="text-destructive shrink-0">
        <Square className="h-4 w-4" />
      </Button>
    </div>
  ) : (
    <Button type="button" variant="ghost" size="icon" onClick={startRecording} className="text-muted-foreground hover:text-primary shrink-0">
      <Mic className="h-5 w-5" />
    </Button>
  );
};

export default VoiceRecorder;
