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

    // Use search_profiles RPC to find user
    const { data: results, error: searchError } = await supabase
      .rpc('search_profiles', { search_term: searchValue });

    if (searchError) {
      setError('Ошибка поиска пользователя');
      setLoading(false);
      return;
    }

    let targetUserId: string | null = null;

    if (!results || results.length === 0) {
      setError('Пользователь не найден');
      setLoading(false);
      return;
    }

    // Exact match by username first
    const exact = results.find((r: any) => r.username === searchValue);
    if (exact) {
      targetUserId = exact.user_id;
    } else if (results.length === 1) {
      targetUserId = results[0].user_id;
    } else {
      setError('Найдено несколько пользователей. Уточните email/ник.');
      setLoading(false);
      return;
    }

    if (targetUserId === user.id) {
      setError('Нельзя написать самому себе');
      setLoading(false);
      return;
    }

    // 2) Create (or get) direct conversation atomically on backend
    const { data: conversationId, error: createChatError } = await supabase
      .rpc('create_or_get_direct_conversation', { target_user_id: targetUserId });

    if (createChatError || !conversationId) {
      setError('Ошибка создания чата');
      setLoading(false);
      return;
    }

    onChatCreated(conversationId);
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
