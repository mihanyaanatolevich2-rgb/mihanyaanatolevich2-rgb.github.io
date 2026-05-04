import { useState, useEffect, useCallback, useRef } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { Plus, LogOut, Search, Users, Edit2, Trash2, Settings, Minus as ZoomOut, Plus as ZoomIn, Sun, Moon, Camera, Palette, ChevronDown, ChevronUp, CloudSun, Bookmark, Clock, MapPin, Megaphone } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Slider } from '@/components/ui/slider';
import { Switch } from '@/components/ui/switch';
import NewChatDialog from './NewChatDialog';
import NewGroupDialog from './NewGroupDialog';
import NewChannelDialog from './NewChannelDialog';
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
  isChannel?: boolean;
  isSavedMessages?: boolean;
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

const WALLPAPER_COLORS = [
  { name: 'Без цвета', color: '' },
  { name: 'Бирюзовый', color: '175 60% 50%' },
  { name: 'Синий', color: '220 60% 50%' },
  { name: 'Фиолет', color: '270 50% 50%' },
  { name: 'Зелёный', color: '142 50% 45%' },
  { name: 'Оранж', color: '25 80% 50%' },
  { name: 'Розовый', color: '330 60% 50%' },
  { name: 'Красный', color: '0 60% 50%' },
];

const BUILTIN_WALLPAPERS = [
  { id: 'none', name: 'Нет', css: '' },
  { id: 'dots', name: 'Точки', css: (c: string) => `radial-gradient(circle, hsl(${c || 'var(--muted-foreground)'} / 0.12) 1px, transparent 1px)`, size: '20px 20px' },
  { id: 'grid', name: 'Сетка', css: (c: string) => `linear-gradient(hsl(${c || 'var(--muted-foreground)'} / 0.08) 1px, transparent 1px), linear-gradient(90deg, hsl(${c || 'var(--muted-foreground)'} / 0.08) 1px, transparent 1px)`, size: '24px 24px' },
  { id: 'diagonal', name: 'Диагональ', css: (c: string) => `repeating-linear-gradient(45deg, transparent, transparent 10px, hsl(${c || 'var(--muted-foreground)'} / 0.06) 10px, hsl(${c || 'var(--muted-foreground)'} / 0.06) 11px)`, size: 'auto' },
  { id: 'bubbles', name: 'Пузырьки', css: (c: string) => `radial-gradient(circle at 20% 80%, hsl(${c || 'var(--primary)'} / 0.08) 0%, transparent 50%), radial-gradient(circle at 80% 20%, hsl(${c || 'var(--primary)'} / 0.1) 0%, transparent 50%), radial-gradient(circle at 50% 50%, hsl(${c || 'var(--primary)'} / 0.04) 0%, transparent 70%)`, size: 'auto' },
  { id: 'waves', name: 'Волны', css: (c: string) => `repeating-linear-gradient(135deg, transparent, transparent 20px, hsl(${c || 'var(--primary)'} / 0.06) 20px, hsl(${c || 'var(--primary)'} / 0.06) 40px)`, size: 'auto' },
];

interface WeatherData {
  temp: number;
  description: string;
  icon: string;
  city?: string;
}

