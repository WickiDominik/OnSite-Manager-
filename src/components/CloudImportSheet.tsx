import { ChevronRight, Cloud, File as FileIcon, Folder, Loader2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { downloadEntry, formatSize, listFolder, matchesAccept, PROVIDER_LABEL, rootRef, type CloudAccount, type CloudEntry } from '../lib/cloud';
import { formatDate } from '../lib/util';
import { useCloudAccounts } from './CloudSettings';
import { Sheet } from './Sheet';

interface Crumb {
  ref: string;
  name: string;
}

/**
 * Browse a connected cloud drive and pick a file. The file is downloaded and handed to `onFile`;
 * the sheet stays open (with a spinner) until `onFile` resolves.
 */
export function CloudImportSheet({
  title = 'Aus Cloud importieren',
  accept,
  onFile,
  onClose,
  onOpenSettings,
}: {
  title?: string;
  accept: string[];
  onFile: (file: File) => Promise<void>;
  onClose: () => void;
  onOpenSettings?: () => void;
}) {
  const accounts = useCloudAccounts();
  const [account, setAccount] = useState<CloudAccount>();
  useEffect(() => {
    if (accounts?.length === 1 && !account) setAccount(accounts[0]);
  }, [accounts, account]);

  if (!accounts) return null;
  if (accounts.length === 0) {
    return (
      <Sheet title={title} onClose={onClose}>
        <div className="empty" style={{ padding: '20px 10px' }}>
          <Cloud size={56} />
          <p>Noch kein Cloud-Speicher verbunden. Nextcloud oder OneDrive unter Einstellungen → Cloud-Speicher hinzufügen.</p>
        </div>
        {onOpenSettings && (
          <button className="btn primary block" onClick={onOpenSettings}>
            Cloud-Speicher einrichten
          </button>
        )}
      </Sheet>
    );
  }
  if (!account) {
    return (
      <Sheet title={title} onClose={onClose}>
        {accounts.map((a) => (
          <button key={a.id} className="menu-item" onClick={() => setAccount(a)}>
            <Cloud size={22} />
            <span className="grow">
              {PROVIDER_LABEL[a.provider]}
              <span className="muted small" style={{ display: 'block', fontWeight: 400 }}>
                {a.label}
              </span>
            </span>
            <ChevronRight size={20} className="muted" />
          </button>
        ))}
      </Sheet>
    );
  }
  return (
    <Browser
      key={account.id}
      title={title}
      account={account}
      accept={accept}
      onFile={onFile}
      onClose={onClose}
      onSwitch={accounts.length > 1 ? () => setAccount(undefined) : undefined}
    />
  );
}

function Browser({
  title,
  account,
  accept,
  onFile,
  onClose,
  onSwitch,
}: {
  title: string;
  account: CloudAccount;
  accept: string[];
  onFile: (file: File) => Promise<void>;
  onClose: () => void;
  onSwitch?: () => void;
}) {
  const [path, setPath] = useState<Crumb[]>([{ ref: rootRef(account), name: PROVIDER_LABEL[account.provider] }]);
  const [entries, setEntries] = useState<CloudEntry[]>();
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState<string>();
  const current = path[path.length - 1];

  useEffect(() => {
    let alive = true;
    setEntries(undefined);
    setError(undefined);
    listFolder(account, current.ref)
      .then((e) => alive && setEntries(e))
      .catch((e) => alive && setError((e as Error).message));
    return () => {
      alive = false;
    };
  }, [account, current.ref]);

  const visible = entries?.filter((e) => e.isDir || matchesAccept(e.name, accept));
  const hidden = (entries?.length ?? 0) - (visible?.length ?? 0);

  const pick = async (e: CloudEntry) => {
    setBusy(e.name);
    setError(undefined);
    try {
      const file = await downloadEntry(account, e);
      await onFile(file);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(undefined);
    }
  };

  return (
    <Sheet title={title} onClose={busy ? () => {} : onClose}>
      <div className="row wrap small" style={{ gap: 4, marginBottom: 8 }}>
        {path.map((c, i) => (
          <span key={i} className="row" style={{ gap: 4 }}>
            {i > 0 && <ChevronRight size={14} className="muted" />}
            <button
              className="chip"
              style={{ minHeight: 32, padding: '0 10px' }}
              disabled={!!busy || i === path.length - 1}
              onClick={() => setPath(path.slice(0, i + 1))}
            >
              {c.name}
            </button>
          </span>
        ))}
      </div>
      <p className="muted small" style={{ margin: '0 0 8px' }}>
        {account.label} · Dateitypen: {accept.join(', ')}
      </p>

      {busy && (
        <div className="banner info">
          <Loader2 className="spin" size={18} />
          <span className="grow">„{busy}“ wird geladen …</span>
        </div>
      )}
      {error && (
        <div className="banner offline">
          <span className="grow small">{error}</span>
        </div>
      )}
      {!entries && !error && (
        <div className="empty" style={{ padding: 20 }}>
          <Loader2 className="spin" />
        </div>
      )}
      {visible?.length === 0 && <p className="muted center">Keine passenden Dateien in diesem Ordner.</p>}
      {visible?.map((e) => (
        <button
          key={e.ref}
          className="menu-item"
          disabled={!!busy}
          onClick={() => (e.isDir ? setPath([...path, { ref: e.ref, name: e.name }]) : pick(e))}
        >
          {e.isDir ? <Folder size={22} color="#f5c400" /> : <FileIcon size={22} />}
          <span className="grow" style={{ overflowWrap: 'anywhere' }}>
            {e.name}
            {!e.isDir && (
              <span className="muted small" style={{ display: 'block', fontWeight: 400 }}>
                {[formatSize(e.size), e.modified ? formatDate(e.modified) : ''].filter(Boolean).join(' · ')}
              </span>
            )}
          </span>
          {e.isDir && <ChevronRight size={20} className="muted" />}
        </button>
      ))}
      {hidden > 0 && <p className="muted small center">{hidden} weitere Datei{hidden === 1 ? '' : 'en'} ausgeblendet</p>}
      {onSwitch && (
        <button className="btn ghost block" style={{ marginTop: 12 }} disabled={!!busy} onClick={onSwitch}>
          Anderes Laufwerk wählen
        </button>
      )}
    </Sheet>
  );
}
