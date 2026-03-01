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
    setError('');
    setLoading(true);

    // Find user by email/username
    const { data: targetProfile } = await supabase
      .from('profiles')
      .select('user_id')
      .eq('username', email.trim())
      .maybeSingle();

    if (!targetProfile) {
      setError('Пользователь не найден');
      setLoading(false);
      return;
    }

    if (targetProfile.user_id === user.id) {
      setError('Нельзя написать самому себе');
      setLoading(false);
      return;
    }

    // Check if conversation already exists
    const { data: myConvs } = await supabase
      .from('conversation_participants')
      .select('conversation_id')
      .eq('user_id', user.id);

    if (myConvs) {
      for (const conv of myConvs) {
        const { data: otherInConv } = await supabase
          .from('conversation_participants')
          .select('user_id')
          .eq('conversation_id', conv.conversation_id)
          .eq('user_id', targetProfile.user_id)
          .maybeSingle();

        if (otherInConv) {
          onChatCreated(conv.conversation_id);
          onOpenChange(false);
          setEmail('');
          setLoading(false);
          return;
        }
      }
    }

    // Create new conversation
    const { data: newConv, error: convError } = await supabase
      .from('conversations')
      .insert({})
      .select()
      .single();

    if (convError || !newConv) {
      setError('Ошибка создания чата');
      setLoading(false);
      return;
    }

    // Add participants
    await supabase.from('conversation_participants').insert([
      { conversation_id: newConv.id, user_id: user.id },
      { conversation_id: newConv.id, user_id: targetProfile.user_id },
    ]);

    onChatCreated(newConv.id);
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
            placeholder="Email собеседника"
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
