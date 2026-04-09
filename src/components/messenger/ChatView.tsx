import { useState, useEffect, useRef } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { Send, Paperclip, Phone, Video, ArrowLeft, FileIcon, Edit2, Trash2, TrashIcon, X, Check, CheckCheck, Reply, Download, Forward, Copy, Pin, PinOff } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import VideoCall from './VideoCall';
import MessageReactions from './MessageReactions';
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
  ContextMenuSeparator,
} from '@/components/ui/context-menu';
import {
  Dialog,
  DialogContent,
} from '@/components/ui/dialog';
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
  reply_to_id?: string | null;
}

interface PinnedMessage {
  id: string;
  message_id: string;
  conversation_id: string;
  pinned_by: string;
}

interface ChatViewProps {
  conversationId: string;
  onBack: () => void;
}

const BUILTIN_WALLPAPERS = [
  { id: 'none', css: '', size: '' },
  { id: 'dots', css: 'radial-gradient(circle, hsl(var(--muted-foreground) / 0.08) 1px, transparent 1px)', size: '20px 20px' },
  { id: 'grid', css: 'linear-gradient(hsl(var(--muted-foreground) / 0.05) 1px, transparent 1px), linear-gradient(90deg, hsl(var(--muted-foreground) / 0.05) 1px, transparent 1px)', size: '24px 24px' },
  { id: 'diagonal', css: 'repeating-linear-gradient(45deg, transparent, transparent 10px, hsl(var(--muted-foreground) / 0.03) 10px, hsl(var(--muted-foreground) / 0.03) 11px)', size: 'auto' },
  { id: 'bubbles', css: 'radial-gradient(circle at 20% 80%, hsl(var(--primary) / 0.04) 0%, transparent 50%), radial-gradient(circle at 80% 20%, hsl(var(--primary) / 0.06) 0%, transparent 50%), radial-gradient(circle at 50% 50%, hsl(var(--primary) / 0.02) 0%, transparent 70%)', size: 'auto' },
  { id: 'waves', css: 'repeating-linear-gradient(135deg, transparent, transparent 20px, hsl(var(--primary) / 0.03) 20px, hsl(var(--primary) / 0.03) 40px)', size: 'auto' },
];

