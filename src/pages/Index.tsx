import { useState, useEffect } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/integrations/supabase/client';
import Auth from './Auth';
import ChatList from '@/components/messenger/ChatList';
import ChatView from '@/components/messenger/ChatView';
import { MessageSquare } from 'lucide-react';

const Index = () => {
  const { user, loading } = useAuth();
  const [selectedChat, setSelectedChat] = useState<string | null>(null);

  // Global heartbeat for online status
  useEffect(() => {
    if (!user) return;
    const update = () => supabase.rpc('update_last_seen');
    update();
    const interval = setInterval(update, 15000);
    return () => clearInterval(interval);
  }, [user]);

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
      </div>
    );
  }

  if (!user) return <Auth />;

  return (
    <div className="flex h-screen overflow-hidden bg-background">
      {/* Sidebar - chat list */}
      <div className={`w-full md:w-80 lg:w-96 border-r border-border shrink-0 ${selectedChat ? 'hidden md:flex md:flex-col' : 'flex flex-col'}`}>
        <ChatList selectedChat={selectedChat} onSelectChat={setSelectedChat} />
      </div>

      {/* Main - chat view */}
      <div className={`flex-1 ${selectedChat ? 'flex flex-col' : 'hidden md:flex md:flex-col'}`}>
        {selectedChat ? (
          <ChatView conversationId={selectedChat} onBack={() => setSelectedChat(null)} />
        ) : (
          <div className="flex flex-1 flex-col items-center justify-center text-center">
            <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-2xl gradient-primary shadow-glow">
              <MessageSquare className="h-8 w-8 text-primary-foreground" />
            </div>
            <h2 className="text-xl font-semibold text-foreground">Выберите чат</h2>
            <p className="mt-1 text-sm text-muted-foreground">или создайте новый</p>
          </div>
        )}
      </div>
    </div>
  );
};

export default Index;
