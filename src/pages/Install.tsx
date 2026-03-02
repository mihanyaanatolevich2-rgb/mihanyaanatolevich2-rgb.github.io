import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Download, Check, Smartphone } from 'lucide-react';

const Install = () => {
  const [deferredPrompt, setDeferredPrompt] = useState<any>(null);
  const [installed, setInstalled] = useState(false);

  useEffect(() => {
    const handler = (e: Event) => {
      e.preventDefault();
      setDeferredPrompt(e);
    };
    window.addEventListener('beforeinstallprompt', handler);

    window.addEventListener('appinstalled', () => setInstalled(true));

    // Check if already installed
    if (window.matchMedia('(display-mode: standalone)').matches) {
      setInstalled(true);
    }

    return () => window.removeEventListener('beforeinstallprompt', handler);
  }, []);

  const handleInstall = async () => {
    if (!deferredPrompt) return;
    deferredPrompt.prompt();
    const result = await deferredPrompt.userChoice;
    if (result.outcome === 'accepted') setInstalled(true);
    setDeferredPrompt(null);
  };

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-background px-6 text-center">
      <div className="mb-6 flex h-20 w-20 items-center justify-center rounded-2xl gradient-primary shadow-glow">
        <Smartphone className="h-10 w-10 text-primary-foreground" />
      </div>
      <h1 className="text-2xl font-bold text-foreground mb-2">Bridge & Call</h1>
      <p className="text-muted-foreground mb-8 max-w-sm">
        Установите приложение на свой телефон для быстрого доступа к чатам и звонкам
      </p>

      {installed ? (
        <div className="flex items-center gap-2 text-primary">
          <Check className="h-5 w-5" />
          <span className="font-medium">Приложение установлено!</span>
        </div>
      ) : deferredPrompt ? (
        <Button onClick={handleInstall} className="gradient-primary text-primary-foreground px-8 py-3 text-base rounded-xl">
          <Download className="h-5 w-5 mr-2" /> Установить
        </Button>
      ) : (
        <div className="space-y-4 text-sm text-muted-foreground max-w-sm">
          <p className="font-medium text-foreground">Как установить:</p>
          <div className="text-left space-y-2">
            <p><strong>iPhone:</strong> Нажмите «Поделиться» → «На экран «Домой»»</p>
            <p><strong>Android:</strong> Меню браузера → «Установить приложение» или «Добавить на главный экран»</p>
          </div>
        </div>
      )}

      <a href="/" className="mt-8 text-sm text-primary hover:underline">← Вернуться к чату</a>
    </div>
  );
};

export default Install;
