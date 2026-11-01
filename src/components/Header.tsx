import { ArrowLeft } from 'lucide-react';
import type { ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { useOnline } from '../lib/hooks';

export function NetPill() {
  const online = useOnline();
  return (
    <span className={`net-pill ${online ? '' : 'offline'}`} aria-label={online ? 'Online' : 'Offline'}>
      <span className="dot" />
      {online ? 'Online' : 'Offline'}
    </span>
  );
}

export function Brand() {
  return (
    <div className="brand">
      <div className="brand-logo">B</div>
      <div className="brand-name">
        BCF-<span>OnSite</span>
      </div>
    </div>
  );
}

export function PageHeader({ title, sub, back, actions }: { title: string; sub?: string; back?: string; actions?: ReactNode }) {
  const nav = useNavigate();
  return (
    <header className="header">
      <button className="icon-btn" aria-label="Zurück" onClick={() => (back ? nav(back) : nav(-1))}>
        <ArrowLeft />
      </button>
      <h1>
        {title}
        {sub && <span className="sub">{sub}</span>}
      </h1>
      {actions}
    </header>
  );
}

export function OfflineBanner() {
  const online = useOnline();
  if (online) return null;
  return (
    <div className="banner offline">
      <strong>Offline</strong>
      <span className="grow small">Prüfberichte werden lokal gespeichert und beim nächsten Abgleich zu BimCollab übertragen.</span>
    </div>
  );
}
