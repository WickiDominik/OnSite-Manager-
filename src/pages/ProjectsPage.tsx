import { useLiveQuery } from 'dexie-react-hooks';
import { Building2, Cloud, Download, FileUp, MapPin, MoreVertical, Plus, RefreshCw, Settings, Trash2 } from 'lucide-react';
import { useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { BcfBadge, ProjectStatusBadge } from '../components/Badges';
import { CloudImportSheet } from '../components/CloudImportSheet';
import { Brand, NetPill, OfflineBanner } from '../components/Header';
import { SettingsSheet } from '../components/SettingsSheet';
import { Sheet } from '../components/Sheet';
import { SyncDialog } from '../components/SyncDialog';
import { useToast } from '../components/Toast';
import { exportBcfZip, importBcfZip } from '../lib/bcfZip';
import { startLogin } from '../lib/bimcollab';
import { db, deleteProjectCascade } from '../lib/db';
import { BIMCOLLAB_ENABLED } from '../lib/features';
import { useBimCollab, useOnline } from '../lib/hooks';
import { PROJECT_STATUS_LABEL, type Project, type ProjectStatus } from '../lib/types';
import { nowIso, safeFileName, saveFile, uuid } from '../lib/util';

export function ProjectsPage() {
  const nav = useNavigate();
  const toast = useToast();
  const online = useOnline();
  const bim = useBimCollab();
  const [showNew, setShowNew] = useState(false);
  const [showSettings, setShowSettings] = useState<false | 'menu' | 'cloud'>(false);
  const [showCloud, setShowCloud] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [menuFor, setMenuFor] = useState<Project>();
  const importRef = useRef<HTMLInputElement>(null);

  const projects = useLiveQuery(() => db.projects.orderBy('updatedAt').reverse().toArray(), []);
  const stats = useLiveQuery(async () => {
    const all = await db.issues.toArray();
    const map = new Map<string, { open: number; total: number }>();
    let unsynced = 0;
    for (const i of all) {
      const s = map.get(i.projectId) ?? { open: 0, total: 0 };
      s.total++;
      if (i.status !== 'done') s.open++;
      map.set(i.projectId, s);
      if (!i.synced) unsynced++;
    }
    return { map, unsynced };
  }, []);

  const onImport = async (f?: File | null) => {
    if (!f) return;
    if (/\.ifc$/i.test(f.name)) return importIfcAsProject(f);
    try {
      const r = await importBcfZip(f, f.name);
      toast(`„${r.projectName}“ importiert: ${r.issues} Mängel`, 'success');
      nav(`/projects/${r.projectId}`);
    } catch (e) {
      toast('Import fehlgeschlagen: ' + (e as Error).message, 'error');
    }
  };

  /** IFC from the cloud on the project list: new project named after the model, with the model attached. */
  const importIfcAsProject = async (f: File) => {
    const ts = nowIso();
    const p: Project = { id: uuid(), name: f.name.replace(/\.ifc$/i, ''), location: '', status: 'active', createdAt: ts, updatedAt: ts };
    await db.projects.add(p);
    await db.ifcModels.put({ projectId: p.id, fileName: f.name, data: f, uploadedAt: ts });
    toast(`Projekt „${p.name}“ mit IFC-Modell angelegt`, 'success');
    nav(`/projects/${p.id}`);
  };

  return (
    <div className="app">
      <header className="header">
        <Brand />
        <NetPill />
        <button className="icon-btn" aria-label="Einstellungen" onClick={() => setShowSettings('menu')}>
          <Settings />
        </button>
      </header>

      <main className="content">
        <OfflineBanner />
        {!BIMCOLLAB_ENABLED && (
          <div className="banner info">
            <span className="grow">
              <strong>Lokaler Modus</strong>
              <br />
              <span className="small muted">Alle Daten bleiben auf diesem Gerät. Austausch per BCF-Datei (Import / Export im Projektmenü).</span>
            </span>
          </div>
        )}
        {BIMCOLLAB_ENABLED && !bim.loading && !bim.connected && (
          <div className="banner info">
            <span className="grow">
              <strong>BimCollab nicht verbunden</strong>
              <br />
              <span className="small muted">Verbinde dein Konto, um Projekte und Themen abzugleichen.</span>
            </span>
            <button className="btn primary sm" disabled={!online} onClick={() => startLogin().catch((e) => toast(e.message, 'error'))}>
              Verbinden
            </button>
          </div>
        )}
        {BIMCOLLAB_ENABLED && bim.connected && (
          <div className="banner ok">
            <span className="grow">
              <strong>BimCollab verbunden</strong>
              {bim.user && <span className="small muted"> · {bim.user.name}</span>}
              <br />
              <span className="small muted">
                {stats?.unsynced ? `${stats.unsynced} Prüfbericht${stats.unsynced === 1 ? '' : 'e'} nicht synchronisiert` : 'Alles synchronisiert'}
              </span>
            </span>
            <button className="btn primary sm" disabled={!online} onClick={() => setSyncing(true)}>
              <RefreshCw size={16} /> Sync
            </button>
          </div>
        )}

        <div className="row" style={{ marginTop: 6 }}>
          <div className="section-title grow" style={{ margin: '10px 4px' }}>
            Projekte {projects ? `(${projects.length})` : ''}
          </div>
          <button className="btn sm" onClick={() => importRef.current?.click()}>
            <FileUp size={16} /> BCF importieren
          </button>
          <button className="btn sm" onClick={() => setShowCloud(true)}>
            <Cloud size={16} /> Cloud
          </button>
          <input ref={importRef} type="file" accept=".bcfzip,.bcf,application/zip,application/octet-stream" hidden onChange={(e) => (onImport(e.target.files?.[0]), (e.target.value = ''))} />
        </div>

        {projects && projects.length === 0 && (
          <div className="empty">
            <Building2 size={64} />
            <p>
              Noch keine Projekte.
              <br />
              {BIMCOLLAB_ENABLED ? 'Lege ein Projekt an, importiere eine BCF-Datei oder gleiche mit BimCollab ab.' : 'Lege ein Projekt an oder importiere eine BCF-Datei.'}
            </p>
          </div>
        )}

        <div className="list">
          {projects?.map((p) => {
            const s = stats?.map.get(p.id);
            return (
              <div key={p.id} className="card row" style={{ padding: 0 }}>
                <button
                  className="grow"
                  style={{ background: 'none', border: 0, textAlign: 'left', padding: 14, cursor: 'pointer', color: 'inherit' }}
                  onClick={() => nav(`/projects/${p.id}`)}
                >
                  <div className="row wrap" style={{ gap: 6 }}>
                    <p className="card-title grow">{p.name}</p>
                    {p.bcfProjectId && <BcfBadge />}
                    <ProjectStatusBadge status={p.status} />
                  </div>
                  <div className="card-meta">
                    {p.location && (
                      <span className="row" style={{ gap: 4 }}>
                        <MapPin size={14} /> {p.location}
                      </span>
                    )}
                    <span>
                      {s ? `${s.open} offen · ${s.total} gesamt` : 'Keine Mängel'}
                    </span>
                  </div>
                </button>
                <button className="icon-btn" aria-label="Projektmenü" onClick={() => setMenuFor(p)} style={{ marginRight: 4 }}>
                  <MoreVertical />
                </button>
              </div>
            );
          })}
        </div>
      </main>

      <button className="fab" onClick={() => setShowNew(true)}>
        <Plus /> Neues Projekt
      </button>

      {showNew && <NewProjectSheet onClose={() => setShowNew(false)} />}
      {showSettings && <SettingsSheet initialView={showSettings} onClose={() => setShowSettings(false)} />}
      {showCloud && (
        <CloudImportSheet
          accept={['.bcfzip', '.bcf', '.ifc']}
          onClose={() => setShowCloud(false)}
          onOpenSettings={() => (setShowCloud(false), setShowSettings('cloud'))}
          onFile={async (f) => {
            await onImport(f);
            setShowCloud(false);
          }}
        />
      )}
      {BIMCOLLAB_ENABLED && syncing && <SyncDialog onClose={() => setSyncing(false)} />}
      {menuFor && <ProjectMenu project={menuFor} onClose={() => setMenuFor(undefined)} />}
    </div>
  );
}

function NewProjectSheet({ onClose }: { onClose: () => void }) {
  const [name, setName] = useState('');
  const [location, setLocation] = useState('');
  const toast = useToast();
  const nav = useNavigate();
  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    const ts = nowIso();
    const p: Project = { id: uuid(), name: name.trim(), location: location.trim(), status: 'active', createdAt: ts, updatedAt: ts };
    await db.projects.add(p);
    toast('Projekt angelegt', 'success');
    onClose();
    nav(`/projects/${p.id}`);
  };
  return (
    <Sheet title="Neues Projekt" onClose={onClose}>
      <form className="stack" onSubmit={save}>
        <label className="field">
          <span>Name *</span>
          <input className="input" autoFocus required value={name} onChange={(e) => setName(e.target.value)} placeholder="z. B. Neubau MFH Seefeld" />
        </label>
        <label className="field">
          <span>Ort</span>
          <input className="input" value={location} onChange={(e) => setLocation(e.target.value)} placeholder="z. B. Zürich" />
        </label>
        <button className="btn primary block" type="submit" disabled={!name.trim()}>
          Projekt anlegen
        </button>
      </form>
    </Sheet>
  );
}

