import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { SmilePlus } from 'lucide-react';

const EMOJI_LIST = ['👍', '❤️', '😂', '😮', '😢', '🔥'];

interface Reaction {
  emoji: string;
  count: number;
  mine: boolean;
}

interface MessageReactionsProps {
  messageId: string;
}

const MessageReactions = ({ messageId }: MessageReactionsProps) => {
  const { user } = useAuth();
  const [reactions, setReactions] = useState<Reaction[]>([]);
  const [showPicker, setShowPicker] = useState(false);

  const loadReactions = async () => {
    const { data } = await supabase
      .from('message_reactions')
      .select('emoji, user_id')
      .eq('message_id', messageId);

    if (!data) return;

    const map = new Map<string, { count: number; mine: boolean }>();
    data.forEach((r) => {
      const existing = map.get(r.emoji) || { count: 0, mine: false };
      existing.count++;
      if (r.user_id === user?.id) existing.mine = true;
      map.set(r.emoji, existing);
    });

    setReactions(
      Array.from(map.entries()).map(([emoji, v]) => ({ emoji, ...v }))
    );
  };

  useEffect(() => {
    loadReactions();
  }, [messageId]);

  useEffect(() => {
    const channel = supabase
      .channel(`reactions-${messageId}`)
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'message_reactions',
        filter: `message_id=eq.${messageId}`,
      }, () => loadReactions())
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [messageId]);

  const toggleReaction = async (emoji: string) => {
    if (!user) return;
    setShowPicker(false);

    const existing = reactions.find(r => r.emoji === emoji && r.mine);
    if (existing) {
      await supabase
        .from('message_reactions')
        .delete()
        .eq('message_id', messageId)
        .eq('user_id', user.id)
        .eq('emoji', emoji);
    } else {
      await supabase
        .from('message_reactions')
        .insert({ message_id: messageId, user_id: user.id, emoji });
    }
  };

  return (
    <div className="flex items-center gap-1 mt-1 flex-wrap">
      {reactions.map((r) => (
        <button
          key={r.emoji}
          onClick={() => toggleReaction(r.emoji)}
          className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs transition-colors ${
            r.mine
              ? 'bg-primary/20 border border-primary/40'
              : 'bg-secondary border border-border hover:bg-secondary/80'
          }`}
        >
          <span>{r.emoji}</span>
          <span className="text-muted-foreground">{r.count}</span>
        </button>
      ))}
      <div className="relative">
        <button
          onClick={() => setShowPicker(!showPicker)}
          className="inline-flex h-5 w-5 items-center justify-center rounded-full text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors"
        >
          <SmilePlus className="h-3 w-3" />
        </button>
        {showPicker && (
          <div className="absolute bottom-full left-0 mb-1 flex gap-1 rounded-lg bg-popover border border-border p-1.5 shadow-lg z-50">
            {EMOJI_LIST.map((emoji) => (
              <button
                key={emoji}
                onClick={() => toggleReaction(emoji)}
                className="h-7 w-7 rounded hover:bg-secondary flex items-center justify-center text-sm transition-colors"
              >
                {emoji}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

export default MessageReactions;