const ChatList = ({ selectedChat, onSelectChat }: ChatListProps) => {
  const { user, signOut } = useAuth();
  const [chats, setChats] = useState<ChatItem[]>([]);
  const [showNewChat, setShowNewChat] = useState(false);
  const [showNewGroup, setShowNewGroup] = useState(false);
  const [showNewChannel, setShowNewChannel] = useState(false);
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
  const [wallpaperColor, setWallpaperColor] = useState(() => {
    return localStorage.getItem('app-wallpaper-color') || '';
  });

  // Saved messages conversation ID
  const [savedConvId, setSavedConvId] = useState<string | null>(null);

  // Weather
  const [weatherCity, setWeatherCity] = useState(() => localStorage.getItem('weather-city') || 'Moscow');
  const [weatherData, setWeatherData] = useState<WeatherData | null>(null);
  const [weatherOpen, setWeatherOpen] = useState(() => localStorage.getItem('weather-open') !== 'false');
  const [editingCity, setEditingCity] = useState(false);
  const [cityInput, setCityInput] = useState('');

  const getGreeting = () => {
    const hour = new Date().getHours();
    if (hour >= 5 && hour < 12) return 'Доброе утро!';
    if (hour >= 12 && hour < 18) return 'Добрый день!';
    return 'Добрый вечер!';
  };

  // Digital Detox
  const [detoxSeconds, setDetoxSeconds] = useState(0);
  const detoxRef = useRef<number>(0);

  // Start detox timer
  useEffect(() => {
    const today = new Date().toDateString();
    const savedDate = localStorage.getItem('detox-date');
    const savedSeconds = localStorage.getItem('detox-seconds');
    if (savedDate === today && savedSeconds) {
      detoxRef.current = Number(savedSeconds);
      setDetoxSeconds(detoxRef.current);
    } else {
      localStorage.setItem('detox-date', today);
      localStorage.setItem('detox-seconds', '0');
      detoxRef.current = 0;
    }
    const interval = setInterval(() => {
      detoxRef.current += 1;
      setDetoxSeconds(detoxRef.current);
      localStorage.setItem('detox-seconds', String(detoxRef.current));
      // Reset if day changed
      const nowDate = new Date().toDateString();
      if (nowDate !== localStorage.getItem('detox-date')) {
        localStorage.setItem('detox-date', nowDate);
        detoxRef.current = 0;
        localStorage.setItem('detox-seconds', '0');
      }
    }, 1000);
    return () => clearInterval(interval);
  }, []);

  const formatDetoxTime = (s: number) => {
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    if (h > 0) return `${h}ч ${m}м`;
    return `${m}м ${s % 60}с`;
  };

  // Fetch weather through our backend so the browser does not depend on weather domains blocked by providers.
  useEffect(() => {
    if (!weatherCity) return;
    const fetchWeather = async () => {
      try {
        const { data, error } = await supabase.functions.invoke('weather', {
          body: { city: weatherCity },
        });
        if (error || typeof data?.temp !== 'number') throw error || new Error('No weather');
        setWeatherData(data as WeatherData);
      } catch {
        setWeatherData({ temp: NaN, description: 'Смотреть прогноз', icon: '🌤️', city: weatherCity });
      }
    };
    fetchWeather();
    const interval = setInterval(fetchWeather, 600000); // refresh every 10 min
    return () => clearInterval(interval);
  }, [weatherCity]);

  // Open-Meteo uses WMO weather codes
  const describeWmo = (code: number): string => {
    if (code === 0) return 'Ясно';
    if (code === 1) return 'Преимущественно ясно';
    if (code === 2) return 'Переменная облачность';
    if (code === 3) return 'Пасмурно';
    if ([45, 48].includes(code)) return 'Туман';
    if ([51, 53, 55].includes(code)) return 'Морось';
    if ([56, 57].includes(code)) return 'Ледяная морось';
    if ([61, 63, 65].includes(code)) return 'Дождь';
    if ([66, 67].includes(code)) return 'Ледяной дождь';
    if ([71, 73, 75].includes(code)) return 'Снег';
    if (code === 77) return 'Снежная крупа';
    if ([80, 81, 82].includes(code)) return 'Ливни';
    if ([85, 86].includes(code)) return 'Снегопад';
    if (code === 95) return 'Гроза';
    if ([96, 99].includes(code)) return 'Гроза с градом';
    return '';
  };

  const getWeatherEmoji = (code: number, isDay = true): string => {
    const hour = new Date().getHours();
    const isNight = !isDay || hour < 6 || hour >= 21;
    const isEvening = isDay && hour >= 18 && hour < 21;
    const isMorning = isDay && hour >= 6 && hour < 10;

    // Clear
    if (code === 0 || code === 1) {
      if (isNight) return '🌙';
      if (isEvening) return '🌇';
      if (isMorning) return '🌅';
      return '☀️';
    }
    if (code === 2) return isNight ? '☁️' : '⛅';
    if (code === 3) return '☁️';
    if ([45, 48].includes(code)) return '🌫️';
    if ([51, 53, 55, 56, 57, 61, 63, 65, 66, 67, 80, 81, 82].includes(code)) return '🌧️';
    if ([71, 73, 75, 77, 85, 86].includes(code)) return '🌨️';
    if ([95, 96, 99].includes(code)) return '⛈️';
    return isNight ? '🌙' : '🌤️';
  };

  const saveCity = () => {
    if (cityInput.trim()) {
      setWeatherCity(cityInput.trim());
      localStorage.setItem('weather-city', cityInput.trim());
    }
    setEditingCity(false);
  };

  // Create or get saved messages conversation
  useEffect(() => {
    if (!user) return;
    (async () => {
      // Check localStorage first
      const cached = localStorage.getItem(`saved-conv-${user.id}`);
      if (cached) {
        // Verify it still exists
        const { data } = await supabase.from('conversations').select('id').eq('id', cached).single();
        if (data) {
          setSavedConvId(cached);
          return;
        }
        localStorage.removeItem(`saved-conv-${user.id}`);
      }

      // Find existing: conversations where user is only participant and name is Избранное
      const { data: myParts } = await supabase
        .from('conversation_participants')
        .select('conversation_id')
        .eq('user_id', user.id);
      
      if (myParts?.length) {
        for (const p of myParts) {
          const { data: conv } = await supabase
            .from('conversations')
            .select('id, name')
            .eq('id', p.conversation_id)
            .single();
          if (conv?.name === '⭐ Избранное') {
            // Check it's a solo conversation
            const { count } = await supabase
              .from('conversation_participants')
              .select('id', { count: 'exact', head: true })
              .eq('conversation_id', conv.id);
            if (count === 1) {
              localStorage.setItem(`saved-conv-${user.id}`, conv.id);
              setSavedConvId(conv.id);
              return;
            }
          }
        }
      }

      // Create new saved messages conversation
      const { data: newConv, error } = await supabase
        .from('conversations')
        .insert({ name: '⭐ Избранное', is_group: false })
        .select('id')
        .single();
      if (error || !newConv) return;
      
      await supabase.from('conversation_participants').insert({
        conversation_id: newConv.id,
        user_id: user.id,
      });
      
      localStorage.setItem(`saved-conv-${user.id}`, newConv.id);
      setSavedConvId(newConv.id);
    })();
  }, [user]);

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

  useEffect(() => {
    localStorage.setItem('app-wallpaper-color', wallpaperColor);
    window.dispatchEvent(new Event('wallpaper-changed'));
  }, [wallpaperColor]);

  // Save max chars
  useEffect(() => {
    localStorage.setItem('msg-max-chars', String(maxChars));
    window.dispatchEvent(new Event('msg-max-chars-changed'));
  }, [maxChars]);

  // Save weather open state
  useEffect(() => {
    localStorage.setItem('weather-open', String(weatherOpen));
  }, [weatherOpen]);

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
      supabase.from('conversations').select('id, name, is_group, is_channel, avatar_url').in('id', convIds),
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
      const isChannel = (conv as any)?.is_channel || false;
      const isSaved = convId === savedConvId;
      let name = 'Unknown';
      let email = '';
      let contactUserId = '';
      let avatarUrl: string | null = null;

      if (isSaved) {
        name = '⭐ Избранное';
      } else if (isChannel) {
        name = conv?.name || 'Канал';
        avatarUrl = (conv as any)?.avatar_url || null;
      } else if (isGroup) {
        name = conv?.name || 'Группа';
        avatarUrl = (conv as any)?.avatar_url || null;
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
        isChannel,
        isSavedMessages: isSaved,
        unreadCount: unreadMap.get(convId) || 0,
      };
    }).filter(c => c.participantName !== 'Unknown' || c.isGroup || c.isSavedMessages);

    // Sort: saved messages always first, then by last message
    chatItems.sort((a, b) => {
      if (a.isSavedMessages) return -1;
      if (b.isSavedMessages) return 1;
      if (!a.lastMessageAt) return 1;
      if (!b.lastMessageAt) return -1;
      return new Date(b.lastMessageAt).getTime() - new Date(a.lastMessageAt).getTime();
    });

    setChats(chatItems);
  }, [user, savedConvId]);

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
        <p className="absolute left-1/2 -translate-x-1/2 text-xs font-medium text-muted-foreground whitespace-nowrap">
          {getGreeting()}
        </p>
        <div className="flex gap-1">
          <Button variant="ghost" size="icon" onClick={() => setShowSettings(true)} className="text-muted-foreground hover:text-primary">
            <Settings className="h-5 w-5" />
          </Button>
          <Button variant="ghost" size="icon" onClick={() => setShowNewChannel(true)} className="text-muted-foreground hover:text-primary">
            <Megaphone className="h-5 w-5" />
          </Button>
          <Button variant="ghost" size="icon" onClick={() => setShowNewGroup(true)} className="text-muted-foreground hover:text-primary">
            <Users className="h-5 w-5" />
          </Button>
          <Button variant="ghost" size="icon" onClick={() => setShowNewChat(true)} className="text-muted-foreground hover:text-primary">
            <Plus className="h-5 w-5" />
          </Button>
        </div>
      </div>

      {/* Weather widget - collapsible */}
      <div className="border-b border-sidebar-border">
        <button
          onClick={() => setWeatherOpen(!weatherOpen)}
          className="flex w-full items-center justify-between px-4 py-2 text-xs text-muted-foreground hover:bg-sidebar-accent transition-colors"
        >
          <div className="flex items-center gap-1.5">
            <CloudSun className="h-3.5 w-3.5" />
            <span>Погода</span>
          </div>
          {weatherOpen ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
        </button>
        {weatherOpen && (
          <div className="px-4 pb-2.5 animate-in slide-in-from-top-2 duration-200">
            {weatherData ? (
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="text-2xl">{weatherData.icon}</span>
                  <div>
                    <p className="text-sm font-medium text-foreground">{weatherData.temp === 0 && weatherData.description === 'Откройте прогноз' ? '—' : `${weatherData.temp}°C`}</p>
                    <a
                      href={`https://global-weather-world.lovable.app/?city=${encodeURIComponent(weatherCity)}`}
                      target="_blank"
                      rel="noreferrer"
                      className="text-[10px] text-muted-foreground leading-tight hover:text-primary transition-colors"
                    >
                      {weatherData.description}
                    </a>
                  </div>
                </div>
                {editingCity ? (
                  <div className="flex items-center gap-1">
                    <Input
                      value={cityInput}
                      onChange={(e) => setCityInput(e.target.value)}
                      onKeyDown={(e) => e.key === 'Enter' && saveCity()}
                      className="h-6 w-24 text-[10px] bg-secondary border-none px-2"
                      placeholder="Город..."
                      autoFocus
                      onBlur={saveCity}
                    />
                  </div>
                ) : (
                  <button
                    onClick={(e) => { e.stopPropagation(); setCityInput(weatherCity); setEditingCity(true); }}
                    className="flex items-center gap-1 text-[10px] text-muted-foreground hover:text-primary transition-colors"
                  >
                    <MapPin className="h-3 w-3" />
                    {weatherData.city || weatherCity}
                  </button>
                )}
              </div>
            ) : (
              <p className="text-xs text-muted-foreground">Загрузка...</p>
            )}
          </div>
        )}
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
                    {chat.isSavedMessages ? '⭐' : chat.isChannel ? '📣' : chat.isGroup ? '👥' : chat.participantName.charAt(0).toUpperCase()}
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
              {!chat.isGroup && !chat.isSavedMessages && chat.participantUserId && (
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
      <NewChannelDialog open={showNewChannel} onOpenChange={setShowNewChannel} onChannelCreated={(id) => { handleSelectChat(id); loadChats(); }} />

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

            {/* Digital Detox */}
            <div className="rounded-lg bg-secondary/50 p-3">
              <div className="flex items-center gap-2 mb-1">
                <Clock className="h-4 w-4 text-muted-foreground" />
                <label className="text-sm font-medium text-foreground">Digital Detox</label>
              </div>
              <p className="text-xs text-muted-foreground mb-1">Время в приложении сегодня</p>
              <p className="text-lg font-bold text-primary">{formatDetoxTime(detoxSeconds)}</p>
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
                    style={typeof wp.css === 'function' && wp.css(wallpaperColor) ? { background: `${wp.css(wallpaperColor)}, hsl(var(--background))`, backgroundSize: wp.size } : { background: 'hsl(var(--background))' }}
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
              
              {/* Wallpaper color */}
              {wallpaperId !== 'none' && wallpaperId !== 'custom' && (
                <div className="mt-3">
                  <label className="text-xs text-muted-foreground mb-1.5 block">Цвет обоев</label>
                  <div className="flex gap-2 flex-wrap">
                    {WALLPAPER_COLORS.map((wc) => (
                      <button
                        key={wc.name}
                        onClick={() => setWallpaperColor(wc.color)}
                        className={`h-7 w-7 rounded-full transition-all duration-200 border-2 ${wallpaperColor === wc.color ? 'border-foreground scale-110' : 'border-border'}`}
                        style={{ backgroundColor: wc.color ? `hsl(${wc.color})` : 'hsl(var(--muted))' }}
                        title={wc.name}
                      />
                    ))}
                  </div>
                </div>
              )}
            </div>

            {/* Weather city setting */}
            <div>
              <div className="flex items-center gap-2 mb-2">
                <MapPin className="h-4 w-4 text-muted-foreground" />
                <label className="text-sm font-medium text-foreground">Город для погоды</label>
              </div>
              <Input
                value={weatherCity}
                onChange={(e) => {
                  setWeatherCity(e.target.value);
                  localStorage.setItem('weather-city', e.target.value);
                }}
                className="bg-secondary border-none text-sm"
                placeholder="Введите город..."
              />
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