const ChatView = ({ conversationId, onBack }: ChatViewProps) => {
  const { user } = useAuth();
  const [messages, setMessages] = useState<Message[]>([]);
  const [deletedIds, setDeletedIds] = useState<Set<string>>(new Set());
  const [input, setInput] = useState('');
  const [partnerName, setPartnerName] = useState('');
  const [partnerId, setPartnerId] = useState('');
  const [partnerLastSeen, setPartnerLastSeen] = useState<string | null>(null);
  const [partnerAvatarUrl, setPartnerAvatarUrl] = useState<string | null>(null);
  const [isGroup, setIsGroup] = useState(false);
  const [groupName, setGroupName] = useState('');
  const [uploading, setUploading] = useState(false);
  const [callType, setCallType] = useState<'audio' | 'video' | null>(null);
  const [isCaller, setIsCaller] = useState(false);
  const [incomingCall, setIncomingCall] = useState<{ type: 'audio' | 'video' } | null>(null);
  const [editingMessage, setEditingMessage] = useState<Message | null>(null);
  const [editText, setEditText] = useState('');
  const [replyTo, setReplyTo] = useState<Message | null>(null);
  const [readByMap, setReadByMap] = useState<Map<string, string[]>>(new Map());
  const [participantNames, setParticipantNames] = useState<Map<string, string>>(new Map());
  const [participantAvatars, setParticipantAvatars] = useState<Map<string, string | null>>(new Map());
  const [zoomImage, setZoomImage] = useState<string | null>(null);
  const [pinnedMessages, setPinnedMessages] = useState<PinnedMessage[]>([]);
  const [wallpaperStyle, setWallpaperStyle] = useState<React.CSSProperties>({});
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const messagesContainerRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
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

  // Wallpaper
  const updateWallpaper = () => {
    const wpId = localStorage.getItem('app-wallpaper') || 'none';
    const customWp = localStorage.getItem('app-wallpaper-custom') || '';
    if (wpId === 'custom' && customWp) {
      setWallpaperStyle({ backgroundImage: `url(${customWp})`, backgroundSize: 'cover', backgroundPosition: 'center' });
    } else {
      const wp = BUILTIN_WALLPAPERS.find(w => w.id === wpId);
      if (wp && wp.css) {
        setWallpaperStyle({ background: `${wp.css}`, backgroundSize: wp.size || 'auto' });
      } else {
        setWallpaperStyle({});
      }
    }
  };

  useEffect(() => {
    updateWallpaper();
    window.addEventListener('wallpaper-changed', updateWallpaper);
    return () => window.removeEventListener('wallpaper-changed', updateWallpaper);
  }, []);

  const scrollToBottom = () => {
    requestAnimationFrame(() => {
      if (messagesContainerRef.current) {
        messagesContainerRef.current.scrollTop = messagesContainerRef.current.scrollHeight;
      }
    });
  };

  // Mark as read
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

  // Load pinned messages
  const loadPinnedMessages = async () => {
    const { data } = await supabase
      .from('pinned_messages')
      .select('*')
      .eq('conversation_id', conversationId);
    if (data) setPinnedMessages(data as PinnedMessage[]);
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
        const { data: parts } = await supabase
          .from('conversation_participants')
          .select('user_id')
          .eq('conversation_id', conversationId);
        if (parts) {
          const ids = parts.map(p => p.user_id);
          const { data: profiles } = await supabase
            .from('profiles')
            .select('user_id, display_name, username, avatar_url')
            .in('user_id', ids);
          if (profiles) {
            const names = new Map<string, string>();
            const avatars = new Map<string, string | null>();
            for (const p of profiles) {
              names.set(p.user_id, p.display_name || p.username || 'Unknown');
              avatars.set(p.user_id, p.avatar_url);
            }
            setParticipantNames(names);
            setParticipantAvatars(avatars);
          }
        }
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
          .select('display_name, username, last_seen_at, avatar_url')
          .eq('user_id', data.user_id)
          .single();
        setPartnerName(profile?.display_name || profile?.username || 'Unknown');
        setPartnerLastSeen(profile?.last_seen_at || null);
        setPartnerAvatarUrl(profile?.avatar_url || null);
        const names = new Map<string, string>();
        const avatars = new Map<string, string | null>();
        names.set(data.user_id, profile?.display_name || profile?.username || 'Unknown');
        avatars.set(data.user_id, profile?.avatar_url || null);
        if (user) names.set(user.id, 'Вы');
        setParticipantNames(names);
        setParticipantAvatars(avatars);
      }
    };
    loadConvInfo();
    loadPinnedMessages();
  }, [conversationId, user]);

  // Realtime partner last_seen
  useEffect(() => {
    if (!partnerId || isGroup) return;
    const fetchLastSeen = async () => {
      const { data } = await supabase
        .from('profiles')
        .select('last_seen_at')
        .eq('user_id', partnerId)
        .single();
      if (data) setPartnerLastSeen(data.last_seen_at);
    };
    fetchLastSeen();
    const interval = setInterval(fetchLastSeen, 10000);
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
        setMessages(msgs as Message[]);
        markMessagesRead(msgs as Message[]);
      }
      if (deleted) setDeletedIds(new Set(deleted.map(d => d.message_id)));
      markRead();
      setTimeout(() => scrollToBottom(), 50);
      setTimeout(() => scrollToBottom(), 150);
      setTimeout(() => scrollToBottom(), 400);
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

  // Realtime pinned messages
  useEffect(() => {
    const channel = supabase
      .channel(`pins-${conversationId}`)
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'pinned_messages',
        filter: `conversation_id=eq.${conversationId}`,
      }, () => {
        loadPinnedMessages();
      })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [conversationId]);

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
          const isVideoCall = signal.signal_data?.isVideo || false;
          setIncomingCall({ type: isVideoCall ? 'video' : 'audio' });
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
    const replyId = replyTo?.id || null;
    setReplyTo(null);

    await supabase.from('messages').insert({
      conversation_id: conversationId,
      sender_id: user.id,
      content,
      message_type: 'text',
      reply_to_id: replyId,
    } as any);
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
    setReplyTo(null);
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

  const forwardMessage = async (msg: Message) => {
    const textToCopy = msg.content || msg.file_url || '';
    if (!textToCopy) { toast.error('Нечего копировать'); return; }
    try {
      await navigator.clipboard.writeText(textToCopy);
      toast.success(msg.file_url ? 'Ссылка на файл скопирована — вставьте в нужный чат' : 'Сообщение скопировано — вставьте в нужный чат');
    } catch { toast.error('Не удалось скопировать'); }
  };

  const startReply = (msg: Message) => {
    setReplyTo(msg);
    setEditingMessage(null);
    setTimeout(() => inputRef.current?.focus(), 50);
  };

  const cancelReply = () => { setReplyTo(null); };

  const downloadFile = async (url: string, filename: string) => {
    try {
      const response = await fetch(url);
      const blob = await response.blob();
      const link = document.createElement('a');
      link.href = URL.createObjectURL(blob);
      link.download = filename || 'download';
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(link.href);
    } catch { toast.error('Ошибка при скачивании'); }
  };

  const pinMessage = async (msgId: string) => {
    if (!user) return;
    await supabase.from('pinned_messages').insert({
      conversation_id: conversationId,
      message_id: msgId,
      pinned_by: user.id,
    } as any);
    toast.success('Сообщение закреплено');
    loadPinnedMessages();
  };

  const unpinMessage = async (msgId: string) => {
    await supabase.from('pinned_messages').delete()
      .eq('conversation_id', conversationId)
      .eq('message_id', msgId);
    toast.success('Сообщение откреплено');
    loadPinnedMessages();
  };

  const isPinned = (msgId: string) => pinnedMessages.some(p => p.message_id === msgId);

  const formatMessageTime = (isoString: string) => {
    const date = new Date(isoString);
    return `${date.getHours().toString().padStart(2, '0')}:${date.getMinutes().toString().padStart(2, '0')}`;
  };

  const formatDateSeparator = (isoString: string) => {
    const date = new Date(isoString);
    const now = new Date();
    const isToday = date.toDateString() === now.toDateString();
    const yesterday = new Date(now);
    yesterday.setDate(yesterday.getDate() - 1);
    const isYesterday = date.toDateString() === yesterday.toDateString();
    if (isToday) return 'Сегодня';
    if (isYesterday) return 'Вчера';
    return date.toLocaleDateString('ru', { day: 'numeric', month: 'long', year: date.getFullYear() !== now.getFullYear() ? 'numeric' : undefined });
  };

  const isOnline = partnerLastSeen ? (new Date().getTime() - new Date(partnerLastSeen).getTime()) < 120000 : false;

  const displayName = isGroup ? groupName : partnerName;
  const visibleMessages = messages.filter(m => !deletedIds.has(m.id) && !m.deleted_for_all);

  const getReplyMessage = (replyId: string | null | undefined): Message | undefined => {
    if (!replyId) return undefined;
    return messages.find(m => m.id === replyId);
  };

  const getSenderName = (senderId: string) => {
    if (senderId === user?.id) return 'Вы';
    return participantNames.get(senderId) || 'Unknown';
  };

  const scrollToMessage = (msgId: string) => {
    const el = document.getElementById(`msg-${msgId}`);
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      el.classList.add('bg-primary/10');
      setTimeout(() => el.classList.remove('bg-primary/10'), 1500);
    }
  };

  const needsDateSeparator = (index: number): boolean => {
    if (index === 0) return true;
    const prev = visibleMessages[index - 1];
    const curr = visibleMessages[index];
    return new Date(prev.created_at).toDateString() !== new Date(curr.created_at).toDateString();
  };

  // Get latest pinned message to show banner
  const latestPinned = pinnedMessages.length > 0
    ? messages.find(m => m.id === pinnedMessages[pinnedMessages.length - 1]?.message_id)
    : null;

  const renderMessage = (msg: Message, index: number) => {
    const isOwn = msg.sender_id === user?.id;
    const readers = readByMap.get(msg.id) || [];
    const isRead = isOwn && readers.length > 0;
    const repliedMsg = getReplyMessage(msg.reply_to_id);
    const showDateSep = needsDateSeparator(index);
    const pinned = isPinned(msg.id);

    return (
      <div key={msg.id}>
        {showDateSep && (
          <div className="flex justify-center my-3">
            <span className="text-[11px] text-muted-foreground bg-secondary/80 px-3 py-1 rounded-full">
              {formatDateSeparator(msg.created_at)}
            </span>
          </div>
        )}
        <ContextMenu>
          <ContextMenuTrigger>
            <div
              id={`msg-${msg.id}`}
              className={`flex transition-all duration-300 msg-animate ${isOwn ? 'justify-end' : 'justify-start'}`}
            >
              <div className={`max-w-[75%] rounded-2xl px-4 py-2 relative ${isOwn ? 'message-own rounded-br-md' : 'message-other rounded-bl-md'} ${pinned ? 'ring-1 ring-primary/30' : ''}`}>
                {pinned && (
                  <Pin className="absolute -top-1.5 -right-1.5 h-3.5 w-3.5 text-primary" />
                )}
                {isGroup && !isOwn && (
                  <p className="text-[11px] font-semibold mb-0.5" style={{ color: `hsl(${(msg.sender_id.charCodeAt(0) * 37) % 360}, 60%, 60%)` }}>
                    {getSenderName(msg.sender_id)}
                  </p>
                )}
                {repliedMsg && (
                  <div
                    className="mb-1.5 border-l-2 border-primary pl-2 py-1 cursor-pointer rounded-r bg-primary/5"
                    onClick={() => scrollToMessage(repliedMsg.id)}
                  >
                    <p className="text-[11px] font-medium text-primary">{getSenderName(repliedMsg.sender_id)}</p>
                    <p className="text-[11px] text-muted-foreground truncate max-w-[200px]">
                      {repliedMsg.message_type === 'text' ? repliedMsg.content : `📎 ${repliedMsg.file_name || repliedMsg.message_type}`}
                    </p>
                  </div>
                )}
                {msg.message_type === 'text' && (
                  <p className="text-sm text-foreground whitespace-pre-wrap break-words overflow-hidden" style={{ maxWidth: `${maxCharsPerLine}ch` }}>{msg.content}</p>
                )}
                {msg.message_type === 'image' && msg.file_url && (
                  <div className="relative group">
                    <img src={msg.file_url} alt={msg.file_name || 'image'} className="max-w-full rounded-lg cursor-pointer" onClick={() => setZoomImage(msg.file_url)} />
                    <Button variant="secondary" size="icon" className="absolute top-2 right-2 h-7 w-7 opacity-0 group-hover:opacity-100 transition-opacity" onClick={(e) => { e.stopPropagation(); downloadFile(msg.file_url!, msg.file_name || 'image.jpg'); }}>
                      <Download className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                )}
                {(msg.message_type === 'video' || msg.message_type === 'video_circle') && msg.file_url && (
                  <div className="relative group">
                    <video src={msg.file_url} controls className={`max-w-full ${msg.message_type === 'video_circle' ? 'rounded-full w-48 h-48 object-cover' : 'rounded-lg'}`} />
                    <Button variant="secondary" size="icon" className="absolute top-2 right-2 h-7 w-7 opacity-0 group-hover:opacity-100 transition-opacity" onClick={(e) => { e.stopPropagation(); downloadFile(msg.file_url!, msg.file_name || 'video.mp4'); }}>
                      <Download className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                )}
                {msg.message_type === 'voice' && msg.file_url && (
                  <audio src={msg.file_url} controls className="max-w-full" />
                )}
                {msg.message_type === 'file' && msg.file_url && (
                  <div className="flex items-center gap-2">
                    <a href={msg.file_url} target="_blank" rel="noreferrer" className="flex items-center gap-2 text-primary hover:underline flex-1 min-w-0">
                      <FileIcon className="h-4 w-4 shrink-0" />
                      <span className="text-sm truncate">{msg.file_name || 'Файл'}</span>
                    </a>
                    <Button variant="ghost" size="icon" className="h-6 w-6 shrink-0 text-muted-foreground hover:text-primary" onClick={() => downloadFile(msg.file_url!, msg.file_name || 'file')}>
                      <Download className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                )}
                <div className="flex items-center gap-1 mt-1 justify-end">
                  <p className="text-[10px] text-muted-foreground">{formatMessageTime(msg.created_at)}</p>
                  {msg.is_edited && <span className="text-[10px] text-muted-foreground italic">ред.</span>}
                  {isOwn && (isRead ? <CheckCheck className="h-3.5 w-3.5 text-primary" /> : <Check className="h-3.5 w-3.5 text-muted-foreground" />)}
                </div>
                <MessageReactions messageId={msg.id} />
              </div>
            </div>
          </ContextMenuTrigger>
          <ContextMenuContent className="bg-popover border-border">
            <ContextMenuItem onClick={() => startReply(msg)} className="gap-2">
              <Reply className="h-4 w-4" /> Ответить
            </ContextMenuItem>
            {msg.message_type === 'text' && msg.content && (
              <ContextMenuItem onClick={async () => {
                try { await navigator.clipboard.writeText(msg.content!); toast.success('Скопировано'); } catch { toast.error('Ошибка'); }
              }} className="gap-2">
                <Copy className="h-4 w-4" /> Копировать
              </ContextMenuItem>
            )}
            {isOwn && msg.message_type === 'text' && (
              <ContextMenuItem onClick={() => startEdit(msg)} className="gap-2">
                <Edit2 className="h-4 w-4" /> Редактировать
              </ContextMenuItem>
            )}
            {(msg.content || msg.file_url) && (
              <ContextMenuItem onClick={() => forwardMessage(msg)} className="gap-2">
                <Forward className="h-4 w-4" /> Переслать
              </ContextMenuItem>
            )}
            <ContextMenuSeparator />
            {isPinned(msg.id) ? (
              <ContextMenuItem onClick={() => unpinMessage(msg.id)} className="gap-2">
                <PinOff className="h-4 w-4" /> Открепить
              </ContextMenuItem>
            ) : (
              <ContextMenuItem onClick={() => pinMessage(msg.id)} className="gap-2">
                <Pin className="h-4 w-4" /> Закрепить
              </ContextMenuItem>
            )}
            <ContextMenuSeparator />
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
      </div>
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
    <div className="flex h-full flex-col bg-background chat-slide-in">
      {/* Header */}
      <div className="flex items-center gap-3 border-b border-border px-4 py-3">
        <Button variant="ghost" size="icon" onClick={onBack} className="md:hidden text-muted-foreground">
          <ArrowLeft className="h-5 w-5" />
        </Button>
        <div className="relative">
          <Avatar
            className="h-9 w-9 cursor-pointer"
            onClick={() => {
              const url = isGroup ? null : partnerAvatarUrl;
              if (url) setZoomImage(url);
            }}
          >
            {!isGroup && partnerAvatarUrl && <AvatarImage src={partnerAvatarUrl} />}
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
          {isGroup && <p className="text-xs text-muted-foreground">Группа</p>}
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
            <Button size="sm" onClick={acceptCall} className="gradient-primary text-primary-foreground rounded-full px-4">Ответить</Button>
            <Button size="sm" variant="destructive" onClick={rejectCall} className="rounded-full px-4">Отклонить</Button>
          </div>
        </div>
      )}

      {/* Pinned message banner */}
      {latestPinned && (
        <div
          className="flex items-center gap-2 border-b border-border bg-secondary/50 px-4 py-2 cursor-pointer hover:bg-secondary/80 transition-colors"
          onClick={() => scrollToMessage(latestPinned.id)}
        >
          <Pin className="h-4 w-4 text-primary shrink-0" />
          <div className="flex-1 min-w-0">
            <p className="text-[11px] font-medium text-primary">Закреплённое сообщение</p>
            <p className="text-xs text-muted-foreground truncate">
              {latestPinned.message_type === 'text' ? latestPinned.content : `📎 ${latestPinned.file_name || latestPinned.message_type}`}
            </p>
          </div>
          {pinnedMessages.length > 1 && (
            <span className="text-[10px] text-muted-foreground shrink-0">{pinnedMessages.length} закр.</span>
          )}
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

      {/* Reply bar */}
      {replyTo && !editingMessage && (
        <div className="flex items-center gap-2 border-b border-border bg-secondary px-4 py-2">
          <Reply className="h-4 w-4 text-primary shrink-0" />
          <div className="flex-1 min-w-0">
            <p className="text-xs font-medium text-primary">{getSenderName(replyTo.sender_id)}</p>
            <p className="text-xs text-muted-foreground truncate">{replyTo.content}</p>
          </div>
          <Button variant="ghost" size="icon" onClick={cancelReply} className="h-6 w-6">
            <X className="h-4 w-4" />
          </Button>
        </div>
      )}

      {/* Messages */}
      <div
        ref={messagesContainerRef}
        className="flex-1 overflow-y-auto px-4 py-4 space-y-2"
        style={{ minHeight: 0, ...wallpaperStyle }}
      >
        {visibleMessages.map((msg, i) => renderMessage(msg, i))}
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
          <input ref={fileInputRef} type="file" onChange={handleFileUpload} className="hidden" accept="image/*,video/*,.pdf,.doc,.docx,.txt,.zip" />
          <Button type="button" variant="ghost" size="icon" onClick={() => fileInputRef.current?.click()} disabled={uploading} className="text-muted-foreground hover:text-primary shrink-0">
            <Paperclip className="h-5 w-5" />
          </Button>
          <form onSubmit={sendMessage} className="flex flex-1 items-center gap-2">
            <input
              ref={inputRef}
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

      {/* Image zoom dialog */}
      <Dialog open={!!zoomImage} onOpenChange={(o) => !o && setZoomImage(null)}>
        <DialogContent className="bg-transparent border-none shadow-none max-w-[90vw] max-h-[90vh] p-0 flex items-center justify-center">
          {zoomImage && (
            <img src={zoomImage} alt="zoom" className="max-w-full max-h-[85vh] rounded-lg object-contain" onClick={() => setZoomImage(null)} />
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default ChatView;
