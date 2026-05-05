import { useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';

const VAPID_PUBLIC_KEY = 'BO0EswuFP5ApodlzrXx85I4b_uh1C1YQggYv7wggqSksMV9qGOL_A1URE0fQ2J3eH4K0xzOGnXwQiUyXMvrjWGE';

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}

export function usePushSubscription() {
  const { user } = useAuth();

  useEffect(() => {
    if (!user) return;
    if (!('serviceWorker' in navigator) || !('PushManager' in window)) return;

    const subscribe = async () => {
      try {
        const registration = await navigator.serviceWorker.register('/sw-push.js');
        await navigator.serviceWorker.ready;

        if (!('Notification' in window)) return;
        if (Notification.permission === 'default') {
          try { await Notification.requestPermission(); } catch {}
        }
        if (Notification.permission !== 'granted') return;

        // Unsubscribe old subscription if exists (in case VAPID key changed)
        const existing = await registration.pushManager.getSubscription();
        if (existing) {
          await existing.unsubscribe();
        }

        const subscription = await registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY) as BufferSource,
        });

        const subJson = subscription.toJSON();
        const endpoint = subJson.endpoint!;
        const p256dh = subJson.keys!.p256dh!;
        const auth = subJson.keys!.auth!;

        // Upsert subscription
        const { data: existingRow } = await supabase
          .from('push_subscriptions')
          .select('id')
          .eq('user_id', user.id)
          .eq('endpoint', endpoint)
          .maybeSingle();

        if (existingRow) {
          await supabase.from('push_subscriptions')
            .update({ p256dh, auth })
            .eq('id', existingRow.id);
        } else {
          await supabase.from('push_subscriptions').insert({
            user_id: user.id,
            endpoint,
            p256dh,
            auth,
          });
        }
      } catch (err) {
        console.error('Push subscription error:', err);
      }
    };

    subscribe();
  }, [user]);
}
