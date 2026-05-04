import { useEffect, useState } from 'react';
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
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Lock, Megaphone, Search, UserPlus, X } from 'lucide-react';

interface FoundUser {
  user_id: string;
  display_name: string | null;
  username: string;
}

interface PublicChannel {
  id: string;
  name: string;
  avatar_url: string | null;
  members_count: number;
}

interface NewChannelDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onChannelCreated: (conversationId: string) => void;
}

const NewChannelDialog = ({ open, onOpenChange, onChannelCreated }: NewChannelDialogProps) => {
  const { user } = useAuth();
  const [mode, setMode] = useState<'create' | 'search'>('create');
  const [channelName, setChannelName] = useState('');
  const [visibility, setVisibility] = useState<'public' | 'private'>('public');
  const [userQuery, setUserQuery] = useState('');
  const [channelQuery, setChannelQuery] = useState('');
  const [searchResults, setSearchResults] = useState<FoundUser[]>([]);
  const [selectedMembers, setSelectedMembers] = useState<FoundUser[]>([]);
  const [channels, setChannels] = useState<PublicChannel[]>([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const reset = () => {
    setChannelName('');
    setVisibility('public');
    setUserQuery('');
    setChannelQuery('');
    setSearchResults([]);
    setSelectedMembers([]);
    setError('');
    setLoading(false);
  };

  useEffect(() => {
    if (!open) reset();
  }, [open]);

  const searchUsers = async (query: string) => {
    setUserQuery(query);
    if (query.trim().length < 2) {
      setSearchResults([]);
      return;
    }
    const { data } = await supabase.rpc('search_profiles', { search_term: query });
    if (data) setSearchResults(data.filter(u => !selectedMembers.some(m => m.user_id === u.user_id)) as FoundUser[]);
  };

  const searchChannels = async (query = channelQuery) => {
    const { data } = await (supabase.rpc as any)('search_public_channels', { search_term: query.trim() });
    setChannels((data || []) as PublicChannel[]);
  };

  useEffect(() => {
    if (open && mode === 'search') searchChannels('');
  }, [open, mode]);

  const addMember = (u: FoundUser) => {
    setSelectedMembers(prev => [...prev, u]);
    setSearchResults(prev => prev.filter(r => r.user_id !== u.user_id));
    setUserQuery('');
  };

  const createChannel = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user || channelName.trim().length < 2) {
      setError('Введите название канала');
      return;
    }
    setError('');
    setLoading(true);
    const { data, error: createError } = await (supabase.rpc as any)('create_channel_conversation', {
      channel_name: channelName.trim(),
      channel_visibility: visibility,
      member_ids: selectedMembers.map(m => m.user_id),
    });
    setLoading(false);
    if (createError || !data) {
      setError('Ошибка создания канала');
      return;
    }
    onChannelCreated(data as string);
    onOpenChange(false);
  };

  const joinChannel = async (channelId: string) => {
    setLoading(true);
    const { data, error: joinError } = await (supabase.rpc as any)('join_public_channel', { channel_id: channelId });
    setLoading(false);
    if (joinError || !data) {
      setError('Не удалось присоединиться');
      return;
    }
    onChannelCreated(data as string);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="bg-card border-border sm:max-w-md max-h-[88vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-foreground">Каналы</DialogTitle>
        </DialogHeader>

        <div className="grid grid-cols-2 gap-2 rounded-lg bg-secondary p-1">
          <Button type="button" variant={mode === 'create' ? 'default' : 'ghost'} size="sm" onClick={() => setMode('create')}>Создать</Button>
          <Button type="button" variant={mode === 'search' ? 'default' : 'ghost'} size="sm" onClick={() => setMode('search')}>Найти</Button>
        </div>

        {mode === 'create' ? (
          <form onSubmit={createChannel} className="space-y-4">
            <Input
              placeholder="Название канала"
              value={channelName}
              onChange={(e) => setChannelName(e.target.value)}
              className="bg-secondary border-none"
              required
            />

            <div className="grid grid-cols-2 gap-2">
              <Button type="button" variant={visibility === 'public' ? 'default' : 'outline'} onClick={() => setVisibility('public')} className="gap-2">
                <Megaphone className="h-4 w-4" /> Публичный
              </Button>
              <Button type="button" variant={visibility === 'private' ? 'default' : 'outline'} onClick={() => setVisibility('private')} className="gap-2">
                <Lock className="h-4 w-4" /> Приватный
              </Button>
            </div>

            {selectedMembers.length > 0 && (
              <div className="flex flex-wrap gap-2">
                {selectedMembers.map(m => (
                  <span key={m.user_id} className="inline-flex items-center gap-1 rounded-full bg-primary/20 px-3 py-1 text-xs text-foreground">
                    {m.display_name || m.username}
                    <button type="button" onClick={() => setSelectedMembers(prev => prev.filter(x => x.user_id !== m.user_id))}>
                      <X className="h-3 w-3 text-muted-foreground hover:text-foreground" />
                    </button>
                  </span>
                ))}
              </div>
            )}

            <div className="relative">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                placeholder="Добавить участников..."
                value={userQuery}
                onChange={(e) => searchUsers(e.target.value)}
                className="bg-secondary border-none pl-9"
              />
            </div>

            {searchResults.length > 0 && (
              <div className="max-h-40 overflow-y-auto rounded-lg border border-border bg-popover">
                {searchResults.map(u => (
                  <button key={u.user_id} type="button" onClick={() => addMember(u)} className="flex w-full items-center gap-3 px-3 py-2 text-left hover:bg-secondary transition-colors">
                    <Avatar className="h-7 w-7">
                      <AvatarFallback className="gradient-primary text-primary-foreground text-xs">{(u.display_name || u.username).charAt(0).toUpperCase()}</AvatarFallback>
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
              {loading ? '...' : 'Создать канал'}
            </Button>
          </form>
        ) : (
          <div className="space-y-4">
            <div className="flex gap-2">
              <Input
                placeholder="Поиск публичных каналов..."
                value={channelQuery}
                onChange={(e) => setChannelQuery(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && searchChannels()}
                className="bg-secondary border-none"
              />
              <Button type="button" size="icon" onClick={() => searchChannels()}>
                <Search className="h-4 w-4" />
              </Button>
            </div>

            <div className="max-h-72 overflow-y-auto space-y-1">
              {channels.map(channel => (
                <div key={channel.id} className="flex items-center gap-3 rounded-lg px-2 py-2 hover:bg-secondary/50">
                  <Avatar className="h-9 w-9">
                    {channel.avatar_url && <AvatarImage src={channel.avatar_url} />}
                    <AvatarFallback className="gradient-primary text-primary-foreground text-xs">{channel.name.charAt(0).toUpperCase()}</AvatarFallback>
                  </Avatar>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-foreground truncate">{channel.name}</p>
                    <p className="text-xs text-muted-foreground">{channel.members_count || 0} подписчиков</p>
                  </div>
                  <Button type="button" size="sm" onClick={() => joinChannel(channel.id)} disabled={loading}>Войти</Button>
                </div>
              ))}
              {channels.length === 0 && <p className="py-8 text-center text-sm text-muted-foreground">Каналы не найдены</p>}
            </div>
            {error && <p className="text-sm text-destructive">{error}</p>}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
};

export default NewChannelDialog;