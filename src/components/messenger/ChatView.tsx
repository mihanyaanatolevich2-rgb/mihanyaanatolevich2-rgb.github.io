import { useState, useEffect, useRef } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { Send, Paperclip, Phone, Video, ArrowLeft, FileIcon, Edit2, Trash2, TrashIcon, X, Check, CheckCheck } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import VideoCall from './VideoCall';
import MessageReactions from './MessageReactions';
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
  ContextMenuSeparator,
} from '@/components/ui/context-menu';
import { toast } from 'sonner';

interface Message {
  id: string;
  sender_id: string;
  content: string | null;
  message_type: string;
  file_url: string | null;
  file_name: string | null;
  created_at: string;
  is_edited?: boolean;
  deleted_for_all?: boolean;
}

interface ChatViewProps {
  conversationId: string;
  onBack: () => void;
}

const ChatView = ({ conversationId, onBack }: ChatViewProps) => {
  const { user } = useAuth();
  const [messages, setMessages] = useState<Message[]>([]);
  const [deletedIds, setDeletedIds] = useState<Set<string>>(new Set());
  const [input, setInput] = useState('');
  const [partnerName, setPartnerName] = useState('');
  const [partnerId, setPartnerId] = useState('');
  const [partnerLastSeen, setPartnerLastSeen] = useState<string | null>(null);
  const [isGroup, setIsGroup] = useState(false);
  const [groupName, setGroupName] = useState('');
  const [uploading, setUploading] = useState(false);
  const [callType, setCallType] = useState<'audio' | 'video' | null>(null);
  const [isCaller, setIsCaller] = useState(false);
  const [incomingCall, setIncomingCall] = useState<{ type: 'audio' | 'video' } | null>(null);
  const [editingMessage, setEditingMessage] = useState<Message | null>(null);
  const [editText, setEditText] = useState('');
  const [readByMap, setReadByMap] = useState<Map<string, string[]>>(new Map());
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const messagesContainerRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [maxCharsPerLine, setMaxCharsPerLine] = useState(() => {
    const saved = localStorage.getItem('msg-max-chars');
    return saved ? Number(saved) : 40;
  });

  // Listen for settings changes
  useEffect(() => {
    const handler = () => {
      const saved = localStorage.getItem('msg-max-chars');
      if (saved) setMaxCharsPerLine(Number(saved));
    };
    window.addEventListener('msg-max-chars-changed', handler);
    return () => window.removeEventListener('msg-max-chars-changed', handler);
  }, []);

  // Update last_seen periodically
  useEffect(() => {
    if (!user) return;
    const update = () => supabase.rpc('update_last_seen');
    update();
    const interval = setInterval(update, 30000);
    return () => clearInterval(interval);
  }, [user]);

  const scrollToBottom = (instant = false) => {
    if (messagesContainerRef.current) {
      messagesContainerRef.current.scrollTop = messagesContainerRef.current.scrollHeight;
    }
  };

  // Mark as read - both last_read_at and individual message read receipts
  const markRead = async () => {
    if (!user) return;
    await supabase
      .from('conversation_participants')
      .update({ last_read_at: new Date().toISOString() })
      .eq('conversation_id', conversationId)
      .eq('user_id', user.id);
  };

  const markMessagesRead = async (msgs: Message[]) => {
    if (!user) return;
    const unreadFromOthers = msgs.filter(m => m.sender_id !== user.id);
    if (unreadFromOthers.length === 0) return;
    
    // Batch insert read receipts, ignore conflicts
    const rows = unreadFromOthers.map(m => ({ message_id: m.id, user_id: user.id }));
    await supabase.from('message_read_by').upsert(rows, { onConflict: 'message_id,user_id', ignoreDuplicates: true });
  };

  // Load read receipts
  const loadReadReceipts = async () => {
    if (!user) return;
    const { data } = await supabase
      .from('message_read_by')
      .select('message_id, user_id')
      .in('message_id', messages.filter(m => m.sender_id === user.id).map(m => m.id));
    
    if (data) {
      const map = new Map<string, string[]>();
      for (const r of data) {
        const arr = map.get(r.message_id) || [];
        arr.push(r.user_id);
        map.set(r.message_id, arr);
      }
      setReadByMap(map);
    }
  };

  // Load conversation info
  useEffect(() => {
    const loadConvInfo = async () => {
      if (!user) return;

      const { data: conv } = await supabase
        .from('conversations')
        .select('name, is_group')
        .eq('id', conversationId)
        .single();

      if (conv?.is_group) {
        setIsGroup(true);
        setGroupName(conv.name || 'Группа');
        return;
      }

      setIsGroup(false);
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
          .select('display_name, username, last_seen_at')
          .eq('user_id', data.user_id)
          .single();
        setPartnerName(profile?.display_name || profile?.username || 'Unknown');
        setPartnerLastSeen(profile?.last_seen_at || null);
      }
    };
    loadConvInfo();
  }, [conversationId, user]);

  // Poll partner last_seen
  useEffect(() => {
    if (!partnerId || isGroup) return;
    const interval = setInterval(async () => {
      const { data } = await supabase
        .from('profiles')
        .select('last_seen_at')
        .eq('user_id', partnerId)
        .single();
      if (data) setPartnerLastSeen(data.last_seen_at);
    }, 15000);
    return () => clearInterval(interval);
  }, [partnerId, isGroup]);

  // Load messages + deleted for me
  useEffect(() => {
    const load = async () => {
      if (!user) return;
      const [{ data: msgs }, { data: deleted }] = await Promise.all([
        supabase
          .from('messages')
          .select('*')
          .eq('conversation_id', conversationId)
          .order('created_at', { ascending: true }),
        supabase
          .from('deleted_messages')
          .select('message_id')
          .eq('user_id', user.id),
      ]);
      if (msgs) {
        setMessages(msgs);
        markMessagesRead(msgs);
      }
      if (deleted) setDeletedIds(new Set(deleted.map(d => d.message_id)));
      markRead();
      // Use setTimeout to ensure DOM is updated before scrolling
      setTimeout(() => scrollToBottom(true), 50);
      setTimeout(() => scrollToBottom(true), 200);
    };
    load();
  }, [conversationId, user]);

  // Load read receipts when messages change
  useEffect(() => {
    if (messages.length > 0) loadReadReceipts();
  }, [messages.length]);

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
        const newMsg = payload.new as Message;
        setMessages(prev => [...prev, newMsg]);
        if (newMsg.sender_id !== user?.id) {
          markMessagesRead([newMsg]);
        }
        markRead();
      })
      .on('postgres_changes', {
        event: 'UPDATE',
        schema: 'public',
        table: 'messages',
        filter: `conversation_id=eq.${conversationId}`,
      }, (payload) => {
        setMessages(prev => prev.map(m => m.id === payload.new.id ? payload.new as Message : m));
      })
      .on('postgres_changes', {
        event: 'DELETE',
        schema: 'public',
        table: 'messages',
      }, (payload) => {
        setMessages(prev => prev.filter(m => m.id !== (payload.old as any).id));
      })
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [conversationId]);

  // Realtime read receipts
  useEffect(() => {
    if (!user) return;
    const channel = supabase
      .channel(`read-receipts-${conversationId}`)
      .on('postgres_changes', {
        event: 'INSERT',
        schema: 'public',
        table: 'message_read_by',
      }, () => {
        loadReadReceipts();
      })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [conversationId, user, messages.length]);

  // Listen for incoming calls
  useEffect(() => {
    if (!user || isGroup) return;

    const channel = supabase
      .channel(`incoming-call-${conversationId}-${user.id}`)
      .on('postgres_changes', {
        event: 'INSERT',
        schema: 'public',
        table: 'call_signals',
        filter: `receiver_id=eq.${user.id}`,
      }, (payload) => {
        const signal = payload.new as any;
        if (signal.conversation_id !== conversationId) return;
        if (signal.signal_type === 'offer' && !callType) {
          setIncomingCall({ type: 'audio' });
        }
      })
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [user, conversationId, isGroup, callType]);

  // Scroll to bottom when new messages arrive
  useEffect(() => {
    scrollToBottom();
  }, [messages.length]);

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

  const startEdit = (msg: Message) => {
    setEditingMessage(msg);
    setEditText(msg.content || '');
  };

  const saveEdit = async () => {
    if (!editingMessage || !editText.trim()) return;
    await supabase
      .from('messages')
      .update({ content: editText.trim(), is_edited: true, edited_at: new Date().toISOString() })
      .eq('id', editingMessage.id);
    setEditingMessage(null);
    setEditText('');
  };

  const cancelEdit = () => {
    setEditingMessage(null);
    setEditText('');
  };

  const deleteForMe = async (msgId: string) => {
    await supabase.from('deleted_messages').insert({ message_id: msgId, user_id: user!.id });
    setDeletedIds(prev => new Set([...prev, msgId]));
    toast.success('Сообщение скрыто');
  };

  const deleteForAll = async (msgId: string) => {
    await supabase.from('messages').delete().eq('id', msgId);
    toast.success('Сообщение удалено для всех');
  };

  // Format last seen
  const formatLastSeen = (lastSeen: string | null) => {
    if (!lastSeen) return '';
    const date = new Date(lastSeen);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMin = Math.floor(diffMs / 60000);

    if (diffMin < 2) return 'в сети';
    
    const timeStr = date.toLocaleTimeString('ru', { hour: '2-digit', minute: '2-digit' });
    
    const isToday = date.toDateString() === now.toDateString();
    const yesterday = new Date(now);
    yesterday.setDate(yesterday.getDate() - 1);
    const isYesterday = date.toDateString() === yesterday.toDateString();

    if (isToday) return `был(а) в ${timeStr}`;
    if (isYesterday) return `был(а) вчера в ${timeStr}`;
    return `был(а) ${date.toLocaleDateString('ru', { day: 'numeric', month: 'short' })} в ${timeStr}`;
  };

  const isOnline = partnerLastSeen ? (new Date().getTime() - new Date(partnerLastSeen).getTime()) < 120000 : false;

  const displayName = isGroup ? groupName : partnerName;
  const visibleMessages = messages.filter(m => !deletedIds.has(m.id) && !m.deleted_for_all);

  const renderMessage = (msg: Message) => {
    const isOwn = msg.sender_id === user?.id;
    const readers = readByMap.get(msg.id) || [];
    const isRead = isOwn && readers.length > 0;

    return (
      <ContextMenu key={msg.id}>
        <ContextMenuTrigger>
          <div className={`flex animate-fade-in ${isOwn ? 'justify-end' : 'justify-start'}`}>
            <div className={`max-w-[75%] rounded-2xl px-4 py-2 ${isOwn ? 'message-own rounded-br-md' : 'message-other rounded-bl-md'}`}>
              {msg.message_type === 'text' && (
                <p className="text-sm text-foreground whitespace-pre-wrap break-words overflow-hidden" style={{ maxWidth: `${maxCharsPerLine}ch` }}>{msg.content}</p>
              )}
              {msg.message_type === 'image' && msg.file_url && (
                <img src={msg.file_url} alt={msg.file_name || 'image'} className="max-w-full rounded-lg" />
              )}
              {(msg.message_type === 'video' || msg.message_type === 'video_circle') && msg.file_url && (
                <video
                  src={msg.file_url}
                  controls
                  className={`max-w-full ${msg.message_type === 'video_circle' ? 'rounded-full w-48 h-48 object-cover' : 'rounded-lg'}`}
                />
              )}
              {msg.message_type === 'voice' && msg.file_url && (
                <audio src={msg.file_url} controls className="max-w-full" />
              )}
              {msg.message_type === 'file' && msg.file_url && (
                <a href={msg.file_url} target="_blank" rel="noreferrer" className="flex items-center gap-2 text-primary hover:underline">
                  <FileIcon className="h-4 w-4" />
                  <span className="text-sm">{msg.file_name || 'Файл'}</span>
                </a>
              )}
              <div className="flex items-center gap-1 mt-1 justify-end">
                <p className="text-[10px] text-muted-foreground">
                  {new Date(msg.created_at).toLocaleTimeString('ru', { hour: '2-digit', minute: '2-digit' })}
                </p>
                {msg.is_edited && (
                  <span className="text-[10px] text-muted-foreground italic">ред.</span>
                )}
                {isOwn && (
                  isRead 
                    ? <CheckCheck className="h-3.5 w-3.5 text-primary" />
                    : <Check className="h-3.5 w-3.5 text-muted-foreground" />
                )}
              </div>
              <MessageReactions messageId={msg.id} />
            </div>
          </div>
        </ContextMenuTrigger>
        <ContextMenuContent className="bg-popover border-border">
          {isOwn && msg.message_type === 'text' && (
            <ContextMenuItem onClick={() => startEdit(msg)} className="gap-2">
              <Edit2 className="h-4 w-4" /> Редактировать
            </ContextMenuItem>
          )}
          <ContextMenuItem onClick={() => deleteForMe(msg.id)} className="gap-2">
            <TrashIcon className="h-4 w-4" /> Удалить для себя
          </ContextMenuItem>
          {isOwn && (
            <>
              <ContextMenuSeparator />
              <ContextMenuItem onClick={() => deleteForAll(msg.id)} className="gap-2 text-destructive">
                <Trash2 className="h-4 w-4" /> Удалить для всех
              </ContextMenuItem>
            </>
          )}
        </ContextMenuContent>
      </ContextMenu>
    );
  };

  const startCall = (type: 'audio' | 'video') => {
    setIsCaller(true);
    setCallType(type);
  };

  const acceptCall = () => {
    if (!incomingCall) return;
    setIsCaller(false);
    setCallType(incomingCall.type);
    setIncomingCall(null);
  };

  const rejectCall = () => {
    setIncomingCall(null);
  };

  if (callType) {
    return (
      <VideoCall
        conversationId={conversationId}
        partnerId={partnerId}
        partnerName={displayName}
        isVideo={callType === 'video'}
        isCaller={isCaller}
        onEnd={() => { setCallType(null); setIsCaller(false); }}
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
        <div className="relative">
          <Avatar className="h-9 w-9">
            <AvatarFallback className="gradient-primary text-primary-foreground text-sm font-semibold">
              {displayName.charAt(0).toUpperCase()}
            </AvatarFallback>
          </Avatar>
          {!isGroup && isOnline && (
            <span className="absolute bottom-0 right-0 h-2.5 w-2.5 rounded-full bg-[hsl(var(--online))] border-2 border-background" />
          )}
        </div>
        <div className="flex-1">
          <p className="text-sm font-semibold text-foreground">{displayName}</p>
          {isGroup ? (
            <p className="text-xs text-muted-foreground">Группа</p>
          ) : (
            <p className={`text-xs ${isOnline ? 'text-[hsl(var(--online))]' : 'text-muted-foreground'}`}>
              {formatLastSeen(partnerLastSeen)}
            </p>
          )}
        </div>
        {!isGroup && (
          <>
            <Button variant="ghost" size="icon" onClick={() => startCall('audio')} className="text-muted-foreground hover:text-primary">
              <Phone className="h-5 w-5" />
            </Button>
            <Button variant="ghost" size="icon" onClick={() => startCall('video')} className="text-muted-foreground hover:text-primary">
              <Video className="h-5 w-5" />
            </Button>
          </>
        )}
      </div>

      {/* Incoming call banner */}
      {incomingCall && (
        <div className="flex items-center justify-between bg-primary/10 border-b border-border px-4 py-3 animate-fade-in">
          <div className="flex items-center gap-2">
            <Phone className="h-5 w-5 text-primary animate-pulse" />
            <span className="text-sm font-medium text-foreground">{partnerName} звонит...</span>
          </div>
          <div className="flex gap-2">
            <Button size="sm" onClick={acceptCall} className="gradient-primary text-primary-foreground rounded-full px-4">
              Ответить
            </Button>
            <Button size="sm" variant="destructive" onClick={rejectCall} className="rounded-full px-4">
              Отклонить
            </Button>
          </div>
        </div>
      )}

      {/* Edit bar */}
      {editingMessage && (
        <div className="flex items-center gap-2 border-b border-border bg-secondary px-4 py-2">
          <Edit2 className="h-4 w-4 text-primary shrink-0" />
          <span className="text-xs text-muted-foreground truncate flex-1">Редактирование</span>
          <Button variant="ghost" size="icon" onClick={cancelEdit} className="h-6 w-6">
            <X className="h-4 w-4" />
          </Button>
        </div>
      )}

      {/* Messages */}
      <div ref={messagesContainerRef} className="flex-1 overflow-y-auto px-4 py-4 space-y-2 flex flex-col justify-end" style={{ minHeight: 0 }}>
        <div className="flex-1" />
        {visibleMessages.map(renderMessage)}
        <div ref={messagesEndRef} />
      </div>

      {/* Input */}
      {editingMessage ? (
        <div className="flex items-center gap-2 border-t border-border px-4 py-3">
          <input
            value={editText}
            onChange={(e) => setEditText(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && saveEdit()}
            autoFocus
            className="flex-1 rounded-xl bg-secondary px-4 py-2 text-sm text-foreground placeholder:text-muted-foreground outline-none focus:ring-1 focus:ring-primary"
          />
          <Button size="icon" onClick={saveEdit} disabled={!editText.trim()} className="gradient-primary text-primary-foreground shrink-0 rounded-xl">
            <Check className="h-4 w-4" />
          </Button>
        </div>
      ) : (
        <div className="flex items-center gap-2 border-t border-border px-4 py-3">
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
          <form onSubmit={sendMessage} className="flex flex-1 items-center gap-2">
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
      )}
    </div>
  );
};

export default ChatView;
