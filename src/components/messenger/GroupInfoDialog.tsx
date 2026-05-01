import { useEffect, useState, useRef } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Camera, Check, Pencil, Shield, ShieldOff, Crown } from 'lucide-react';
import { toast } from 'sonner';

interface GroupInfoDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  conversationId: string;
}

interface Participant {
  user_id: string;
  display_name: string;
  username: string;
  avatar_url: string | null;
  is_admin: boolean;
  is_creator: boolean;
}

const GroupInfoDialog = ({ open, onOpenChange, conversationId }: GroupInfoDialogProps) => {
  const { user } = useAuth();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [loading, setLoading] = useState(true);
  const [name, setName] = useState('');
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [createdBy, setCreatedBy] = useState<string | null>(null);
  const [participants, setParticipants] = useState<Participant[]>([]);
  const [editingName, setEditingName] = useState(false);
  const [nameInput, setNameInput] = useState('');
  const [uploading, setUploading] = useState(false);

  const isCreator = !!user && createdBy === user.id;
  const me = participants.find(p => p.user_id === user?.id);
  const isAdmin = !!me?.is_admin || isCreator;

  const load = async () => {
    if (!user) return;
    setLoading(true);

    const { data: conv } = await supabase
      .from('conversations')
      .select('name, avatar_url, created_by')
      .eq('id', conversationId)
      .single();

    if (conv) {
      setName(conv.name || 'Группа');
      setNameInput(conv.name || '');
      setAvatarUrl((conv as any).avatar_url || null);
      setCreatedBy((conv as any).created_by || null);
    }

    const { data: parts } = await supabase
      .from('conversation_participants')
      .select('user_id')
      .eq('conversation_id', conversationId);

    const ids = (parts || []).map(p => p.user_id);

    const [profilesRes, adminsRes] = await Promise.all([
      supabase
        .from('profiles')
        .select('user_id, display_name, username, avatar_url')
        .in('user_id', ids.length ? ids : ['00000000-0000-0000-0000-000000000000']),
      supabase
        .from('group_admins')
        .select('user_id')
        .eq('conversation_id', conversationId),
    ]);

    const adminSet = new Set((adminsRes.data || []).map(a => a.user_id));
    const creatorId = (conv as any)?.created_by;

    const list: Participant[] = (profilesRes.data || []).map(p => ({
      user_id: p.user_id,
      display_name: p.display_name || p.username || 'Без имени',
      username: p.username,
      avatar_url: p.avatar_url,
      is_admin: adminSet.has(p.user_id) || p.user_id === creatorId,
      is_creator: p.user_id === creatorId,
    }));

    // Creator first, then admins, then rest
    list.sort((a, b) => {
      if (a.is_creator !== b.is_creator) return a.is_creator ? -1 : 1;
      if (a.is_admin !== b.is_admin) return a.is_admin ? -1 : 1;
      return a.display_name.localeCompare(b.display_name);
    });

    setParticipants(list);
    setLoading(false);
  };

  useEffect(() => {
    if (open) load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, conversationId]);

  const saveName = async () => {
    const newName = nameInput.trim();
    if (!newName || newName === name) {
      setEditingName(false);
      return;
    }
    const { error } = await supabase
      .from('conversations')
      .update({ name: newName })
      .eq('id', conversationId);
    if (error) {
      toast.error('Не удалось изменить название');
    } else {
      setName(newName);
      setEditingName(false);
      toast.success('Название обновлено');
    }
  };

  const handleAvatarUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !user) return;
    setUploading(true);
    try {
      const ext = file.name.split('.').pop() || 'jpg';
      const path = `group-avatars/${conversationId}-${Date.now()}.${ext}`;
      const { error: upErr } = await supabase.storage
        .from('chat-media')
        .upload(path, file, { upsert: true });
      if (upErr) throw upErr;
      const { data: pub } = supabase.storage.from('chat-media').getPublicUrl(path);
      const { error: updErr } = await supabase
        .from('conversations')
        .update({ avatar_url: pub.publicUrl })
        .eq('id', conversationId);
      if (updErr) throw updErr;
      setAvatarUrl(pub.publicUrl);
      toast.success('Аватар обновлён');
    } catch (err: any) {
      toast.error(err.message || 'Ошибка загрузки');
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const toggleAdmin = async (participant: Participant) => {
    if (!isCreator || participant.is_creator) return;
    if (participant.is_admin) {
      const { error } = await supabase
        .from('group_admins')
        .delete()
        .eq('conversation_id', conversationId)
        .eq('user_id', participant.user_id);
      if (error) return toast.error('Не удалось снять права');
      toast.success('Права админа сняты');
    } else {
      const { error } = await supabase
        .from('group_admins')
        .insert({ conversation_id: conversationId, user_id: participant.user_id, granted_by: user!.id });
      if (error) return toast.error('Не удалось выдать права');
      toast.success('Назначен админом');
    }
    load();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Информация о группе</DialogTitle>
          <DialogDescription className="sr-only">
            Просмотр участников и настроек группы
          </DialogDescription>
        </DialogHeader>

        {loading ? (
          <div className="py-8 text-center text-sm text-muted-foreground">Загрузка...</div>
        ) : (
          <div className="space-y-4">
            {/* Avatar + name */}
            <div className="flex flex-col items-center gap-3">
              <div className="relative">
                <Avatar className="h-24 w-24">
                  {avatarUrl && <AvatarImage src={avatarUrl} />}
                  <AvatarFallback className="gradient-primary text-primary-foreground text-2xl font-semibold">
                    {name.charAt(0).toUpperCase()}
                  </AvatarFallback>
                </Avatar>
                {isAdmin && (
                  <>
                    <button
                      type="button"
                      onClick={() => fileInputRef.current?.click()}
                      disabled={uploading}
                      className="absolute bottom-0 right-0 flex h-8 w-8 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-md hover:opacity-90 disabled:opacity-50"
                      aria-label="Изменить аватар"
                    >
                      <Camera className="h-4 w-4" />
                    </button>
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept="image/*"
                      className="hidden"
                      onChange={handleAvatarUpload}
                    />
                  </>
                )}
              </div>

              {editingName ? (
                <div className="flex w-full items-center gap-2">
                  <Input
                    value={nameInput}
                    onChange={(e) => setNameInput(e.target.value)}
                    autoFocus
                    onKeyDown={(e) => e.key === 'Enter' && saveName()}
                  />
                  <Button size="icon" onClick={saveName}>
                    <Check className="h-4 w-4" />
                  </Button>
                </div>
              ) : (
                <div className="flex items-center gap-2">
                  <h3 className="text-lg font-semibold text-foreground">{name}</h3>
                  {isAdmin && (
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7"
                      onClick={() => setEditingName(true)}
                    >
                      <Pencil className="h-3.5 w-3.5" />
                    </Button>
                  )}
                </div>
              )}
              <p className="text-xs text-muted-foreground">
                {participants.length} {participants.length === 1 ? 'участник' : 'участников'}
              </p>
            </div>

            {/* Participants */}
            <div className="max-h-64 overflow-y-auto space-y-1">
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground px-1">
                Участники
              </p>
              {participants.map((p) => (
                <div
                  key={p.user_id}
                  className="flex items-center gap-3 rounded-lg px-2 py-2 hover:bg-secondary/50"
                >
                  <Avatar className="h-9 w-9">
                    {p.avatar_url && <AvatarImage src={p.avatar_url} />}
                    <AvatarFallback className="gradient-primary text-primary-foreground text-xs">
                      {p.display_name.charAt(0).toUpperCase()}
                    </AvatarFallback>
                  </Avatar>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-foreground truncate">
                      {p.display_name}
                      {p.user_id === user?.id && (
                        <span className="ml-1 text-xs text-muted-foreground">(вы)</span>
                      )}
                    </p>
                    <div className="flex items-center gap-1 text-[11px] text-muted-foreground">
                      {p.is_creator ? (
                        <>
                          <Crown className="h-3 w-3 text-primary" />
                          <span>Создатель</span>
                        </>
                      ) : p.is_admin ? (
                        <>
                          <Shield className="h-3 w-3 text-primary" />
                          <span>Админ</span>
                        </>
                      ) : (
                        <span>Участник</span>
                      )}
                    </div>
                  </div>
                  {isCreator && !p.is_creator && (
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8"
                      onClick={() => toggleAdmin(p)}
                      title={p.is_admin ? 'Снять админа' : 'Назначить админом'}
                    >
                      {p.is_admin ? (
                        <ShieldOff className="h-4 w-4" />
                      ) : (
                        <Shield className="h-4 w-4" />
                      )}
                    </Button>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
};

export default GroupInfoDialog;
