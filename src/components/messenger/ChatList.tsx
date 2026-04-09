import { useState, useEffect, useCallback, useRef } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { Plus, LogOut, Search, Users, Edit2, Trash2, Settings, Minus as ZoomOut, Plus as ZoomIn, Sun, Moon, Camera, Palette } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Slider } from '@/components/ui/slider';
import { Switch } from '@/components/ui/switch';
import NewChatDialog from './NewChatDialog';
import NewGroupDialog from './NewGroupDialog';
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
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
  participantAvatarUrl?: string | null;
  lastMessage?: string;
  lastMessageAt?: string;
  isGroup?: boolean;
  unreadCount: number;
}

interface ChatListProps {
  selectedChat: string | null;
  onSelectChat: (id: string) => void;
}

const ACCENT_COLORS = [
  { name: 'Бирюзовый', hue: 175, primary: '175 70% 50%' },
  { name: 'Синий', hue: 220, primary: '220 70% 55%' },
  { name: 'Фиолетовый', hue: 270, primary: '270 60% 55%' },
  { name: 'Зелёный', hue: 142, primary: '142 60% 45%' },
  { name: 'Оранжевый', hue: 25, primary: '25 90% 55%' },
  { name: 'Розовый', hue: 330, primary: '330 70% 55%' },
  { name: 'Красный', hue: 0, primary: '0 70% 55%' },
];

const BUILTIN_WALLPAPERS = [
  { id: 'none', name: 'Нет', css: '' },
  { id: 'dots', name: 'Точки', css: 'radial-gradient(circle, hsl(var(--muted-foreground) / 0.08) 1px, transparent 1px)' , size: '20px 20px' },
  { id: 'grid', name: 'Сетка', css: 'linear-gradient(hsl(var(--muted-foreground) / 0.05) 1px, transparent 1px), linear-gradient(90deg, hsl(var(--muted-foreground) / 0.05) 1px, transparent 1px)', size: '24px 24px' },
  { id: 'diagonal', name: 'Диагональ', css: 'repeating-linear-gradient(45deg, transparent, transparent 10px, hsl(var(--muted-foreground) / 0.03) 10px, hsl(var(--muted-foreground) / 0.03) 11px)', size: 'auto' },
  { id: 'bubbles', name: 'Пузырьки', css: 'radial-gradient(circle at 20% 80%, hsl(var(--primary) / 0.04) 0%, transparent 50%), radial-gradient(circle at 80% 20%, hsl(var(--primary) / 0.06) 0%, transparent 50%), radial-gradient(circle at 50% 50%, hsl(var(--primary) / 0.02) 0%, transparent 70%)', size: 'auto' },
  { id: 'waves', name: 'Волны', css: 'repeating-linear-gradient(135deg, transparent, transparent 20px, hsl(var(--primary) / 0.03) 20px, hsl(var(--primary) / 0.03) 40px)', size: 'auto' },
];

