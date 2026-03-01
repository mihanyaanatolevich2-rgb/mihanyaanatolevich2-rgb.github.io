import { useState, useEffect, useRef } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { Send, Paperclip, Phone, Video, ArrowLeft, Image, FileIcon, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import VideoCall from './VideoCall';

interface Message {
  id: string;
  sender_id: string;
  content: string | null;
  message_type: string;
  file_url: string | null;
  file_name: string | null;
  created_at: string;
}

interface ChatViewProps {
  conversationId: string;
  onBack: () => void;
}

const ChatView = ({ conversationId, onBack }: ChatViewProps) => {
  const { user } = useAuth();
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [partnerName, setPartnerName] = useState('');
  const [partnerId, setPartnerId] = useState('');
  const [uploading, setUploading] = useState(false);
  const [callType, setCallType] = useState<'audio' | 'video' | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  // Load partner info
  useEffect(() => {
    const loadPartner = async () => {
      if (!user) return;
      const { data } = await supabase
        .from('conversation_participants')
        .select('user_id')
        .eq('conversation_id', conversationId)
        .neq('user_id', user.id)
        .maybeSingle();

      if (data) {
        setPartnerId(data.user_id);
        const { data: profile } = await supabase
          .from('profiles')
          .select('display_name, username')
          .eq('user_id', data.user_id)
          .single();
        setPartnerName(profile?.display_name || profile?.username || 'Unknown');
      }
    };
    loadPartner();
  }, [conversationId, user]);

  // Load messages
  useEffect(() => {
    const loadMessages = async () => {
      const { data } = await supabase
        .from('messages')
        .select('*')
        .eq('conversation_id', conversationId)
        .order('created_at', { ascending: true });
      if (data) setMessages(data);
    };
    loadMessages();
  }, [conversationId]);

  // Realtime messages
  useEffect(() => {
    const channel = supabase
      .channel(`messages-${conversationId}`)
      .on('postgres_changes', {
        event: 'INSERT',
        schema: 'public',
        table: 'messages',
        filter: `conversation_id=eq.${conversationId}`,
      }, (payload) => {
        setMessages(prev => [...prev, payload.new as Message]);
      })
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [conversationId]);

  useEffect(scrollToBottom, [messages]);

  const sendMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || !user) return;

    const content = input.trim();
    setInput('');

    await supabase.from('messages').insert({
      conversation_id: conversationId,
      sender_id: user.id,
      content,
      message_type: 'text',
    });
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !user) return;

    setUploading(true);
    const ext = file.name.split('.').pop();
    const path = `${user.id}/${Date.now()}.${ext}`;

    const { error } = await supabase.storage.from('chat-media').upload(path, file);
    if (error) {
      setUploading(false);
      return;
    }

    const { data: urlData } = supabase.storage.from('chat-media').getPublicUrl(path);

    let messageType = 'file';
    if (file.type.startsWith('image/')) messageType = 'image';
    else if (file.type.startsWith('video/')) messageType = 'video';

    await supabase.from('messages').insert({
      conversation_id: conversationId,
      sender_id: user.id,
      message_type: messageType,
      file_url: urlData.publicUrl,
      file_name: file.name,
    });

    setUploading(false);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const renderMessage = (msg: Message) => {
    const isOwn = msg.sender_id === user?.id;

    return (
      <div key={msg.id} className={`flex animate-fade-in ${isOwn ? 'justify-end' : 'justify-start'}`}>
        <div className={`max-w-[75%] rounded-2xl px-4 py-2 ${isOwn ? 'message-own rounded-br-md' : 'message-other rounded-bl-md'}`}>
          {msg.message_type === 'text' && (
            <p className="text-sm text-foreground whitespace-pre-wrap break-words">{msg.content}</p>
          )}
          {msg.message_type === 'image' && msg.file_url && (
            <img src={msg.file_url} alt={msg.file_name || 'image'} className="max-w-full rounded-lg" />
          )}
          {msg.message_type === 'video' && msg.file_url && (
            <video src={msg.file_url} controls className="max-w-full rounded-lg" />
          )}
          {msg.message_type === 'file' && msg.file_url && (
            <a href={msg.file_url} target="_blank" rel="noreferrer" className="flex items-center gap-2 text-primary hover:underline">
              <FileIcon className="h-4 w-4" />
              <span className="text-sm">{msg.file_name || 'Файл'}</span>
            </a>
          )}
          <p className="mt-1 text-[10px] text-muted-foreground">
            {new Date(msg.created_at).toLocaleTimeString('ru', { hour: '2-digit', minute: '2-digit' })}
          </p>
        </div>
      </div>
    );
  };

  if (callType) {
    return (
      <VideoCall
        conversationId={conversationId}
        partnerId={partnerId}
        partnerName={partnerName}
        isVideo={callType === 'video'}
        onEnd={() => setCallType(null)}
      />
    );
  }

  return (
    <div className="flex h-full flex-col bg-background">
      {/* Header */}
      <div className="flex items-center gap-3 border-b border-border px-4 py-3">
        <Button variant="ghost" size="icon" onClick={onBack} className="md:hidden text-muted-foreground">
          <ArrowLeft className="h-5 w-5" />
        </Button>
        <Avatar className="h-9 w-9">
          <AvatarFallback className="gradient-primary text-primary-foreground text-sm font-semibold">
            {partnerName.charAt(0).toUpperCase()}
          </AvatarFallback>
        </Avatar>
        <div className="flex-1">
          <p className="text-sm font-semibold text-foreground">{partnerName}</p>
        </div>
        <Button variant="ghost" size="icon" onClick={() => setCallType('audio')} className="text-muted-foreground hover:text-primary">
          <Phone className="h-5 w-5" />
        </Button>
        <Button variant="ghost" size="icon" onClick={() => setCallType('video')} className="text-muted-foreground hover:text-primary">
          <Video className="h-5 w-5" />
        </Button>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-2">
        {messages.map(renderMessage)}
        <div ref={messagesEndRef} />
      </div>

      {/* Input */}
      <form onSubmit={sendMessage} className="flex items-center gap-2 border-t border-border px-4 py-3">
        <input
          ref={fileInputRef}
          type="file"
          onChange={handleFileUpload}
          className="hidden"
          accept="image/*,video/*,.pdf,.doc,.docx,.txt,.zip"
        />
        <Button
          type="button"
          variant="ghost"
          size="icon"
          onClick={() => fileInputRef.current?.click()}
          disabled={uploading}
          className="text-muted-foreground hover:text-primary shrink-0"
        >
          <Paperclip className="h-5 w-5" />
        </Button>
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder={uploading ? 'Загрузка файла...' : 'Сообщение...'}
          disabled={uploading}
          className="flex-1 rounded-xl bg-secondary px-4 py-2 text-sm text-foreground placeholder:text-muted-foreground outline-none focus:ring-1 focus:ring-primary"
        />
        <Button type="submit" size="icon" disabled={!input.trim()} className="gradient-primary text-primary-foreground shrink-0 rounded-xl">
          <Send className="h-4 w-4" />
        </Button>
      </form>
    </div>
  );
};

export default ChatView;
