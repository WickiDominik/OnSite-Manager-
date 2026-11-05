import { useLiveQuery } from 'dexie-react-hooks';
import { AlertTriangle, Box, Check, CloudOff, Loader2, Save, Trash2 } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { BcfBadge, PriorityBadge, StatusBadge, SyncBadge } from '../components/Badges';
import { OfflineBanner, PageHeader } from '../components/Header';
import { PhotoCapture } from '../components/PhotoCapture';
import { PhotoEditor } from '../components/PhotoEditor';
import { useToast } from '../components/Toast';
import { BIMCOLLAB_ENABLED } from '../lib/features';
import { db, deleteIssueCascade } from '../lib/db';
import { STATUS_LABEL, type Issue, type IssueStatus, type Photo } from '../lib/types';
import { formatDate, nowIso, uuid } from '../lib/util';

type SaveState = 'idle' | 'dirty' | 'saving' | 'saved' | 'error';

export function IssueDetailPage() {
  const { projectId = '', issueId = '' } = useParams();
  const nav = useNavigate();
  const toast = useToast();
  const issue = useLiveQuery(() => db.issues.get(issueId), [issueId]);
  const photos = useLiveQuery(() => db.photos.where('issueId').equals(issueId).sortBy('createdAt'), [issueId]);

  const [remark, setRemark] = useState<string>();
  const [saveState, setSaveState] = useState<SaveState>('idle');
  const [lastSaved, setLastSaved] = useState<string>();
  const [editing, setEditing] = useState<{ src: string; photoId?: string }>();
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const pendingRemark = useRef<string | undefined>(undefined);

  // initialise the remark field once the issue is loaded
  useEffect(() => {
    if (issue && remark === undefined) setRemark(issue.remark);
  }, [issue, remark]);

  const persist = useCallback(
    async (patch: Partial<Issue>) => {
      setSaveState('saving');
      try {
        const ts = nowIso();
        await db.issues.update(issueId, { ...patch, synced: false, localOnly: false, updatedAt: ts });
        await db.projects.update(projectId, { updatedAt: ts });
        setSaveState('saved');
        setLastSaved(ts);
      } catch (e) {
        setSaveState('error');
        toast('Speichern fehlgeschlagen: ' + (e as Error).message, 'error');
      }
    },
    [issueId, projectId, toast],
  );

  const flushRemark = useCallback(async () => {
    clearTimeout(timer.current);
    if (pendingRemark.current !== undefined) {
      const text = pendingRemark.current;
      pendingRemark.current = undefined;
      await persist({ remark: text });
    }
  }, [persist]);

  // auto-save while typing
  const onRemark = (text: string) => {
    setRemark(text);
    pendingRemark.current = text;
    setSaveState('dirty');
    clearTimeout(timer.current);
    timer.current = setTimeout(flushRemark, 700);
  };

  // flush on leave
  useEffect(() => () => void flushRemark(), [flushRemark]);

  const setStatus = (status: IssueStatus) => persist({ status });

  const savePhoto = async (dataUrl: string) => {
    const target = editing;
    setEditing(undefined);
    if (target?.photoId) await db.photos.update(target.photoId, { dataUrl, synced: false });
    else {
      const p: Photo = { id: uuid(), issueId, dataUrl, synced: false, createdAt: nowIso() };
      await db.photos.add(p);
    }
    await persist({});
    toast('Foto gespeichert', 'success');
  };

  const deletePhoto = async (p: Photo) => {
    if (!window.confirm('Foto löschen?')) return;
    await db.photos.delete(p.id);
    toast('Foto gelöscht');
  };

  if (issue === undefined) {
    return (
      <div className="app">
        <PageHeader title="Prüfbericht" back={`/projects/${projectId}`} />
        <div className="empty">{photos === undefined ? 'Laden …' : 'Mangel nicht gefunden.'}</div>
      </div>
    );
  }

  return (
    <div className="app">
      <PageHeader
        title="Prüfbericht"
        sub={issue.title}
        back={`/projects/${projectId}`}
        actions={
          <button
            className="icon-btn"
            aria-label="Mangel löschen"
            onClick={async () => {
              if (!window.confirm('Diesen Mangel lokal löschen?')) return;
              await deleteIssueCascade(issue.id);
              nav(`/projects/${projectId}`, { replace: true });
            }}
          >
            <Trash2 />
          </button>
        }
      />
      <main className="content" style={{ paddingBottom: 'calc(120px + var(--safe-bottom))' }}>
        <OfflineBanner />

        <section className="card">
          <h2 className="card-title" style={{ fontSize: 20 }}>
            {issue.title}
          </h2>
          <div className="row wrap" style={{ gap: 6, margin: '10px 0' }}>
            <StatusBadge status={issue.status} />
            <PriorityBadge priority={issue.priority} />
            {issue.bcfGuid && <BcfBadge />}
            {BIMCOLLAB_ENABLED && <SyncBadge synced={issue.synced} />}
          </div>
          {issue.description && <p style={{ whiteSpace: 'pre-wrap', margin: '8px 0 12px' }}>{issue.description}</p>}
          <dl className="kv small">
            <dt>Ort</dt>
            <dd>{issue.location || '–'}</dd>
            {issue.author && (
              <>
                <dt>Erfasst von</dt>
                <dd>{issue.author}</dd>
              </>
            )}
            <dt>Erstellt</dt>
            <dd>{formatDate(issue.createdAt)}</dd>
            <dt>Geändert</dt>
            <dd>{formatDate(issue.updatedAt)}</dd>
            {BIMCOLLAB_ENABLED && (
              <>
                <dt>Sync</dt>
                <dd>
                  {issue.synced
                    ? issue.localOnly
                      ? 'Nur lokal (ohne BimCollab-Bezug)'
                      : `Synchronisiert ${formatDate(issue.syncedAt)}`
                    : 'Lokale Änderungen ausstehend'}
                </dd>
              </>
            )}
            {issue.bcfGuid && (
              <>
                <dt>BCF-GUID</dt>
                <dd className="small muted">{issue.bcfGuid}</dd>
              </>
            )}
          </dl>
          {issue.camera && (
            <button className="btn block" style={{ marginTop: 12 }} onClick={() => nav(`/projects/${projectId}/viewer?issue=${issue.id}`)}>
              <Box size={20} /> Blickwinkel im 3D-Viewer öffnen
            </button>
          )}
        </section>

        <div className="section-title">Prüfstatus</div>
        <div className="seg">
          {(['open', 'in_progress', 'done'] as IssueStatus[]).map((s) => (
            <button key={s} className={`s-${s} ${issue.status === s ? 'on' : ''}`} onClick={() => setStatus(s)}>
              {STATUS_LABEL[s]}
            </button>
          ))}
        </div>

        <div className="section-title">Bemerkung</div>
        <textarea
          className="textarea"
          placeholder="Feststellungen, Massnahmen, Fristen …"
          value={remark ?? ''}
          onChange={(e) => onRemark(e.target.value)}
          onBlur={flushRemark}
        />

        <div className="section-title">Fotodokumentation ({photos?.length ?? 0})</div>
        <PhotoCapture onPhoto={(src) => setEditing({ src })} onError={(m) => toast(m, 'error')} />
        {photos && photos.length > 0 && (
          <div className="thumbs" style={{ marginTop: 12 }}>
            {photos.map((p) => (
              <div key={p.id} className="thumb">
                <img src={p.dataUrl} alt="Mangelfoto" onClick={() => setEditing({ src: p.dataUrl, photoId: p.id })} />
                <button className="del" aria-label="Foto löschen" onClick={() => deletePhoto(p)}>
                  <Trash2 size={16} />
                </button>
                {BIMCOLLAB_ENABLED && !p.synced && (
                  <span className="flag badge b-unsynced" title="nicht synchronisiert">
                    <CloudOff size={12} />
                  </span>
                )}
              </div>
            ))}
          </div>
        )}

        {issue.comments && issue.comments.length > 0 && (
          <>
            <div className="section-title">{BIMCOLLAB_ENABLED ? 'Kommentare aus BimCollab' : 'Kommentare'} ({issue.comments.length})</div>
            <div className="card">
              {issue.comments.map((c) => (
                <div key={c.guid} className="comment">
                  <div className="small muted">
                    {c.author || 'Unbekannt'} · {formatDate(c.date)}
                  </div>
                  <div style={{ whiteSpace: 'pre-wrap' }}>{c.text}</div>
                </div>
              ))}
            </div>
          </>
        )}
      </main>

      <div className="savebar">
        <div className="savebar-inner">
          <SaveIndicator state={saveState} lastSaved={lastSaved} synced={issue.synced} />
          <button
            className="btn primary"
            onClick={async () => {
              await flushRemark();
              await persist({});
              toast(BIMCOLLAB_ENABLED ? 'Prüfbericht lokal gespeichert – wird beim nächsten Sync übertragen' : 'Prüfbericht gespeichert', 'success');
            }}
          >
            <Save size={20} /> Speichern
          </button>
        </div>
      </div>

      {editing && <PhotoEditor src={editing.src} onCancel={() => setEditing(undefined)} onSave={savePhoto} />}
    </div>
  );
}

function SaveIndicator({ state, lastSaved, synced }: { state: SaveState; lastSaved?: string; synced: boolean }) {
  if (state === 'saving' || state === 'dirty')
    return (
      <span className="save-state saving">
        <Loader2 size={16} className="spin" /> {state === 'dirty' ? 'Änderungen …' : 'Speichert …'}
      </span>
    );
  if (state === 'error')
    return (
      <span className="save-state error">
        <AlertTriangle size={16} /> Nicht gespeichert
      </span>
    );
  if (state === 'saved')
    return (
      <span className="save-state ok">
        <Check size={16} /> Gespeichert {lastSaved ? new Date(lastSaved).toLocaleTimeString('de-CH', { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : ''}
      </span>
    );
  if (!BIMCOLLAB_ENABLED) return <span className="save-state">Lokal gespeichert</span>;
  return <span className="save-state">{synced ? 'Synchronisiert' : 'Lokal gespeichert, nicht synchronisiert'}</span>;
}
