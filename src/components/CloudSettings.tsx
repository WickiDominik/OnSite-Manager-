import { useLiveQuery } from 'dexie-react-hooks';
import { Cloud, KeyRound, Link, Plus, Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { getAccounts, PROVIDER_LABEL, removeAccount, saveAccount, K_ACCOUNTS, type CloudAccount } from '../lib/cloud';
import { connectNextcloud } from '../lib/cloud/nextcloud';
import {
  getStoredOneDriveConfig,
  getOneDriveConfig,
  oneDriveRedirectUri,
  saveOneDriveConfig,
  startOneDriveLogin,
  DEFAULT_ONEDRIVE,
  type OneDriveConfig,
} from '../lib/cloud/onedrive';
import { db } from '../lib/db';
import { useOnline } from '../lib/hooks';
import { Sheet } from './Sheet';
import { useToast } from './Toast';

export function useCloudAccounts(): CloudAccount[] | undefined {
  return useLiveQuery(async () => {
    await db.kv.get(K_ACCOUNTS); // subscribe to the row
    return getAccounts();
  }, []);
}

type View = 'list' | 'nextcloud' | 'onedrive';

export function CloudSettingsSheet({ onClose, onBack }: { onClose: () => void; onBack: () => void }) {
  const [view, setView] = useState<View>('list');
  if (view === 'nextcloud') return <NextcloudForm onClose={onClose} onBack={() => setView('list')} />;
  if (view === 'onedrive') return <OneDriveForm onClose={onClose} onBack={() => setView('list')} />;
  return <AccountList onClose={onClose} onBack={onBack} onAdd={setView} />;
}

function AccountList({ onClose, onBack, onAdd }: { onClose: () => void; onBack: () => void; onAdd: (v: View) => void }) {
  const accounts = useCloudAccounts();
  const toast = useToast();
  return (
    <Sheet title="Cloud-Speicher" onClose={onClose}>
      <p className="muted small" style={{ marginTop: 0 }}>
        Verbundene Laufwerke stehen beim Import zur Verfügung (BCF-Dateien als Projekt, IFC-Modelle am Projekt).
      </p>
      {accounts?.length === 0 && <p className="muted">Noch kein Cloud-Speicher verbunden.</p>}
      {accounts?.map((a) => (
        <div key={a.id} className="menu-item" style={{ cursor: 'default' }}>
          <Cloud size={22} />
          <span className="grow">
            {PROVIDER_LABEL[a.provider]}
            <span className="muted small" style={{ display: 'block', fontWeight: 400, overflowWrap: 'anywhere' }}>
              {a.label}
            </span>
          </span>
          <button
            className="icon-btn"
            aria-label="Verbindung entfernen"
            onClick={async () => {
              if (!window.confirm(`${PROVIDER_LABEL[a.provider]}-Verbindung „${a.label}“ entfernen?`)) return;
              await removeAccount(a.id);
              toast('Verbindung entfernt');
            }}
          >
            <Trash2 size={20} />
          </button>
        </div>
      ))}
      <div className="stack" style={{ marginTop: 16 }}>
        <button className="btn block" onClick={() => onAdd('nextcloud')}>
          <Plus size={20} /> Nextcloud hinzufügen
        </button>
        <button className="btn block" onClick={() => onAdd('onedrive')}>
          <Plus size={20} /> OneDrive hinzufügen
        </button>
        <button className="btn ghost block" onClick={onBack}>
          Zurück
        </button>
      </div>
    </Sheet>
  );
}

function NextcloudForm({ onClose, onBack }: { onClose: () => void; onBack: () => void }) {
  const toast = useToast();
  const online = useOnline();
  const [f, setF] = useState({ url: '', loginName: '', appPassword: '' });
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement>) => setF({ ...f, [k]: e.target.value });
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      const acc = await connectNextcloud(f);
      await saveAccount(acc);
      toast('Nextcloud verbunden', 'success');
      onBack();
    } catch (err) {
      toast((err as Error).message, 'error');
    } finally {
      setBusy(false);
    }
  };
  return (
    <Sheet title="Nextcloud hinzufügen" onClose={onClose}>
      <form className="stack" onSubmit={submit}>
        <p className="muted small" style={{ marginTop: 0 }}>
          Am besten ein App-Passwort verwenden: in Nextcloud unter <em>Persönliche Einstellungen → Sicherheit → Geräte &amp; Sitzungen</em> „Neues
          App-Passwort erstellen“.
        </p>
        <label className="field">
          <span>Server-Adresse *</span>
          <input className="input" inputMode="url" autoCapitalize="off" required placeholder="https://cloud.firma.ch" value={f.url} onChange={set('url')} />
        </label>
        <label className="field">
          <span>Benutzername *</span>
          <input className="input" autoCapitalize="off" autoComplete="username" required value={f.loginName} onChange={set('loginName')} />
        </label>
        <label className="field">
          <span>App-Passwort *</span>
          <input className="input" type="password" autoComplete="current-password" required value={f.appPassword} onChange={set('appPassword')} />
        </label>
        <button className="btn primary block" type="submit" disabled={busy || !online}>
          <Link size={20} /> {busy ? 'Verbindung wird geprüft …' : 'Verbinden'}
        </button>
        {!online && <p className="muted small">Zum Verbinden wird eine Internetverbindung benötigt.</p>}
        <button className="btn ghost block" type="button" onClick={onBack}>
          Zurück
        </button>
      </form>
    </Sheet>
  );
}