const ChatList = ({ selectedChat, onSelectChat }: ChatListProps) => {
  const { user, signOut } = useAuth();
  const [chats, setChats] = useState<ChatItem[]>([]);
  const [showNewChat, setShowNewChat] = useState(false);
  const [showNewGroup, setShowNewGroup] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [search, setSearch] = useState('');
  const [renameDialog, setRenameDialog] = useState<{ open: boolean; userId: string; currentName: string }>({ open: false, userId: '', currentName: '' });
  const [nickname, setNickname] = useState('');
  const [myProfile, setMyProfile] = useState<{ avatar_url: string | null; display_name: string | null; username: string } | null>(null);
  const [uploadingAvatar, setUploadingAvatar] = useState(false);
  const avatarInputRef = useRef<HTMLInputElement>(null);
  const wallpaperInputRef = useRef<HTMLInputElement>(null);
  const [scale, setScale] = useState(() => {
    const saved = localStorage.getItem('app-scale');
    return saved ? Number(saved) : 100;
  });
  const [maxChars, setMaxChars] = useState(() => {
    const saved = localStorage.getItem('msg-max-chars');
    return saved ? Number(saved) : 40;
  });
  const [theme, setTheme] = useState<'dark' | 'light'>(() => {
    return (localStorage.getItem('app-theme') as 'dark' | 'light') || 'dark';
  });
  const [accentIndex, setAccentIndex] = useState(() => {
    const saved = localStorage.getItem('app-accent-index');
    return saved ? Number(saved) : 0;
  });
  const [wallpaperId, setWallpaperId] = useState(() => {
    return localStorage.getItem('app-wallpaper') || 'none';
  });
  const [customWallpaper, setCustomWallpaper] = useState(() => {
    return localStorage.getItem('app-wallpaper-custom') || '';
  });

  // Load my profile
  useEffect(() => {
    if (!user) return;
    supabase.from('profiles').select('avatar_url, display_name, username').eq('user_id', user.id).single()
      .then(({ data }) => { if (data) setMyProfile(data); });
  }, [user]);

  // Apply scale
  useEffect(() => {
    document.documentElement.style.fontSize = `${scale}%`;
    localStorage.setItem('app-scale', String(scale));
  }, [scale]);

  // Apply theme
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('app-theme', theme);
  }, [theme]);

  // Apply accent color
  useEffect(() => {
    const accent = ACCENT_COLORS[accentIndex] || ACCENT_COLORS[0];
    document.documentElement.style.setProperty('--primary', accent.primary);
    document.documentElement.style.setProperty('--ring', accent.primary);
    // Update message-own color based on accent
    const lightTheme = theme === 'light';
    if (lightTheme) {
      document.documentElement.style.setProperty('--message-own', `${accent.hue} 50% 88%`);
      document.documentElement.style.setProperty('--primary-foreground', '0 0% 100%');
    } else {
      document.documentElement.style.setProperty('--message-own', `${accent.hue} 60% 18%`);
      document.documentElement.style.setProperty('--primary-foreground', '220 20% 8%');
    }
    localStorage.setItem('app-accent-index', String(accentIndex));
  }, [accentIndex, theme]);

  // Apply wallpaper
  useEffect(() => {
    localStorage.setItem('app-wallpaper', wallpaperId);
    window.dispatchEvent(new Event('wallpaper-changed'));
  }, [wallpaperId]);

  useEffect(() => {
    localStorage.setItem('app-wallpaper-custom', customWallpaper);
    window.dispatchEvent(new Event('wallpaper-changed'));
  }, [customWallpaper]);

  // Save max chars
  useEffect(() => {
    localStorage.setItem('msg-max-chars', String(maxChars));
    window.dispatchEvent(new Event('msg-max-chars-changed'));
  }, [maxChars]);

  const handleAvatarUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !user) return;
    setUploadingAvatar(true);
    try {
      const ext = file.name.split('.').pop();
      const path = `${user.id}/avatar.${ext}`;
      await supabase.storage.from('chat-media').upload(path, file, { upsert: true });
      const { data: urlData } = supabase.storage.from('chat-media').getPublicUrl(path);
      const avatarUrl = urlData.publicUrl + '?t=' + Date.now();
      await supabase.from('profiles').update({ avatar_url: avatarUrl }).eq('user_id', user.id);
      setMyProfile(prev => prev ? { ...prev, avatar_url: avatarUrl } : prev);
      toast.success('Аватар обновлён');
    } catch {
      toast.error('Ошибка загрузки аватара');
    }
    setUploadingAvatar(false);
    if (avatarInputRef.current) avatarInputRef.current.value = '';
  };

  const handleWallpaperUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      setCustomWallpaper(reader.result as string);
      setWallpaperId('custom');
    };
    reader.readAsDataURL(file);
    if (wallpaperInputRef.current) wallpaperInputRef.current.value = '';
  };

  const loadChats = useCallback(async () => {
    if (!user) return;

    const { data: myParts } = await supabase
      .from('conversation_participants')
      .select('conversation_id, last_read_at')
      .eq('user_id', user.id);

    if (!myParts?.length) { setChats([]); return; }

    const convIds = myParts.map(p => p.conversation_id);
    const lastReadMap = new Map(myParts.map(p => [p.conversation_id, p.last_read_at]));

    const [convRes, allPartsRes, nicknamesRes, messagesRes] = await Promise.all([
      supabase.from('conversations').select('id, name, is_group').in('id', convIds),
      supabase.from('conversation_participants').select('conversation_id, user_id').in('conversation_id', convIds),
      supabase.from('contact_nicknames').select('contact_user_id, nickname').eq('user_id', user.id),
      supabase.from('messages').select('conversation_id, content, created_at, message_type, sender_id')
        .in('conversation_id', convIds)
        .order('created_at', { ascending: false }),
    ]);

    const conversations = convRes.data || [];
    const allParts = allPartsRes.data || [];
    const nicknameMap = new Map(nicknamesRes.data?.map(n => [n.contact_user_id, n.nickname]) || []);

    const lastMsgMap = new Map<string, typeof messagesRes.data extends (infer T)[] ? T : never>();
    for (const msg of (messagesRes.data || [])) {
      if (!lastMsgMap.has(msg.conversation_id)) {
        lastMsgMap.set(msg.conversation_id, msg);
      }
    }

    const otherUserIds = new Set<string>();
    const convPartsMap = new Map<string, string[]>();
    for (const p of allParts) {
      if (p.user_id !== user.id) otherUserIds.add(p.user_id);
      const arr = convPartsMap.get(p.conversation_id) || [];
      arr.push(p.user_id);
      convPartsMap.set(p.conversation_id, arr);
    }

    const profileMap = new Map<string, { display_name: string | null; username: string; avatar_url: string | null }>();
    if (otherUserIds.size > 0) {
      const { data: profiles } = await supabase
        .from('profiles')
        .select('user_id, display_name, username, avatar_url')
        .in('user_id', Array.from(otherUserIds));
      for (const p of (profiles || [])) {
        profileMap.set(p.user_id, p);
      }
    }

    const unreadMap = new Map<string, number>();
    for (const msg of (messagesRes.data || [])) {
      if (msg.sender_id === user.id) continue;
      const lastRead = lastReadMap.get(msg.conversation_id);
      if (lastRead && msg.created_at > lastRead) {
        unreadMap.set(msg.conversation_id, (unreadMap.get(msg.conversation_id) || 0) + 1);
      }
    }

    const convMap = new Map(conversations.map(c => [c.id, c]));

    const chatItems: ChatItem[] = convIds.map(convId => {
      const conv = convMap.get(convId);
      const isGroup = conv?.is_group || false;
      let name = 'Unknown';
      let email = '';
      let contactUserId = '';
      let avatarUrl: string | null = null;

      if (isGroup) {
        name = conv?.name || 'Группа';
      } else {
        const others = (convPartsMap.get(convId) || []).filter(id => id !== user.id);
        if (others.length > 0) {
          contactUserId = others[0];
          const customNick = nicknameMap.get(contactUserId);
          const profile = profileMap.get(contactUserId);
          name = customNick || profile?.display_name || profile?.username || 'Unknown';
          email = profile?.username || '';
          avatarUrl = profile?.avatar_url || null;
        }
      }

      const lastMsg = lastMsgMap.get(convId);
      const lastMessage = lastMsg
        ? lastMsg.message_type !== 'text'
          ? `📎 ${lastMsg.message_type}`
          : lastMsg.content || ''
        : '';

      return {
        id: convId,
        participantName: name,
        participantEmail: email,
        participantUserId: contactUserId,
        participantAvatarUrl: avatarUrl,
        lastMessage,
        lastMessageAt: lastMsg?.created_at,
        isGroup,
        unreadCount: unreadMap.get(convId) || 0,
      };
    }).filter(c => c.participantName !== 'Unknown' || c.isGroup);

    chatItems.sort((a, b) => {
      if (!a.lastMessageAt) return 1;
      if (!b.lastMessageAt) return -1;
      return new Date(b.lastMessageAt).getTime() - new Date(a.lastMessageAt).getTime();
    });

    setChats(chatItems);
  }, [user]);

  useEffect(() => { loadChats(); }, [loadChats]);

  useEffect(() => {
    const channel = supabase
      .channel('chat-list-updates')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages' }, () => {
        loadChats();
      })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [loadChats]);

  const handleSelectChat = (chatId: string) => {
    setChats(prev => prev.map(c => c.id === chatId ? { ...c, unreadCount: 0 } : c));
    onSelectChat(chatId);
  };

  const clearChat = async (convId: string) => {
    const { data: msgs } = await supabase.from('messages').select('id').eq('conversation_id', convId);
    if (msgs?.length) {
      await supabase.from('deleted_messages').insert(msgs.map(m => ({ message_id: m.id, user_id: user!.id })));
    }
    toast.success('Чат очищен');
    loadChats();
  };

  const saveNickname = async () => {
    if (!nickname.trim()) return;
    const { error } = await supabase.from('contact_nicknames').upsert({
      user_id: user!.id,
      contact_user_id: renameDialog.userId,
      nickname: nickname.trim(),
    }, { onConflict: 'user_id,contact_user_id' });
    if (!error) { toast.success('Контакт переименован'); loadChats(); }
    setRenameDialog({ open: false, userId: '', currentName: '' });
    setNickname('');
  };

  const resetSettings = () => {
    setScale(100);
    setMaxChars(40);
    setTheme('dark');
    setAccentIndex(0);
    setWallpaperId('none');
    setCustomWallpaper('');
    document.documentElement.style.removeProperty('--primary');
    document.documentElement.style.removeProperty('--ring');
    document.documentElement.style.removeProperty('--message-own');
    document.documentElement.style.removeProperty('--primary-foreground');
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
          <Button variant="ghost" size="icon" onClick={() => setShowSettings(true)} className="text-muted-foreground hover:text-primary">
            <Settings className="h-5 w-5" />
          </Button>
          <Button variant="ghost" size="icon" onClick={() => setShowNewGroup(true)} className="text-muted-foreground hover:text-primary">
            <Users className="h-5 w-5" />
          </Button>
          <Button variant="ghost" size="icon" onClick={() => setShowNewChat(true)} className="text-muted-foreground hover:text-primary">
            <Plus className="h-5 w-5" />
          </Button>
        </div>
      </div>

      {/* Search */}
      <div className="px-3 py-2">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input placeholder="Поиск..." value={search} onChange={(e) => setSearch(e.target.value)} className="bg-secondary border-none pl-9 text-sm" />
        </div>
      </div>

      {/* Chat list */}
      <div className="flex-1 overflow-y-auto">
        {filteredChats.map((chat) => (
          <ContextMenu key={chat.id}>
            <ContextMenuTrigger>
              <button
                onClick={() => handleSelectChat(chat.id)}
                className={`flex w-full items-center gap-3 px-4 py-3 transition-all duration-200 hover:bg-sidebar-accent ${selectedChat === chat.id ? 'bg-sidebar-accent' : ''}`}
              >
                <Avatar className="h-10 w-10 shrink-0">
                  {chat.participantAvatarUrl && <AvatarImage src={chat.participantAvatarUrl} />}
                  <AvatarFallback className="gradient-primary text-primary-foreground text-sm font-semibold">
                    {chat.isGroup ? '👥' : chat.participantName.charAt(0).toUpperCase()}
                  </AvatarFallback>
                </Avatar>
                <div className="min-w-0 flex-1 text-left">
                  <p className="truncate text-sm font-medium text-foreground">{chat.participantName}</p>
                  {chat.lastMessage && <p className="truncate text-xs text-muted-foreground">{chat.lastMessage}</p>}
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
                <ContextMenuItem onClick={() => { setRenameDialog({ open: true, userId: chat.participantUserId!, currentName: chat.participantName }); setNickname(chat.participantName); }} className="gap-2">
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

      <NewChatDialog open={showNewChat} onOpenChange={setShowNewChat} onChatCreated={(id) => { handleSelectChat(id); loadChats(); }} />
      <NewGroupDialog open={showNewGroup} onOpenChange={setShowNewGroup} onGroupCreated={(id) => { handleSelectChat(id); loadChats(); }} />

      {/* Rename dialog */}
      <Dialog open={renameDialog.open} onOpenChange={(o) => setRenameDialog(prev => ({ ...prev, open: o }))}>
        <DialogContent className="bg-card border-border sm:max-w-sm">
          <DialogHeader><DialogTitle className="text-foreground">Переименовать контакт</DialogTitle></DialogHeader>
          <Input value={nickname} onChange={(e) => setNickname(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && saveNickname()} placeholder="Новое имя" className="bg-secondary border-none" autoFocus />
          <Button onClick={saveNickname} className="gradient-primary text-primary-foreground">Сохранить</Button>
        </DialogContent>
      </Dialog>

      {/* Settings dialog */}
      <Dialog open={showSettings} onOpenChange={setShowSettings}>
        <DialogContent className="bg-card border-border sm:max-w-sm max-h-[85vh] overflow-y-auto">
          <DialogHeader><DialogTitle className="text-foreground">Настройки</DialogTitle></DialogHeader>
          <div className="space-y-5">
            {/* Profile section */}
            <div className="flex items-center gap-3">
              <div className="relative group">
                <Avatar className="h-14 w-14">
                  {myProfile?.avatar_url && <AvatarImage src={myProfile.avatar_url} />}
                  <AvatarFallback className="gradient-primary text-primary-foreground text-lg font-semibold">
                    {(myProfile?.display_name || myProfile?.username || '?').charAt(0).toUpperCase()}
                  </AvatarFallback>
                </Avatar>
                <button
                  onClick={() => avatarInputRef.current?.click()}
                  disabled={uploadingAvatar}
                  className="absolute inset-0 flex items-center justify-center bg-black/50 rounded-full opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer"
                >
                  <Camera className="h-5 w-5 text-white" />
                </button>
                <input ref={avatarInputRef} type="file" accept="image/*" onChange={handleAvatarUpload} className="hidden" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold text-foreground truncate">{myProfile?.display_name || myProfile?.username || ''}</p>
                <p className="text-xs text-muted-foreground truncate">{user?.email || ''}</p>
              </div>
            </div>

            {/* Theme toggle */}
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                {theme === 'dark' ? <Moon className="h-4 w-4 text-muted-foreground" /> : <Sun className="h-4 w-4 text-muted-foreground" />}
                <label className="text-sm font-medium text-foreground">Светлая тема</label>
              </div>
              <Switch checked={theme === 'light'} onCheckedChange={(checked) => setTheme(checked ? 'light' : 'dark')} />
            </div>

            {/* Accent color */}
            <div>
              <div className="flex items-center gap-2 mb-2">
                <Palette className="h-4 w-4 text-muted-foreground" />
                <label className="text-sm font-medium text-foreground">Акцент чата</label>
              </div>
              <div className="flex gap-2 flex-wrap">
                {ACCENT_COLORS.map((color, i) => (
                  <button
                    key={color.name}
                    onClick={() => setAccentIndex(i)}
                    className={`h-8 w-8 rounded-full transition-all duration-200 border-2 ${accentIndex === i ? 'border-foreground scale-110' : 'border-transparent'}`}
                    style={{ backgroundColor: `hsl(${color.primary})` }}
                    title={color.name}
                  />
                ))}
              </div>
            </div>

            {/* Wallpaper */}
            <div>
              <label className="text-sm font-medium text-foreground mb-2 block">Обои чата</label>
              <div className="grid grid-cols-3 gap-2">
                {BUILTIN_WALLPAPERS.map(wp => (
                  <button
                    key={wp.id}
                    onClick={() => { setWallpaperId(wp.id); if (wp.id !== 'custom') setCustomWallpaper(''); }}
                    className={`h-16 rounded-lg border-2 transition-all duration-200 text-[10px] text-muted-foreground flex items-end justify-center pb-1 ${wallpaperId === wp.id ? 'border-primary' : 'border-border'}`}
                    style={wp.css ? { background: `${wp.css}, hsl(var(--background))`, backgroundSize: wp.size } : { background: 'hsl(var(--background))' }}
                  >
                    {wp.name}
                  </button>
                ))}
                <button
                  onClick={() => wallpaperInputRef.current?.click()}
                  className={`h-16 rounded-lg border-2 transition-all duration-200 text-[10px] text-muted-foreground flex items-center justify-center ${wallpaperId === 'custom' ? 'border-primary' : 'border-border'}`}
                  style={customWallpaper ? { backgroundImage: `url(${customWallpaper})`, backgroundSize: 'cover', backgroundPosition: 'center' } : { background: 'hsl(var(--secondary))' }}
                >
                  {customWallpaper ? '' : '+ Своё фото'}
                </button>
              </div>
              <input ref={wallpaperInputRef} type="file" accept="image/*" onChange={handleWallpaperUpload} className="hidden" />
            </div>

            {/* Scale */}
            <div>
              <label className="text-sm font-medium text-foreground mb-2 block">Масштаб: {scale}%</label>
              <div className="flex items-center gap-3">
                <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0" onClick={() => setScale(s => Math.max(70, s - 5))}>
                  <ZoomOut className="h-4 w-4" />
                </Button>
                <Slider value={[scale]} onValueChange={([v]) => setScale(v)} min={70} max={150} step={5} className="flex-1" />
                <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0" onClick={() => setScale(s => Math.min(150, s + 5))}>
                  <ZoomIn className="h-4 w-4" />
                </Button>
              </div>
            </div>

            {/* Max chars */}
            <div>
              <label className="text-sm font-medium text-foreground mb-2 block">Символов в строке: {maxChars}</label>
              <div className="flex items-center gap-3">
                <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0" onClick={() => setMaxChars(s => Math.max(15, s - 5))}>
                  <ZoomOut className="h-4 w-4" />
                </Button>
                <Slider value={[maxChars]} onValueChange={([v]) => setMaxChars(v)} min={15} max={80} step={5} className="flex-1" />
                <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0" onClick={() => setMaxChars(s => Math.min(80, s + 5))}>
                  <ZoomIn className="h-4 w-4" />
                </Button>
              </div>
              <p className="text-xs text-muted-foreground mt-1">Ограничивает ширину текста сообщений</p>
            </div>

            {/* Reset + Logout */}
            <Button variant="outline" onClick={resetSettings} className="w-full">Сбросить настройки</Button>
            <Button variant="destructive" onClick={signOut} className="w-full gap-2">
              <LogOut className="h-4 w-4" /> Выйти из аккаунта
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default ChatList;
