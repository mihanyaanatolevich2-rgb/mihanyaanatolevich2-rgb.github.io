import { useState, useEffect, useRef, useMemo } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { Send, Paperclip, Phone, Video, ArrowLeft, FileIcon, Edit2, Trash2, TrashIcon, X, Check, CheckCheck, Reply, Download, Forward, Copy, Pin, PinOff, MessageCircle, Lock } from 'lucide-react';
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
import GroupInfoDialog from './GroupInfoDialog';
import AudioMessage from './AudioMessage';

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

interface ChannelComment {
  id: string;
  message_id: string;
  conversation_id: string;
  user_id: string;
  content: string;
  created_at: string;
}

interface ChatViewProps {
  conversationId: string;
  onBack: () => void;
}

const BUILTIN_WALLPAPERS = [
  { id: 'none', css: (_c: string) => '', size: '' },
  { id: 'dots', css: (c: string) => `radial-gradient(circle, hsl(${c || 'var(--muted-foreground)'} / 0.12) 1px, transparent 1px)`, size: '20px 20px' },
  { id: 'grid', css: (c: string) => `linear-gradient(hsl(${c || 'var(--muted-foreground)'} / 0.08) 1px, transparent 1px), linear-gradient(90deg, hsl(${c || 'var(--muted-foreground)'} / 0.08) 1px, transparent 1px)`, size: '24px 24px' },
  { id: 'diagonal', css: (c: string) => `repeating-linear-gradient(45deg, transparent, transparent 10px, hsl(${c || 'var(--muted-foreground)'} / 0.06) 10px, hsl(${c || 'var(--muted-foreground)'} / 0.06) 11px)`, size: 'auto' },
  { id: 'bubbles', css: (c: string) => `radial-gradient(circle at 20% 80%, hsl(${c || 'var(--primary)'} / 0.08) 0%, transparent 50%), radial-gradient(circle at 80% 20%, hsl(${c || 'var(--primary)'} / 0.1) 0%, transparent 50%), radial-gradient(circle at 50% 50%, hsl(${c || 'var(--primary)'} / 0.04) 0%, transparent 70%)`, size: 'auto' },
  { id: 'waves', css: (c: string) => `repeating-linear-gradient(135deg, transparent, transparent 20px, hsl(${c || 'var(--primary)'} / 0.06) 20px, hsl(${c || 'var(--primary)'} / 0.06) 40px)`, size: 'auto' },
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
  const [isChannel, setIsChannel] = useState(false);
  const [channelVisibility, setChannelVisibility] = useState<'public' | 'private' | null>(null);
  const [canPostInChannel, setCanPostInChannel] = useState(true);
  const [groupAvatarUrl, setGroupAvatarUrl] = useState<string | null>(null);
  const [showGroupInfo, setShowGroupInfo] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [callType, setCallType] = useState<'audio' | 'video' | null>(null);
  const [isCaller, setIsCaller] = useState(false);
  const [incomingCall, setIncomingCall] = useState<{ type: 'audio' | 'video'; callId: string } | null>(null);
  const [activeCallId, setActiveCallId] = useState<string | null>(null);
  const [editingMessage, setEditingMessage] = useState<Message | null>(null);
  const [editText, setEditText] = useState('');
  const [replyTo, setReplyTo] = useState<Message | null>(null);
  const [readByMap, setReadByMap] = useState<Map<string, string[]>>(new Map());
  const [participantNames, setParticipantNames] = useState<Map<string, string>>(new Map());
  const [participantAvatars, setParticipantAvatars] = useState<Map<string, string | null>>(new Map());
  const [zoomImage, setZoomImage] = useState<string | null>(null);
  const [zoomScale, setZoomScale] = useState(1);
  const [zoomPos, setZoomPos] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });
  const [pinnedMessages, setPinnedMessages] = useState<PinnedMessage[]>([]);
  const [commentsByMessage, setCommentsByMessage] = useState<Map<string, ChannelComment[]>>(new Map());
  const [openComments, setOpenComments] = useState<Set<string>>(new Set());
  const [commentInputs, setCommentInputs] = useState<Record<string, string>>({});
  const [wallpaperStyle, setWallpaperStyle] = useState<React.CSSProperties>({});
  const [isExiting, setIsExiting] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const messagesContainerRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const pendingCallStreamRef = useRef<MediaStream | null>(null);
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
    const wpColor = localStorage.getItem('app-wallpaper-color') || '';
    if (wpId === 'custom' && customWp) {
      setWallpaperStyle({ backgroundImage: `url(${customWp})`, backgroundSize: 'cover', backgroundPosition: 'center' });
    } else {
      const wp = BUILTIN_WALLPAPERS.find(w => w.id === wpId);
      if (wp) {
        const cssVal = wp.css(wpColor);
        if (cssVal) {
          setWallpaperStyle({ background: `${cssVal}`, backgroundSize: wp.size || 'auto' });
        } else {
          setWallpaperStyle({});
        }
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

  const loadComments = async () => {
    const { data } = await (supabase.from as any)('channel_comments')
      .select('*')
      .eq('conversation_id', conversationId)
      .order('created_at', { ascending: true });
    const map = new Map<string, ChannelComment[]>();
    for (const comment of (data || []) as ChannelComment[]) {
      const arr = map.get(comment.message_id) || [];
      arr.push(comment);
      map.set(comment.message_id, arr);
    }
    setCommentsByMessage(map);
  };

  // Load conversation info
  useEffect(() => {
    const loadConvInfo = async () => {
      if (!user) return;

      const { data: conv } = await (supabase.from as any)('conversations')
        .select('name, is_group, is_channel, channel_visibility, avatar_url, created_by')
        .eq('id', conversationId)
        .single();

      const channel = Boolean((conv as any)?.is_channel);
      setIsChannel(channel);
      setChannelVisibility(((conv as any)?.channel_visibility || null) as 'public' | 'private' | null);

      if (channel) {
        setCanPostInChannel((conv as any)?.created_by === user.id);
      } else {
        setCanPostInChannel(true);
      }

      if (conv?.is_group) {
        setIsGroup(true);
        setGroupName(conv.name || (channel ? 'Канал' : 'Группа'));
        setGroupAvatarUrl((conv as any).avatar_url || null);
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
      setGroupName('');
      setGroupAvatarUrl(null);
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
    loadComments();
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
        setMessages(prev => {
          // Deduplicate: if already present (from optimistic insert), replace temp
          if (prev.some(m => m.id === newMsg.id)) return prev;
          // Also replace any temp message with matching content/time
          const tempIdx = prev.findIndex(m => m.id.startsWith('temp-') && m.content === newMsg.content && m.sender_id === newMsg.sender_id);
          if (tempIdx >= 0) {
            const copy = [...prev];
            copy[tempIdx] = newMsg;
            return copy;
          }
          return [...prev, newMsg];
        });
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

  // Realtime channel comments
  useEffect(() => {
    const channel = supabase
      .channel(`channel-comments-${conversationId}`)
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'channel_comments',
        filter: `conversation_id=eq.${conversationId}`,
      }, () => {
        loadComments();
      })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [conversationId]);

  // Realtime: conversation name/avatar updates
  useEffect(() => {
    if (!conversationId) return;
    const channel = supabase
      .channel(`conv-${conversationId}`)
      .on('postgres_changes', {
        event: 'UPDATE',
        schema: 'public',
        table: 'conversations',
        filter: `id=eq.${conversationId}`,
      }, (payload) => {
        const n = payload.new as any;
        if (n.is_group) {
          if (typeof n.name === 'string') setGroupName(n.name || 'Группа');
          setGroupAvatarUrl(n.avatar_url || null);
        }
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
          setIncomingCall({ type: isVideoCall ? 'video' : 'audio', callId: signal.call_id });
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
    if (isChannel && !canPostInChannel) {
      toast.error('В канале публиковать может только создатель или админ');
      return;
    }

    const content = input.trim();
    setInput('');
    const replyId = replyTo?.id || null;
    setReplyTo(null);

    // Optimistic: show message instantly
    const tempId = `temp-${Date.now()}`;
    const optimisticMsg: Message = {
      id: tempId,
      sender_id: user.id,
      content,
      message_type: 'text',
      file_url: null,
      file_name: null,
      created_at: new Date().toISOString(),
      reply_to_id: replyId,
    };
    setMessages(prev => [...prev, optimisticMsg]);

    const { data } = await supabase.from('messages').insert({
      conversation_id: conversationId,
      sender_id: user.id,
      content,
      message_type: 'text',
      reply_to_id: replyId,
    } as any).select().single();

    // Replace temp message with real one (realtime may also fire, dedup below)
    if (data) {
      setMessages(prev => prev.map(m => m.id === tempId ? (data as Message) : m));
    }
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    if (files.length === 0 || !user) return;
    if (isChannel && !canPostInChannel) {
      toast.error('В канале публиковать может только создатель или админ');
      if (fileInputRef.current) fileInputRef.current.value = '';
      return;
    }

    setUploading(true);

    const uploadOne = async (file: File, idx: number) => {
      const ext = file.name.split('.').pop();
      const lowerName = file.name.toLowerCase();
      const audioExtensions = ['.mp3', '.wav', '.ogg', '.oga', '.webm', '.m4a', '.aac', '.flac', '.opus'];
      const path = `${user.id}/${Date.now()}-${idx}-${Math.random().toString(36).slice(2, 8)}.${ext}`;

      const { error } = await supabase.storage.from('chat-media').upload(path, file);
      if (error) return null;

      const { data: urlData } = supabase.storage.from('chat-media').getPublicUrl(path);

      let messageType = 'file';
      if (file.type.startsWith('image/')) messageType = 'image';
      else if (file.type.startsWith('audio/') || audioExtensions.some(audioExt => lowerName.endsWith(audioExt))) messageType = 'audio';
      else if (file.type.startsWith('video/')) messageType = 'video';

      return {
        conversation_id: conversationId,
        sender_id: user.id,
        message_type: messageType,
        file_url: urlData.publicUrl,
        file_name: file.name,
      };
    };

    // Параллельно грузим все файлы, потом одним батчем вставляем сообщения
    const rows = (await Promise.all(files.map(uploadOne))).filter(Boolean) as any[];
    if (rows.length > 0) {
      await supabase.from('messages').insert(rows);
    }

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

  const sendComment = async (messageId: string) => {
    const text = (commentInputs[messageId] || '').trim();
    if (!text || !user) return;
    const { error } = await (supabase.from as any)('channel_comments').insert({
      message_id: messageId,
      conversation_id: conversationId,
      user_id: user.id,
      content: text,
    });
    if (error) {
      toast.error('Комментарий не отправлен');
      return;
    }
    setCommentInputs(prev => ({ ...prev, [messageId]: '' }));
    setOpenComments(prev => new Set([...prev, messageId]));
    loadComments();
  };

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
  const visibleMessages = useMemo(
    () => messages.filter(m => !deletedIds.has(m.id) && !m.deleted_for_all),
    [messages, deletedIds]
  );
  const messagesById = useMemo(() => {
    const m = new Map<string, Message>();
    for (const msg of messages) m.set(msg.id, msg);
    return m;
  }, [messages]);

  const getReplyMessage = (replyId: string | null | undefined): Message | undefined => {
    if (!replyId) return undefined;
    return messagesById.get(replyId);
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
    const comments = commentsByMessage.get(msg.id) || [];
    const commentsOpen = openComments.has(msg.id);

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
              className={`flex ${isOwn ? 'justify-end' : 'justify-start'}`}
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
                  <div className="relative">
                    <img src={msg.file_url} alt={msg.file_name || 'image'} className="rounded-lg cursor-pointer object-cover" style={{ maxWidth: '240px', maxHeight: '240px' }} onClick={() => setZoomImage(msg.file_url)} />
                  </div>
                )}
                {(msg.message_type === 'video' || msg.message_type === 'video_circle') && msg.file_url && (
                  <div className="relative">
                    <video src={msg.file_url} controls className={`max-w-full ${msg.message_type === 'video_circle' ? 'rounded-full w-48 h-48 object-cover' : 'rounded-lg'}`} />
                  </div>
                )}
                {(msg.message_type === 'voice' || msg.message_type === 'audio') && msg.file_url && (
                  <AudioMessage url={msg.file_url} fileName={msg.file_name} />
                )}
                {msg.message_type === 'file' && msg.file_url && (
                  <div className="flex items-center gap-2">
                    <a href={msg.file_url} target="_blank" rel="noreferrer" className="flex items-center gap-2 text-primary hover:underline flex-1 min-w-0">
                      <FileIcon className="h-4 w-4 shrink-0" />
                      <span className="text-sm truncate">{msg.file_name || 'Файл'}</span>
                    </a>
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
            {!isChannel && (
              <ContextMenuItem onClick={() => startReply(msg)} className="gap-2">
                <Reply className="h-4 w-4" /> Ответить
              </ContextMenuItem>
            )}
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
            {msg.file_url && (
              <ContextMenuItem onClick={() => downloadFile(msg.file_url!, msg.file_name || msg.message_type)} className="gap-2">
                <Download className="h-4 w-4" /> Скачать
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
        {isChannel && (
          <div className={`mt-1 flex ${isOwn ? 'justify-end' : 'justify-start'}`}>
            <div className="w-[min(75%,28rem)] rounded-xl bg-secondary/45 px-3 py-2">
              <button
                type="button"
                onClick={() => setOpenComments(prev => {
                  const next = new Set(prev);
                  if (next.has(msg.id)) next.delete(msg.id);
                  else next.add(msg.id);
                  return next;
                })}
                className="flex w-full items-center gap-2 text-xs text-muted-foreground hover:text-primary transition-colors"
              >
                <MessageCircle className="h-3.5 w-3.5" />
                {comments.length ? `${comments.length} комментариев` : 'Комментировать'}
              </button>
              {commentsOpen && (
                <div className="mt-2 space-y-2">
                  {comments.map(comment => (
                    <div key={comment.id} className="rounded-lg bg-background/60 px-2 py-1.5">
                      <p className="text-[11px] font-medium text-primary">{getSenderName(comment.user_id)}</p>
                      <p className="text-xs text-foreground whitespace-pre-wrap break-words">{comment.content}</p>
                    </div>
                  ))}
                  <div className="flex items-center gap-2">
                    <input
                      value={commentInputs[msg.id] || ''}
                      onChange={(e) => setCommentInputs(prev => ({ ...prev, [msg.id]: e.target.value }))}
                      onKeyDown={(e) => e.key === 'Enter' && sendComment(msg.id)}
                      placeholder="Комментарий..."
                      className="min-w-0 flex-1 rounded-lg bg-background px-3 py-1.5 text-xs text-foreground placeholder:text-muted-foreground outline-none focus:ring-1 focus:ring-primary"
                    />
                    <Button type="button" size="icon" className="h-7 w-7 shrink-0" disabled={!commentInputs[msg.id]?.trim()} onClick={() => sendComment(msg.id)}>
                      <Send className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    );
  };

  const getCallStream = async (type: 'audio' | 'video') => {
    try {
      return await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
        video: type === 'video',
      });
    } catch (error) {
      if (type === 'video') {
        toast.error('Камера недоступна, включаю аудиозвонок');
        return navigator.mediaDevices.getUserMedia({
          audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
          video: false,
        });
      }
      toast.error('Разрешите доступ к микрофону для звонка');
      throw error;
    }
  };

  const startCall = async (type: 'audio' | 'video') => {
    try {
      pendingCallStreamRef.current = await getCallStream(type);
      setActiveCallId(crypto.randomUUID());
      setIsCaller(true);
      setCallType(type);
    } catch {
      pendingCallStreamRef.current = null;
    }
  };

  const acceptCall = async () => {
    if (!incomingCall) return;
    try {
      pendingCallStreamRef.current = await getCallStream(incomingCall.type);
      setActiveCallId(incomingCall.callId);
      setIsCaller(false);
      setCallType(incomingCall.type);
      setIncomingCall(null);
    } catch {
      pendingCallStreamRef.current = null;
    }
  };

  const rejectCall = async () => {
    if (incomingCall && user && partnerId) {
      await supabase.from('call_signals').insert({
        conversation_id: conversationId,
        sender_id: user.id,
        receiver_id: partnerId,
        signal_type: 'hang-up',
        call_id: incomingCall.callId,
        signal_data: {},
      } as any);
    }
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
        callId={activeCallId}
        initialStream={pendingCallStreamRef.current}
        onEnd={() => { pendingCallStreamRef.current = null; setCallType(null); setIsCaller(false); setActiveCallId(null); }}
      />
    );
  }

  return (
    <div className={`flex h-full flex-col bg-background ${isExiting ? 'chat-slide-out' : 'chat-slide-in'}`}>
      {/* Header */}
      <div className="flex items-center gap-3 border-b border-border px-4 py-3">
        <Button variant="ghost" size="icon" onClick={() => {
          setIsExiting(true);
          setTimeout(() => onBack(), 250);
        }} className="md:hidden text-muted-foreground">
          <ArrowLeft className="h-5 w-5" />
        </Button>
        <div className="relative">
          <Avatar
            className="h-9 w-9 cursor-pointer"
            onClick={() => {
              if (isGroup) {
                if (groupAvatarUrl) setZoomImage(groupAvatarUrl);
                else setShowGroupInfo(true);
                return;
              }
              if (partnerAvatarUrl) setZoomImage(partnerAvatarUrl);
            }}
          >
            {!isGroup && partnerAvatarUrl && <AvatarImage src={partnerAvatarUrl} />}
            {isGroup && groupAvatarUrl && <AvatarImage src={groupAvatarUrl} />}
            <AvatarFallback className="gradient-primary text-primary-foreground text-sm font-semibold">
              {displayName.charAt(0).toUpperCase()}
            </AvatarFallback>
          </Avatar>
          {!isGroup && isOnline && (
            <span className="absolute bottom-0 right-0 h-2.5 w-2.5 rounded-full bg-[hsl(var(--online))] border-2 border-background" />
          )}
        </div>
        <button
          type="button"
          onClick={() => isGroup && setShowGroupInfo(true)}
          className={`flex-1 text-left ${isGroup ? 'cursor-pointer hover:opacity-80 transition-opacity' : 'cursor-default'}`}
        >
          <p className="text-sm font-semibold text-foreground">{displayName}</p>
          {isGroup && <p className="text-xs text-muted-foreground">Нажмите для информации</p>}
        </button>
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
          <input ref={fileInputRef} type="file" multiple onChange={handleFileUpload} className="hidden" accept="image/*,video/*,audio/*,.pdf,.doc,.docx,.txt,.zip" />
          <Button type="button" variant="ghost" size="icon" onClick={() => fileInputRef.current?.click()} disabled={uploading} className="text-muted-foreground hover:text-primary shrink-0">
            <Paperclip className="h-5 w-5" />
          </Button>
          <form onSubmit={sendMessage} className="flex flex-1 items-center gap-2 min-w-0">
            <input
              ref={inputRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder={uploading ? 'Загрузка файла...' : 'Сообщение...'}
              disabled={uploading}
              className="min-w-0 flex-1 rounded-xl bg-secondary px-4 py-2 text-sm text-foreground placeholder:text-muted-foreground outline-none focus:ring-1 focus:ring-primary"
            />
            <Button type="submit" size="icon" disabled={!input.trim()} className="gradient-primary text-primary-foreground shrink-0 rounded-xl">
              <Send className="h-4 w-4" />
            </Button>
          </form>
        </div>
      )}

      {/* Image zoom dialog */}
      <Dialog open={!!zoomImage} onOpenChange={(o) => { if (!o) { setZoomImage(null); setZoomScale(1); setZoomPos({ x: 0, y: 0 }); } }}>
        <DialogContent className="bg-black/90 border-none shadow-none max-w-[100vw] max-h-[100vh] w-screen h-screen p-0 flex items-center justify-center overflow-hidden"
          onWheel={(e) => {
            e.preventDefault();
            setZoomScale(prev => Math.min(5, Math.max(1, prev + (e.deltaY > 0 ? -0.3 : 0.3))));
          }}
          onDoubleClick={() => {
            if (zoomScale > 1) { setZoomScale(1); setZoomPos({ x: 0, y: 0 }); }
            else setZoomScale(2.5);
          }}
          onMouseDown={(e) => { if (zoomScale > 1) { setIsDragging(true); setDragStart({ x: e.clientX - zoomPos.x, y: e.clientY - zoomPos.y }); } }}
          onMouseMove={(e) => { if (isDragging) setZoomPos({ x: e.clientX - dragStart.x, y: e.clientY - dragStart.y }); }}
          onMouseUp={() => setIsDragging(false)}
          onMouseLeave={() => setIsDragging(false)}
          onTouchStart={(e) => {
            if (e.touches.length === 1 && zoomScale > 1) {
              setIsDragging(true);
              setDragStart({ x: e.touches[0].clientX - zoomPos.x, y: e.touches[0].clientY - zoomPos.y });
            }
          }}
          onTouchMove={(e) => {
            if (e.touches.length === 2) {
              const dist = Math.hypot(e.touches[0].clientX - e.touches[1].clientX, e.touches[0].clientY - e.touches[1].clientY);
              const prev = (e.target as any).__lastPinchDist || dist;
              (e.target as any).__lastPinchDist = dist;
              setZoomScale(s => Math.min(5, Math.max(1, s * (dist / prev))));
            } else if (isDragging && e.touches.length === 1) {
              setZoomPos({ x: e.touches[0].clientX - dragStart.x, y: e.touches[0].clientY - dragStart.y });
            }
          }}
          onTouchEnd={(e) => { if (e.touches.length < 2) { (e.target as any).__lastPinchDist = undefined; } setIsDragging(false); }}
        >
          {zoomImage && (
            <img
              src={zoomImage}
              alt="zoom"
              className="max-w-full max-h-[85vh] rounded-lg object-contain select-none"
              style={{
                transform: `translate(${zoomPos.x}px, ${zoomPos.y}px) scale(${zoomScale})`,
                transition: isDragging ? 'none' : 'transform 0.2s ease-out',
                cursor: zoomScale > 1 ? 'grab' : 'zoom-in',
              }}
              draggable={false}
              onClick={() => { if (zoomScale <= 1) { setZoomImage(null); setZoomScale(1); setZoomPos({ x: 0, y: 0 }); } }}
            />
          )}
        </DialogContent>
      </Dialog>

      {isGroup && (
        <GroupInfoDialog
          open={showGroupInfo}
          onOpenChange={setShowGroupInfo}
          conversationId={conversationId}
        />
      )}
    </div>
  );
};

export default ChatView;
