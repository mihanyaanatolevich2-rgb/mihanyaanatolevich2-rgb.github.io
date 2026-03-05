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
import { X, Search, UserPlus } from 'lucide-react';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';

interface FoundUser {
  user_id: string;
  display_name: string | null;
  username: string;
}

interface NewGroupDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onGroupCreated: (conversationId: string) => void;
}

const NewGroupDialog = ({ open, onOpenChange, onGroupCreated }: NewGroupDialogProps) => {
  const { user } = useAuth();
  const [groupName, setGroupName] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<FoundUser[]>([]);
  const [selectedMembers, setSelectedMembers] = useState<FoundUser[]>([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSearch = async (query: string) => {
    setSearchQuery(query);
    if (query.trim().length < 2) {
      setSearchResults([]);
      return;
    }

    const { data } = await supabase
      .rpc('search_profiles', { search_term: query });

    if (data) {
      setSearchResults(data.filter(u => !selectedMembers.some(m => m.user_id === u.user_id)));
    }
  };

  const addMember = (u: FoundUser) => {
    setSelectedMembers(prev => [...prev, u]);
    setSearchResults(prev => prev.filter(r => r.user_id !== u.user_id));
    setSearchQuery('');
  };

  const removeMember = (userId: string) => {
    setSelectedMembers(prev => prev.filter(m => m.user_id !== userId));
  };

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user || !groupName.trim() || selectedMembers.length < 1) {
      setError('Укажите название и добавьте участников');
      return;
    }

    setError('');
    setLoading(true);

    const memberIds = selectedMembers.map(m => m.user_id);

    const { data: conversationId, error: createError } = await supabase
      .rpc('create_group_conversation', {
        group_name: groupName.trim(),
        member_ids: memberIds,
      });

    if (createError || !conversationId) {
      setError('Ошибка создания группы');
      setLoading(false);
      return;
    }

    onGroupCreated(conversationId);
    onOpenChange(false);
    setGroupName('');
    setSelectedMembers([]);
    setSearchQuery('');
    setLoading(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="bg-card border-border sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="text-foreground">Новая группа</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleCreate} className="space-y-4">
          <Input
            placeholder="Название группы"
            value={groupName}
            onChange={(e) => setGroupName(e.target.value)}
            required
            className="bg-secondary border-none"
          />

          {/* Selected members */}
          {selectedMembers.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {selectedMembers.map(m => (
                <span
                  key={m.user_id}
                  className="inline-flex items-center gap-1 rounded-full bg-primary/20 px-3 py-1 text-xs text-foreground"
                >
                  {m.display_name || m.username}
                  <button type="button" onClick={() => removeMember(m.user_id)}>
                    <X className="h-3 w-3 text-muted-foreground hover:text-foreground" />
                  </button>
                </span>
              ))}
            </div>
          )}

          {/* Search users */}
          <div className="relative">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="Поиск участников..."
              value={searchQuery}
              onChange={(e) => handleSearch(e.target.value)}
              className="bg-secondary border-none pl-9"
            />
          </div>

          {searchResults.length > 0 && (
            <div className="max-h-40 overflow-y-auto rounded-lg border border-border bg-popover">
              {searchResults.map(u => (
                <button
                  key={u.user_id}
                  type="button"
                  onClick={() => addMember(u)}
                  className="flex w-full items-center gap-3 px-3 py-2 text-left hover:bg-secondary transition-colors"
                >
                  <Avatar className="h-7 w-7">
                    <AvatarFallback className="gradient-primary text-primary-foreground text-xs">
                      {(u.display_name || u.username).charAt(0).toUpperCase()}
                    </AvatarFallback>
                  </Avatar>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm text-foreground truncate">{u.display_name || u.username}</p>
                    <p className="text-xs text-muted-foreground truncate">{u.username}</p>
                  </div>
                  <UserPlus className="h-4 w-4 text-muted-foreground" />
                </button>
              ))}
            </div>
          )}

          {error && <p className="text-sm text-destructive">{error}</p>}

          <Button type="submit" className="w-full gradient-primary text-primary-foreground" disabled={loading}>
            {loading ? '...' : `Создать группу (${selectedMembers.length + 1} уч.)`}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
};

export default NewGroupDialog;
