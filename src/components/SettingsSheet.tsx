import { Building2, ChevronRight, KeyRound, Link, LogOut, Unlink, User } from 'lucide-react';
import { useEffect, useState } from 'react';
import {
  disconnect,
  getStoredTenant,
  PLAYGROUND,
  redirectUri,
  saveTenant,
  startLogin,
  type TenantSettings,
} from '../lib/bimcollab';
import { useBimCollab, useOnline } from '../lib/hooks';
import { authEnabled, signOut, supabase } from '../lib/platformAuth';
import { Sheet } from './Sheet';
import { useToast } from './Toast';

export function SettingsSheet({ onClose }: { onClose: () => void }) {
  const [view, setView] = useState<'menu' | 'account' | 'tenant'>('menu');
  const [email, setEmail] = useState<string>();
  useEffect(() => {
    supabase?.auth.getUser().then(({ data }) => setEmail(data.user?.email ?? undefined));
  }, []);

  if (view === 'account') return <AccountSheet onClose={onClose} onBack={() => setView('menu')} />;
  if (view === 'tenant') return <TenantSheet onClose={onClose} onBack={() => setView('menu')} />;
  return (
    <Sheet title="Einstellungen" onClose={onClose}>
      <button className="menu-item" onClick={() => setView('account')}>
        <User size={22} />
        <span className="grow">BimCollab-Konto</span>
        <ChevronRight size={20} className="muted" />
      </button>
      <button className="menu-item" onClick={() => setView('tenant')}>
        <Building2 size={22} />
        <span className="grow">Mandanten-Einstellungen</span>
        <ChevronRight size={20} className="muted" />
      </button>
      {authEnabled && (
        <button
          className="menu-item"
          onClick={async () => {
            await signOut();
            onClose();
          }}
        >
          <LogOut size={22} />
          <span className="grow">
            Abmelden
            {email && <span className="muted small" style={{ display: 'block', fontWeight: 400 }}>{email}</span>}
          </span>
        </button>
      )}
      <p className="muted small center" style={{ marginTop: 16 }}>
        BCF-OnSite · Version {__APP_VERSION__}
      </p>
    </Sheet>
  );
}

function AccountSheet({ onClose, onBack }: { onClose: () => void; onBack: () => void }) {
  const { connected, user } = useBimCollab();
  const online = useOnline();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [tenant, setTenant] = useState<string>(PLAYGROUND.baseUrl);
  useEffect(() => {
    getStoredTenant().then((t) => setTenant(t?.baseUrl || PLAYGROUND.baseUrl));
  }, []);

  return (
    <Sheet title="BimCollab-Konto" onClose={onClose}>
      <div className="stack">
        <dl className="kv">
          <dt>Server</dt>
          <dd>{tenant}</dd>
          <dt>Status</dt>
          <dd>{connected ? 'Verbunden' : 'Nicht verbunden'}</dd>
          {user && (
            <>
              <dt>Benutzer</dt>
              <dd>{user.name}</dd>
            </>
          )}
        </dl>
        {connected ? (
          <button
            className="btn danger block"
            onClick={async () => {
              await disconnect();
              toast('BimCollab-Konto getrennt');
            }}
          >
            <Unlink size={20} /> Konto trennen
          </button>
        ) : (
          <button
            className="btn primary block"
            disabled={busy || !online}
            onClick={async () => {
              setBusy(true);
              try {
                await startLogin();
              } catch (e) {
                toast((e as Error).message, 'error');
                setBusy(false);
              }
            }}
          >
            <Link size={20} /> {busy ? 'Weiterleitung …' : 'Mit BimCollab verbinden'}
          </button>
        )}
        {!online && !connected && <p className="muted small">Zum Verbinden wird eine Internetverbindung benötigt.</p>}
        <button className="btn ghost block" onClick={onBack}>
          Zurück
        </button>
      </div>
    </Sheet>
  );
}

function TenantSheet({ onClose, onBack }: { onClose: () => void; onBack: () => void }) {
  const toast = useToast();
  const [t, setT] = useState<Partial<TenantSettings>>({});
  useEffect(() => {
    getStoredTenant().then((s) => setT(s ?? {}));
  }, []);
  const set = (k: keyof TenantSettings) => (e: React.ChangeEvent<HTMLInputElement>) => setT({ ...t, [k]: e.target.value });

  return (
    <Sheet title="Mandanten-Einstellungen" onClose={onClose}>
      <div className="stack">
        <p className="muted small">
          Eigene BimCollab-Umgebung hinterlegen. Leer lassen, um den BimCollab-Playground zu verwenden. Bei eigener Client-ID muss diese
          Weiterleitungs-URL in BimCollab registriert sein:
          <br />
          <code style={{ wordBreak: 'break-all' }}>{redirectUri()}</code>
        </p>
        <label className="field">
          <span>BimCollab-URL</span>
          <input className="input" inputMode="url" placeholder={PLAYGROUND.baseUrl} value={t.baseUrl ?? ''} onChange={set('baseUrl')} />
        </label>
        <label className="field">
          <span>Client-ID</span>
          <input className="input" placeholder={PLAYGROUND.clientId} value={t.clientId ?? ''} onChange={set('clientId')} autoCapitalize="off" />
        </label>
        <label className="field">
          <span>Client-Secret</span>
          <input className="input" type="password" placeholder="optional" value={t.clientSecret ?? ''} onChange={set('clientSecret')} />
        </label>
        <label className="field">
          <span>Scopes</span>
          <input className="input" placeholder={PLAYGROUND.scope} value={t.scope ?? ''} onChange={set('scope')} autoCapitalize="off" />
        </label>
        <button
          className="btn primary block"
          onClick={async () => {
            await saveTenant(t.baseUrl ? t : undefined);
            toast('Mandanten-Einstellungen gespeichert', 'success');
            onBack();
          }}
        >
          <KeyRound size={20} /> Speichern
        </button>
        <button
          className="btn block"
          onClick={async () => {
            await saveTenant(undefined);
            setT({});
            toast('Auf Playground zurückgesetzt');
          }}
        >
          Playground verwenden
        </button>
        <button className="btn ghost block" onClick={onBack}>
          Zurück
        </button>
      </div>
    </Sheet>
  );
}
