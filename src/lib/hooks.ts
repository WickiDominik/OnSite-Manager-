import { useEffect, useState } from 'react';
import { getUser, isConnected, onAuthChange, type BimCollabUser } from './bimcollab';

export function useOnline(): boolean {
  const [online, setOnline] = useState(typeof navigator === 'undefined' ? true : navigator.onLine);
  useEffect(() => {
    const up = () => setOnline(true);
    const down = () => setOnline(false);
    window.addEventListener('online', up);
    window.addEventListener('offline', down);
    return () => {
      window.removeEventListener('online', up);
      window.removeEventListener('offline', down);
    };
  }, []);
  return online;
}

export function useBimCollab(): { connected: boolean; user?: BimCollabUser; loading: boolean } {
  const [state, setState] = useState<{ connected: boolean; user?: BimCollabUser; loading: boolean }>({ connected: false, loading: true });
  useEffect(() => {
    let alive = true;
    const load = async () => {
      const [connected, user] = await Promise.all([isConnected(), getUser()]);
      if (alive) setState({ connected, user, loading: false });
    };
    load();
    const off = onAuthChange(load);
    return () => {
      alive = false;
      off();
    };
  }, []);
  return state;
}
