import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { Plus, LogOut, Search, Users, MoreVertical, Trash2, Edit2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import NewChatDialog from './NewChatDialog';
import NewGroupDialog from './NewGroupDialog';
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
  const [search, setSearch] = useState('');
  const [renameDialog, setRenameDialog] = useState<{ open: boolean; userId: string; currentName: string }>({ open: false, userId: '', currentName: '' });
  const [nickname, setNickname] = useState('');

  const loadChats = async () => {
    if (!user) return;

    const { data: participants } = await supabase
      .from('conversation_participants')
      .select('conversation_id, last_read_at')
      .eq('user_id', user.id);

    if (!participants?.length) return;

    // Load nicknames
    const { data: nicknames } = await supabase
      .from('contact_nicknames')
      .select('contact_user_id, nickname')
      .eq('user_id', user.id);

    const nicknameMap = new Map(nicknames?.map(n => [n.contact_user_id, n.nickname]) || []);

    const chatItems: ChatItem[] = [];

    for (const part of participants) {
      const convId = part.conversation_id;
      const lastReadAt = part.last_read_at;

      const { data: conv } = await supabase
        .from('conversations')
        .select('name, is_group')
        .eq('id', convId)
        .single();

      let name = 'Unknown';
      let email = '';
      let contactUserId = '';
      const isGroup = conv?.is_group || false;

      if (isGroup) {
        name = conv?.name || 'Группа';
      } else {
        const { data: otherParticipants } = await supabase
          .from('conversation_participants')
          .select('user_id')
          .eq('conversation_id', convId)
          .neq('user_id', user.id);

        if (!otherParticipants?.length) continue;

        contactUserId = otherParticipants[0].user_id;
        const customNick = nicknameMap.get(contactUserId);

        const { data: profile } = await supabase
          .from('profiles')
          .select('display_name, username')
          .eq('user_id', contactUserId)
          .single();

        name = customNick || profile?.display_name || profile?.username || 'Unknown';
        email = profile?.username || '';
      }

      const { data: lastMsg } = await supabase
        .from('messages')
        .select('content, created_at, message_type')
        .eq('conversation_id', convId)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      // Count unread
      let unreadCount = 0;
      if (lastReadAt) {
        const { count } = await supabase
          .from('messages')
          .select('id', { count: 'exact', head: true })
          .eq('conversation_id', convId)
          .neq('sender_id', user.id)
          .gt('created_at', lastReadAt);
        unreadCount = count || 0;
      }

      chatItems.push({
        id: convId,
        participantName: name,
        participantEmail: email,
        participantUserId: contactUserId,
        lastMessage: lastMsg?.message_type !== 'text'
          ? lastMsg?.message_type === 'voice' ? '🎤 Голосовое'
            : lastMsg?.message_type === 'video_circle' ? '🔵 Видеокружок'
              : `📎 ${lastMsg?.message_type}`
          : lastMsg?.content || '',
        lastMessageAt: lastMsg?.created_at,
        isGroup,
        unreadCount,
      });
    }

    chatItems.sort((a, b) => {
      if (!a.lastMessageAt) return 1;
      if (!b.lastMessageAt) return -1;
      return new Date(b.lastMessageAt).getTime() - new Date(a.lastMessageAt).getTime();
    });

    setChats(chatItems);
  };

  useEffect(() => {
    loadChats();
  }, [user]);

  useEffect(() => {
    const channel = supabase
      .channel('chat-list-updates')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages' }, () => {
        loadChats();
      })
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [user]);

  // Clear chat (delete all messages for me)
  const clearChat = async (convId: string) => {
    const { data: msgs } = await supabase
      .from('messages')
      .select('id')
      .eq('conversation_id', convId);

    if (msgs?.length) {
      const inserts = msgs.map(m => ({ message_id: m.id, user_id: user!.id }));
      await supabase.from('deleted_messages').insert(inserts);
    }
    toast.success('Чат очищен');
    loadChats();
  };

  // Rename contact
  const saveNickname = async () => {
    if (!nickname.trim()) return;
    const { error } = await supabase
      .from('contact_nicknames')
      .upsert({
        user_id: user!.id,
        contact_user_id: renameDialog.userId,
        nickname: nickname.trim(),
      }, { onConflict: 'user_id,contact_user_id' });

    if (!error) {
      toast.success('Контакт переименован');
      loadChats();
    }
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
          <Input
            placeholder="Поиск..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="bg-secondary border-none pl-9 text-sm"
          />
        </div>
      </div>

      {/* Chat list */}
      <div className="flex-1 overflow-y-auto">
        {filteredChats.map((chat) => (
          <ContextMenu key={chat.id}>
            <ContextMenuTrigger>
              <button
                onClick={() => onSelectChat(chat.id)}
                className={`flex w-full items-center gap-3 px-4 py-3 transition-colors hover:bg-sidebar-accent ${
                  selectedChat === chat.id ? 'bg-sidebar-accent' : ''
                }`}
              >
                <Avatar className="h-10 w-10 shrink-0">
                  <AvatarFallback className="gradient-primary text-primary-foreground text-sm font-semibold">
                    {chat.isGroup ? '👥' : chat.participantName.charAt(0).toUpperCase()}
                  </AvatarFallback>
                </Avatar>
                <div className="min-w-0 flex-1 text-left">
                  <p className="truncate text-sm font-medium text-foreground">{chat.participantName}</p>
                  {chat.lastMessage && (
                    <p className="truncate text-xs text-muted-foreground">{chat.lastMessage}</p>
                  )}
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
                <ContextMenuItem
                  onClick={() => {
                    setRenameDialog({ open: true, userId: chat.participantUserId!, currentName: chat.participantName });
                    setNickname(chat.participantName);
                  }}
                  className="gap-2"
                >
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

      <NewChatDialog
        open={showNewChat}
        onOpenChange={setShowNewChat}
        onChatCreated={(id) => { onSelectChat(id); loadChats(); }}
      />
      <NewGroupDialog
        open={showNewGroup}
        onOpenChange={setShowNewGroup}
        onGroupCreated={(id) => { onSelectChat(id); loadChats(); }}
      />

      {/* Rename dialog */}
      <Dialog open={renameDialog.open} onOpenChange={(o) => setRenameDialog(prev => ({ ...prev, open: o }))}>
        <DialogContent className="bg-card border-border sm:max-w-sm">
          <DialogHeader>
            <DialogTitle className="text-foreground">Переименовать контакт</DialogTitle>
          </DialogHeader>
          <Input
            value={nickname}
            onChange={(e) => setNickname(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && saveNickname()}
            placeholder="Новое имя"
            className="bg-secondary border-none"
            autoFocus
          />
          <Button onClick={saveNickname} className="gradient-primary text-primary-foreground">
            Сохранить
          </Button>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default ChatList;