function OneDriveForm({ onClose, onBack }: { onClose: () => void; onBack: () => void }) {
  const toast = useToast();
  const online = useOnline();
  const [cfg, setCfg] = useState<Partial<OneDriveConfig>>({});
  const [effective, setEffective] = useState<OneDriveConfig>(DEFAULT_ONEDRIVE);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    getStoredOneDriveConfig().then((c) => setCfg(c ?? {}));
    getOneDriveConfig().then(setEffective);
  }, []);
  const clientId = cfg.clientId?.trim() || effective.clientId;
  return (
    <Sheet title="OneDrive hinzufügen" onClose={onClose}>
      <div className="stack">
        <p className="muted small" style={{ marginTop: 0 }}>
          Für OneDrive / SharePoint wird eine App-Registrierung in Microsoft Entra ID (Azure) benötigt. Dort diese Weiterleitungs-URL eintragen:
          <br />
          <code style={{ wordBreak: 'break-all' }}>{oneDriveRedirectUri()}</code>
        </p>
        <label className="field">
          <span>Client-ID (Anwendungs-ID)</span>
          <input
            className="input"
            autoCapitalize="off"
            placeholder={DEFAULT_ONEDRIVE.clientId || '00000000-0000-0000-0000-000000000000'}
            value={cfg.clientId ?? ''}
            onChange={(e) => setCfg({ ...cfg, clientId: e.target.value })}
          />
        </label>
        <label className="field">
          <span>Verzeichnis (Tenant)</span>
          <input
            className="input"
            autoCapitalize="off"
            placeholder={DEFAULT_ONEDRIVE.tenant}
            value={cfg.tenant ?? ''}
            onChange={(e) => setCfg({ ...cfg, tenant: e.target.value })}
          />
        </label>
        <p className="muted small">Firmen-Domain (z. B. schaerholzbau.ch) oder Mandanten-ID. „common“ nur, wenn die App für mehrere Organisationen freigegeben ist.</p>
        <button
          className="btn primary block"
          disabled={busy || !online || !clientId}
          onClick={async () => {
            setBusy(true);
            try {
              await saveOneDriveConfig(cfg);
              await startOneDriveLogin();
            } catch (e) {
              toast((e as Error).message, 'error');
              setBusy(false);
            }
          }}
        >
          <Link size={20} /> {busy ? 'Weiterleitung …' : 'Mit Microsoft anmelden'}
        </button>
        <button
          className="btn block"
          disabled={busy}
          onClick={async () => {
            await saveOneDriveConfig(cfg);
            toast('OneDrive-Einstellungen gespeichert', 'success');
          }}
        >
          <KeyRound size={20} /> Nur speichern
        </button>
        {!online && <p className="muted small">Zum Verbinden wird eine Internetverbindung benötigt.</p>}
        <button className="btn ghost block" onClick={onBack}>
          Zurück
        </button>
      </div>
    </Sheet>
  );
}
