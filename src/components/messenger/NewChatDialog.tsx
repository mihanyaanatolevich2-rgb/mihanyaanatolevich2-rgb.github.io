import { useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';

interface NewChatDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onChatCreated: (conversationId: string) => void;
}

const NewChatDialog = ({ open, onOpenChange, onChatCreated }: NewChatDialogProps) => {
  const { user } = useAuth();
  const [email, setEmail] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return;

    const searchValue = email.trim();
    if (!searchValue) return;

    setError('');
    setLoading(true);

    // 1) Find target user by username (email) or display name
    let targetUserId: string | null = null;

    const { data: byUsername, error: byUsernameError } = await supabase
      .from('profiles')
      .select('user_id')
      .eq('username', searchValue)
      .maybeSingle();

    if (byUsernameError) {
      setError('Ошибка поиска пользователя');
      setLoading(false);
      return;
    }

    if (byUsername?.user_id) {
      targetUserId = byUsername.user_id;
    } else {
      const { data: byDisplayName, error: byDisplayNameError } = await supabase
        .from('profiles')
        .select('user_id')
        .ilike('display_name', `%${searchValue}%`)
        .limit(2);

      if (byDisplayNameError) {
        setError('Ошибка поиска пользователя');
        setLoading(false);
        return;
      }

      if (!byDisplayName || byDisplayName.length === 0) {
        setError('Пользователь не найден');
        setLoading(false);
        return;
      }

      if (byDisplayName.length > 1) {
        setError('Найдено несколько пользователей. Уточните email/ник.');
        setLoading(false);
        return;
      }

      targetUserId = byDisplayName[0].user_id;
    }

    if (targetUserId === user.id) {
      setError('Нельзя написать самому себе');
      setLoading(false);
      return;
    }

    // 2) Check if conversation already exists (single query)
    const { data: myConvs, error: myConvsError } = await supabase
      .from('conversation_participants')
      .select('conversation_id')
      .eq('user_id', user.id);

    if (myConvsError) {
      setError('Ошибка загрузки чатов');
      setLoading(false);
      return;
    }

    const myConversationIds = (myConvs ?? []).map((c) => c.conversation_id);

    if (myConversationIds.length > 0) {
      const { data: existingConv, error: existingConvError } = await supabase
        .from('conversation_participants')
        .select('conversation_id')
        .eq('user_id', targetUserId)
        .in('conversation_id', myConversationIds)
        .maybeSingle();

      if (existingConvError) {
        setError('Ошибка проверки существующего чата');
        setLoading(false);
        return;
      }

      if (existingConv) {
        onChatCreated(existingConv.conversation_id);
        onOpenChange(false);
        setEmail('');
        setLoading(false);
        return;
      }
    }

    // 3) Create new conversation without SELECT (avoid RLS failure on return=representation)
    const newConversationId = crypto.randomUUID();

    const { error: convError } = await supabase
      .from('conversations')
      .insert({ id: newConversationId });

    if (convError) {
      setError('Ошибка создания чата');
      setLoading(false);
      return;
    }

    // 4) Add participants step-by-step so policy checks pass reliably
    const { error: selfParticipantError } = await supabase
      .from('conversation_participants')
      .insert({ conversation_id: newConversationId, user_id: user.id });

    if (selfParticipantError) {
      setError('Ошибка добавления участника');
      setLoading(false);
      return;
    }

    const { error: targetParticipantError } = await supabase
      .from('conversation_participants')
      .insert({ conversation_id: newConversationId, user_id: targetUserId });

    if (targetParticipantError) {
      setError('Ошибка добавления собеседника');
      setLoading(false);
      return;
    }

    onChatCreated(newConversationId);
    onOpenChange(false);
    setEmail('');
    setLoading(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="bg-card border-border sm:max-w-sm">
        <DialogHeader>
          <DialogTitle className="text-foreground">Новый чат</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleCreate} className="space-y-4">
          <Input
            placeholder="Email, ник или имя собеседника"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            className="bg-secondary border-none"
          />
          {error && <p className="text-sm text-destructive">{error}</p>}
          <Button type="submit" className="w-full gradient-primary text-primary-foreground" disabled={loading}>
            {loading ? '...' : 'Начать чат'}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
};

export default NewChatDialog;
