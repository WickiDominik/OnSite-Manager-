import { useLiveQuery } from 'dexie-react-hooks';
import { Box, ChevronRight, ClipboardList, Cloud, FileUp, MapPin, Plus, Video } from 'lucide-react';
import { useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { BcfBadge, PriorityBadge, StatusBadge } from '../components/Badges';
import { CloudImportSheet } from '../components/CloudImportSheet';
import { OfflineBanner, PageHeader } from '../components/Header';
import { NewIssueSheet } from '../components/NewIssueSheet';
import { useToast } from '../components/Toast';
import { BIMCOLLAB_ENABLED } from '../lib/features';
import { db } from '../lib/db';
import {
  PRIORITY_LABEL,
  PRIORITY_RANK,
  STATUS_LABEL,
  type Issue,
  type IssueStatus,
  type Priority,
} from '../lib/types';
import { nowIso } from '../lib/util';

export function IssuesPage() {
  const { projectId = '' } = useParams();
  const nav = useNavigate();
  const toast = useToast();
  const [statusFilter, setStatusFilter] = useState<IssueStatus | 'all'>('all');
  const [prioFilter, setPrioFilter] = useState<Priority | 'all'>('all');
  const [showNew, setShowNew] = useState(false);
  const [showCloud, setShowCloud] = useState(false);
  const ifcRef = useRef<HTMLInputElement>(null);

  const project = useLiveQuery(() => db.projects.get(projectId), [projectId]);
  const issues = useLiveQuery(() => db.issues.where('projectId').equals(projectId).toArray(), [projectId]);
  const ifc = useLiveQuery(() => db.ifcModels.get(projectId), [projectId]);

  const counts = useMemo(() => {
    const c: Record<IssueStatus, number> = { open: 0, in_progress: 0, done: 0 };
    issues?.forEach((i) => c[i.status]++);
    return c;
  }, [issues]);

  const visible = useMemo(
    () =>
      (issues ?? [])
        .filter((i) => statusFilter === 'all' || i.status === statusFilter)
        .filter((i) => prioFilter === 'all' || i.priority === prioFilter)
        .sort((a, b) => PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority] || b.updatedAt.localeCompare(a.updatedAt)),
    [issues, statusFilter, prioFilter],
  );

  const uploadIfc = async (f?: File | null) => {
    if (!f) return;
    if (!/\.ifc$/i.test(f.name)) {
      toast('Bitte eine .ifc-Datei wählen', 'error');
      return;
    }
    await db.ifcModels.put({ projectId, fileName: f.name, data: f, uploadedAt: nowIso() });
    toast(`IFC „${f.name}“ am Projekt hinterlegt`, 'success');
  };

  if (project === undefined && issues !== undefined) {
    return (
      <div className="app">
        <PageHeader title="Projekt" back="/" />
        <div className="empty">Projekt nicht gefunden.</div>
      </div>
    );
  }

  return (
    <div className="app">
      <PageHeader
        title={project?.name ?? '…'}
        sub={[project?.location, project?.bcfProjectId ? 'BimCollab' : ''].filter(Boolean).join(' · ') || undefined}
        back="/"
        actions={
          <>
            <button className="icon-btn" aria-label="IFC hochladen" title={ifc ? `IFC: ${ifc.fileName}` : 'IFC hochladen'} onClick={() => ifcRef.current?.click()}>
              <FileUp color={ifc ? '#f5c400' : undefined} />
            </button>
            <button className="icon-btn" aria-label="IFC aus Cloud laden" title="IFC aus Cloud laden" onClick={() => setShowCloud(true)}>
              <Cloud />
            </button>
            <button className="icon-btn" aria-label="3D-Viewer" onClick={() => nav(`/projects/${projectId}/viewer`)}>
              <Box />
            </button>
          </>
        }
      />
      <input ref={ifcRef} type="file" accept=".ifc" hidden onChange={(e) => (uploadIfc(e.target.files?.[0]), (e.target.value = ''))} />

      <main className="content">
        <OfflineBanner />
        {ifc && (
          <div className="banner info small">
            <Box size={18} />
            <span className="grow">
              IFC-Modell: <strong>{ifc.fileName}</strong> ({(ifc.data.size / 1e6).toFixed(1)} MB)
            </span>
          </div>
        )}

        <div className="counters">
          {(['open', 'in_progress', 'done'] as IssueStatus[]).map((s) => (
            <button
              key={s}
              className={`counter ${statusFilter === s ? 'active' : ''}`}
              onClick={() => setStatusFilter(statusFilter === s ? 'all' : s)}
            >
              <div className="num">{counts[s]}</div>
              <div className="lbl">{STATUS_LABEL[s]}</div>
            </button>
          ))}
        </div>

        <div className="section-title">Status</div>
        <div className="chips">
          <button className={`chip ${statusFilter === 'all' ? 'active' : ''}`} onClick={() => setStatusFilter('all')}>
            Alle
          </button>
          {(Object.keys(STATUS_LABEL) as IssueStatus[]).map((s) => (
            <button key={s} className={`chip ${statusFilter === s ? 'active' : ''}`} onClick={() => setStatusFilter(s)}>
              {STATUS_LABEL[s]}
            </button>
          ))}
        </div>
        <div className="section-title" style={{ marginTop: 6 }}>
          Priorität
        </div>
        <div className="chips">
          <button className={`chip ${prioFilter === 'all' ? 'active' : ''}`} onClick={() => setPrioFilter('all')}>
            Alle
          </button>
          {(['critical', 'high', 'medium', 'low'] as Priority[]).map((p) => (
            <button key={p} className={`chip ${prioFilter === p ? 'active' : ''}`} onClick={() => setPrioFilter(p)}>
              {PRIORITY_LABEL[p]}
            </button>
          ))}
        </div>

        <div className="section-title">
          Mängel ({visible.length}
          {issues && visible.length !== issues.length ? ` von ${issues.length}` : ''})
        </div>
        {issues && visible.length === 0 && (
          <div className="empty">
            <ClipboardList size={56} />
            <p>{issues.length ? 'Keine Mängel für diesen Filter.' : 'Noch keine Mängel erfasst.'}</p>
          </div>
        )}
        <div className="list">
          {visible.map((i) => (
            <IssueCard
              key={i.id}
              issue={i}
              onClick={() => nav(`/projects/${projectId}/issues/${i.id}`)}
              onShowInModel={() => nav(`/projects/${projectId}/viewer?issue=${i.id}`)}
            />
          ))}
        </div>
      </main>

      <button className="fab" onClick={() => setShowNew(true)}>
        <Plus /> Neuer Mangel
      </button>
      {showNew && <NewIssueSheet projectId={projectId} onClose={() => setShowNew(false)} />}
      {showCloud && (
        <CloudImportSheet
          title="IFC aus Cloud laden"
          accept={['.ifc']}
          onClose={() => setShowCloud(false)}
          onFile={async (f) => {
            await uploadIfc(f);
            setShowCloud(false);
          }}
        />
      )}
    </div>
  );
}

