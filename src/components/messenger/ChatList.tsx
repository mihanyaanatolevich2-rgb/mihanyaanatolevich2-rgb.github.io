import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { Plus, LogOut, Search } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import NewChatDialog from './NewChatDialog';

interface ChatItem {
  id: string;
  participantName: string;
  participantEmail: string;
  lastMessage?: string;
  lastMessageAt?: string;
}

interface ChatListProps {
  selectedChat: string | null;
  onSelectChat: (id: string) => void;
}

const ChatList = ({ selectedChat, onSelectChat }: ChatListProps) => {
  const { user, signOut } = useAuth();
  const [chats, setChats] = useState<ChatItem[]>([]);
  const [showNewChat, setShowNewChat] = useState(false);
  const [search, setSearch] = useState('');

  const loadChats = async () => {
    if (!user) return;

    const { data: participants } = await supabase
      .from('conversation_participants')
      .select('conversation_id')
      .eq('user_id', user.id);

    if (!participants?.length) return;

    const convIds = participants.map(p => p.conversation_id);
    const chatItems: ChatItem[] = [];

    for (const convId of convIds) {
      const { data: otherParticipants } = await supabase
        .from('conversation_participants')
        .select('user_id')
        .eq('conversation_id', convId)
        .neq('user_id', user.id);

      if (!otherParticipants?.length) continue;

      const { data: profile } = await supabase
        .from('profiles')
        .select('display_name, username')
        .eq('user_id', otherParticipants[0].user_id)
        .single();

      const { data: lastMsg } = await supabase
        .from('messages')
        .select('content, created_at, message_type')
        .eq('conversation_id', convId)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      chatItems.push({
        id: convId,
        participantName: profile?.display_name || profile?.username || 'Unknown',
        participantEmail: profile?.username || '',
        lastMessage: lastMsg?.message_type !== 'text' ? `📎 ${lastMsg?.message_type}` : lastMsg?.content || '',
        lastMessageAt: lastMsg?.created_at,
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

  // Realtime updates for new messages
  useEffect(() => {
    const channel = supabase
      .channel('chat-list-updates')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages' }, () => {
        loadChats();
      })
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [user]);

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
          <button
            key={chat.id}
            onClick={() => onSelectChat(chat.id)}
            className={`flex w-full items-center gap-3 px-4 py-3 transition-colors hover:bg-sidebar-accent ${
              selectedChat === chat.id ? 'bg-sidebar-accent' : ''
            }`}
          >
            <Avatar className="h-10 w-10 shrink-0">
              <AvatarFallback className="gradient-primary text-primary-foreground text-sm font-semibold">
                {chat.participantName.charAt(0).toUpperCase()}
              </AvatarFallback>
            </Avatar>
            <div className="min-w-0 flex-1 text-left">
              <p className="truncate text-sm font-medium text-foreground">{chat.participantName}</p>
              {chat.lastMessage && (
                <p className="truncate text-xs text-muted-foreground">{chat.lastMessage}</p>
              )}
            </div>
          </button>
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
    </div>
  );
};

export default ChatList;