function ProjectMenu({ project, onClose }: { project: Project; onClose: () => void }) {
  const toast = useToast();
  const setStatus = async (status: ProjectStatus) => {
    await db.projects.update(project.id, { status, updatedAt: nowIso() });
    onClose();
  };
  return (
    <Sheet title={project.name} onClose={onClose}>
      <div className="section-title" style={{ marginTop: 0 }}>
        Status
      </div>
      <div className="seg">
        {(Object.keys(PROJECT_STATUS_LABEL) as ProjectStatus[]).map((s) => (
          <button key={s} className={project.status === s ? 'on' : ''} onClick={() => setStatus(s)}>
            {PROJECT_STATUS_LABEL[s]}
          </button>
        ))}
      </div>
      <div className="section-title">Aktionen</div>
      <button
        className="menu-item"
        onClick={async () => {
          try {
            await saveFile(await exportBcfZip(project.id), `${safeFileName(project.name)}.bcfzip`);
            toast('BCF-Export erstellt', 'success');
          } catch (e) {
            toast((e as Error).message, 'error');
          }
          onClose();
        }}
      >
        <Download size={22} /> <span className="grow">Als .bcfzip exportieren</span>
      </button>
      <button
        className="menu-item"
        style={{ color: '#fca5a5' }}
        onClick={async () => {
          if (!window.confirm(`Projekt „${project.name}“ mit allen Mängeln und Fotos löschen?`)) return;
          await deleteProjectCascade(project.id);
          toast('Projekt gelöscht');
          onClose();
        }}
      >
        <Trash2 size={22} /> <span className="grow">Projekt löschen</span>
      </button>
    </Sheet>
  );
}