function IssueCard({ issue, onClick, onShowInModel }: { issue: Issue; onClick: () => void; onShowInModel: () => void }) {
  const hasView = !!(issue.camera || issue.components);
  return (
    <div className="card issue-card" role="button" tabIndex={0} onClick={onClick} onKeyDown={(e) => e.key === 'Enter' && onClick()}>
      <div className="row" style={{ alignItems: 'flex-start' }}>
        <div className="grow">
          <p className="card-title">{issue.title}</p>
          <div className="row wrap" style={{ gap: 6, marginTop: 8 }}>
            <StatusBadge status={issue.status} />
            <PriorityBadge priority={issue.priority} />
            {issue.bcfGuid && <BcfBadge />}
            {BIMCOLLAB_ENABLED && !issue.synced && <span className="badge b-unsynced">nicht synchronisiert</span>}
          </div>
          {issue.location && (
            <div className="card-meta">
              <span className="row" style={{ gap: 4 }}>
                <MapPin size={14} /> {issue.location}
              </span>
            </div>
          )}
        </div>
        {hasView ? (
          <button
            className="icon-btn filled"
            aria-label="Im 3D-Modell zeigen"
            title="Im 3D-Modell zeigen"
            onClick={(e) => {
              e.stopPropagation();
              onShowInModel();
            }}
          >
            <Video color="#f5c400" />
          </button>
        ) : (
          <ChevronRight className="muted" style={{ marginTop: 4 }} />
        )}
      </div>
    </div>
  );
}
