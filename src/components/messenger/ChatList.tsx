import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { Plus, LogOut, Search, Users, Edit2, Trash2, Settings, Minus as ZoomOut, Plus as ZoomIn } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Slider } from '@/components/ui/slider';
import NewChatDialog from './NewChatDialog';
import NewGroupDialog from './NewGroupDialog';
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from '@/components/ui/context-menu';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { toast } from 'sonner';

interface ChatItem {
  id: string;
  participantName: string;
  participantEmail: string;
  participantUserId?: string;
  lastMessage?: string;
  lastMessageAt?: string;
  isGroup?: boolean;
  unreadCount: number;
}

interface ChatListProps {
  selectedChat: string | null;
  onSelectChat: (id: string) => void;
}

const ChatList = ({ selectedChat, onSelectChat }: ChatListProps) => {
  const { user, signOut } = useAuth();
  const [chats, setChats] = useState<ChatItem[]>([]);
  const [showNewChat, setShowNewChat] = useState(false);
  const [showNewGroup, setShowNewGroup] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [search, setSearch] = useState('');
  const [renameDialog, setRenameDialog] = useState<{ open: boolean; userId: string; currentName: string }>({ open: false, userId: '', currentName: '' });
  const [nickname, setNickname] = useState('');
  const [scale, setScale] = useState(() => {
    const saved = localStorage.getItem('app-scale');
    return saved ? Number(saved) : 100;
  });
  const [maxChars, setMaxChars] = useState(() => {
    const saved = localStorage.getItem('msg-max-chars');
    return saved ? Number(saved) : 40;
  });

  // Apply scale
  useEffect(() => {
    document.documentElement.style.fontSize = `${scale}%`;
    localStorage.setItem('app-scale', String(scale));
  }, [scale]);

  // Save max chars
  useEffect(() => {
    localStorage.setItem('msg-max-chars', String(maxChars));
    window.dispatchEvent(new Event('msg-max-chars-changed'));
  }, [maxChars]);

  const loadChats = useCallback(async () => {
    if (!user) return;

    // Batch: get all participants, conversations, profiles, nicknames, and last messages in parallel
    const { data: myParts } = await supabase
      .from('conversation_participants')
      .select('conversation_id, last_read_at')
      .eq('user_id', user.id);

    if (!myParts?.length) { setChats([]); return; }

    const convIds = myParts.map(p => p.conversation_id);
    const lastReadMap = new Map(myParts.map(p => [p.conversation_id, p.last_read_at]));

    // Parallel batch queries
    const [convRes, allPartsRes, nicknamesRes, messagesRes] = await Promise.all([
      supabase.from('conversations').select('id, name, is_group').in('id', convIds),
      supabase.from('conversation_participants').select('conversation_id, user_id').in('conversation_id', convIds),
      supabase.from('contact_nicknames').select('contact_user_id, nickname').eq('user_id', user.id),
      supabase.from('messages').select('conversation_id, content, created_at, message_type, sender_id')
        .in('conversation_id', convIds)
        .order('created_at', { ascending: false }),
    ]);

    const conversations = convRes.data || [];
    const allParts = allPartsRes.data || [];
    const nicknameMap = new Map(nicknamesRes.data?.map(n => [n.contact_user_id, n.nickname]) || []);

    // Build last message per conversation
    const lastMsgMap = new Map<string, typeof messagesRes.data extends (infer T)[] ? T : never>();
    for (const msg of (messagesRes.data || [])) {
      if (!lastMsgMap.has(msg.conversation_id)) {
        lastMsgMap.set(msg.conversation_id, msg);
      }
    }

    // Collect unique other user IDs for profile lookup
    const otherUserIds = new Set<string>();
    const convPartsMap = new Map<string, string[]>();
    for (const p of allParts) {
      if (p.user_id !== user.id) otherUserIds.add(p.user_id);
      const arr = convPartsMap.get(p.conversation_id) || [];
      arr.push(p.user_id);
      convPartsMap.set(p.conversation_id, arr);
    }

    // Batch fetch profiles
    const profileMap = new Map<string, { display_name: string | null; username: string }>();
    if (otherUserIds.size > 0) {
      const { data: profiles } = await supabase
        .from('profiles')
        .select('user_id, display_name, username')
        .in('user_id', Array.from(otherUserIds));
      for (const p of (profiles || [])) {
        profileMap.set(p.user_id, p);
      }
    }

    // Count unread per conversation in one query
    // We'll compute it from messages data we already have
    const unreadMap = new Map<string, number>();
    for (const msg of (messagesRes.data || [])) {
      if (msg.sender_id === user.id) continue;
      const lastRead = lastReadMap.get(msg.conversation_id);
      if (lastRead && msg.created_at > lastRead) {
        unreadMap.set(msg.conversation_id, (unreadMap.get(msg.conversation_id) || 0) + 1);
      }
    }

    const convMap = new Map(conversations.map(c => [c.id, c]));

    const chatItems: ChatItem[] = convIds.map(convId => {
      const conv = convMap.get(convId);
      const isGroup = conv?.is_group || false;
      let name = 'Unknown';
      let email = '';
      let contactUserId = '';

      if (isGroup) {
        name = conv?.name || 'Группа';
      } else {
        const others = (convPartsMap.get(convId) || []).filter(id => id !== user.id);
        if (others.length > 0) {
          contactUserId = others[0];
          const customNick = nicknameMap.get(contactUserId);
          const profile = profileMap.get(contactUserId);
          name = customNick || profile?.display_name || profile?.username || 'Unknown';
          email = profile?.username || '';
        }
      }

      const lastMsg = lastMsgMap.get(convId);
      const lastMessage = lastMsg
        ? lastMsg.message_type !== 'text'
          ? `📎 ${lastMsg.message_type}`
          : lastMsg.content || ''
        : '';

      return {
        id: convId,
        participantName: name,
        participantEmail: email,
        participantUserId: contactUserId,
        lastMessage,
        lastMessageAt: lastMsg?.created_at,
        isGroup,
        unreadCount: unreadMap.get(convId) || 0,
      };
    }).filter(c => c.participantName !== 'Unknown' || c.isGroup);

    chatItems.sort((a, b) => {
      if (!a.lastMessageAt) return 1;
      if (!b.lastMessageAt) return -1;
      return new Date(b.lastMessageAt).getTime() - new Date(a.lastMessageAt).getTime();
    });

    setChats(chatItems);
  }, [user]);

  useEffect(() => { loadChats(); }, [loadChats]);

  useEffect(() => {
    const channel = supabase
      .channel('chat-list-updates')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages' }, () => {
        loadChats();
      })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [loadChats]);

  // When selecting a chat, immediately clear its unread badge
  const handleSelectChat = (chatId: string) => {
    setChats(prev => prev.map(c => c.id === chatId ? { ...c, unreadCount: 0 } : c));
    onSelectChat(chatId);
  };

  const clearChat = async (convId: string) => {
    const { data: msgs } = await supabase.from('messages').select('id').eq('conversation_id', convId);
    if (msgs?.length) {
      await supabase.from('deleted_messages').insert(msgs.map(m => ({ message_id: m.id, user_id: user!.id })));
    }
    toast.success('Чат очищен');
    loadChats();
  };

  const saveNickname = async () => {
    if (!nickname.trim()) return;
    const { error } = await supabase.from('contact_nicknames').upsert({
      user_id: user!.id,
      contact_user_id: renameDialog.userId,
      nickname: nickname.trim(),
    }, { onConflict: 'user_id,contact_user_id' });
    if (!error) { toast.success('Контакт переименован'); loadChats(); }
    setRenameDialog({ open: false, userId: '', currentName: '' });
    setNickname('');
  };

  const filteredChats = chats.filter(c =>
    c.participantName.toLowerCase().includes(search.toLowerCase()) ||
    c.participantEmail.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="flex h-full flex-col bg-sidebar">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-sidebar-border px-4 py-3">
        <h2 className="text-lg font-semibold text-foreground">Чаты</h2>
        <div className="flex gap-1">
          <Button variant="ghost" size="icon" onClick={() => setShowSettings(true)} className="text-muted-foreground hover:text-primary">
            <Settings className="h-5 w-5" />
          </Button>
          <Button variant="ghost" size="icon" onClick={() => setShowNewGroup(true)} className="text-muted-foreground hover:text-primary">
            <Users className="h-5 w-5" />
          </Button>
          <Button variant="ghost" size="icon" onClick={() => setShowNewChat(true)} className="text-muted-foreground hover:text-primary">
            <Plus className="h-5 w-5" />
          </Button>
          <Button variant="ghost" size="icon" onClick={signOut} className="text-muted-foreground hover:text-destructive">
            <LogOut className="h-5 w-5" />
          </Button>
        </div>
      </div>

      {/* Search */}
      <div className="px-3 py-2">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input placeholder="Поиск..." value={search} onChange={(e) => setSearch(e.target.value)} className="bg-secondary border-none pl-9 text-sm" />
        </div>
      </div>

      {/* Chat list */}
      <div className="flex-1 overflow-y-auto">
        {filteredChats.map((chat) => (
          <ContextMenu key={chat.id}>
            <ContextMenuTrigger>
              <button
                onClick={() => handleSelectChat(chat.id)}
                className={`flex w-full items-center gap-3 px-4 py-3 transition-colors hover:bg-sidebar-accent ${selectedChat === chat.id ? 'bg-sidebar-accent' : ''}`}
              >
                <Avatar className="h-10 w-10 shrink-0">
                  <AvatarFallback className="gradient-primary text-primary-foreground text-sm font-semibold">
                    {chat.isGroup ? '👥' : chat.participantName.charAt(0).toUpperCase()}
                  </AvatarFallback>
                </Avatar>
                <div className="min-w-0 flex-1 text-left">
                  <p className="truncate text-sm font-medium text-foreground">{chat.participantName}</p>
                  {chat.lastMessage && <p className="truncate text-xs text-muted-foreground">{chat.lastMessage}</p>}
                </div>
                {chat.unreadCount > 0 && (
                  <Badge className="shrink-0 h-5 min-w-[20px] px-1.5 text-[10px] font-bold">
                    {chat.unreadCount > 99 ? '99+' : chat.unreadCount}
                  </Badge>
                )}
              </button>
            </ContextMenuTrigger>
            <ContextMenuContent className="bg-popover border-border">
              {!chat.isGroup && chat.participantUserId && (
                <ContextMenuItem onClick={() => { setRenameDialog({ open: true, userId: chat.participantUserId!, currentName: chat.participantName }); setNickname(chat.participantName); }} className="gap-2">
                  <Edit2 className="h-4 w-4" /> Переименовать
                </ContextMenuItem>
              )}
              <ContextMenuItem onClick={() => clearChat(chat.id)} className="gap-2 text-destructive">
                <Trash2 className="h-4 w-4" /> Очистить чат
              </ContextMenuItem>
            </ContextMenuContent>
          </ContextMenu>
        ))}
        {filteredChats.length === 0 && (
          <div className="px-4 py-8 text-center text-sm text-muted-foreground">
            {chats.length === 0 ? 'Нет чатов. Создайте новый!' : 'Ничего не найдено'}
          </div>
        )}
      </div>

      <NewChatDialog open={showNewChat} onOpenChange={setShowNewChat} onChatCreated={(id) => { handleSelectChat(id); loadChats(); }} />
      <NewGroupDialog open={showNewGroup} onOpenChange={setShowNewGroup} onGroupCreated={(id) => { handleSelectChat(id); loadChats(); }} />

      {/* Rename dialog */}
      <Dialog open={renameDialog.open} onOpenChange={(o) => setRenameDialog(prev => ({ ...prev, open: o }))}>
        <DialogContent className="bg-card border-border sm:max-w-sm">
          <DialogHeader><DialogTitle className="text-foreground">Переименовать контакт</DialogTitle></DialogHeader>
          <Input value={nickname} onChange={(e) => setNickname(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && saveNickname()} placeholder="Новое имя" className="bg-secondary border-none" autoFocus />
          <Button onClick={saveNickname} className="gradient-primary text-primary-foreground">Сохранить</Button>
        </DialogContent>
      </Dialog>

      {/* Settings dialog */}
      <Dialog open={showSettings} onOpenChange={setShowSettings}>
        <DialogContent className="bg-card border-border sm:max-w-sm">
          <DialogHeader><DialogTitle className="text-foreground">Настройки</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div>
              <label className="text-sm font-medium text-foreground mb-2 block">Масштаб интерфейса: {scale}%</label>
              <div className="flex items-center gap-3">
                <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0" onClick={() => setScale(s => Math.max(70, s - 5))}>
                  <ZoomOut className="h-4 w-4" />
                </Button>
                <Slider value={[scale]} onValueChange={([v]) => setScale(v)} min={70} max={150} step={5} className="flex-1" />
                <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0" onClick={() => setScale(s => Math.min(150, s + 5))}>
                  <ZoomIn className="h-4 w-4" />
                </Button>
              </div>
            </div>
            <div>
              <label className="text-sm font-medium text-foreground mb-2 block">Символов в строке: {maxChars}</label>
              <div className="flex items-center gap-3">
                <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0" onClick={() => setMaxChars(s => Math.max(15, s - 5))}>
                  <ZoomOut className="h-4 w-4" />
                </Button>
                <Slider value={[maxChars]} onValueChange={([v]) => setMaxChars(v)} min={15} max={80} step={5} className="flex-1" />
                <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0" onClick={() => setMaxChars(s => Math.min(80, s + 5))}>
                  <ZoomIn className="h-4 w-4" />
                </Button>
              </div>
              <p className="text-xs text-muted-foreground mt-1">Ограничивает ширину текста сообщений (для длинных ссылок)</p>
            </div>
            <Button variant="outline" onClick={() => { setScale(100); setMaxChars(40); }} className="w-full">Сбросить всё</Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default ChatList;
