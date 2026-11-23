import { useLiveQuery } from 'dexie-react-hooks';
import { Crosshair, FileUp, Loader2, Maximize, Minimize, MousePointerClick, Plus, Save, Video, VideoOff, X } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { PageHeader } from '../components/Header';
import { NewIssueSheet, type ViewpointPreset } from '../components/NewIssueSheet';
import { useToast } from '../components/Toast';
import { db } from '../lib/db';
import type { BimViewer } from '../lib/viewer';
import { PRIORITY_RANK, type BcfComponents, type Issue } from '../lib/types';
import { nowIso } from '../lib/util';

const hasView = (i: Issue) => !!(i.camera || i.components);

export function ViewerPage() {
  const { projectId = '' } = useParams();
  const [params, setParams] = useSearchParams();
  const nav = useNavigate();
  const toast = useToast();
  const containerRef = useRef<HTMLDivElement>(null);
  const viewerRef = useRef<BimViewer | null>(null);
  const [ready, setReady] = useState(false);
  const [loading, setLoading] = useState<string>();
  const [modelName, setModelName] = useState<string>();
  const [fullscreen, setFullscreen] = useState(false);
  /** tap on the model selects / deselects elements */
  const [pickMode, setPickMode] = useState(false);
  const [selection, setSelection] = useState<string[]>([]);
  const [preset, setPreset] = useState<ViewpointPreset>();
  const fileRef = useRef<HTMLInputElement>(null);
  const loadedProjectModel = useRef(false);
  /** issue whose viewpoint was last applied (to avoid re-jumping on every DB change) */
  const appliedIssue = useRef<string>(undefined);

  const project = useLiveQuery(() => db.projects.get(projectId), [projectId]);
  const ifc = useLiveQuery(() => db.ifcModels.get(projectId), [projectId]);
  const issues = useLiveQuery(
    async () =>
      (await db.issues.where('projectId').equals(projectId).toArray()).sort(
        (a, b) => Number(hasView(b)) - Number(hasView(a)) || PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority],
      ),
    [projectId],
  );
  const issueParam = params.get('issue');
  const activeIssue = issues?.find((i) => i.id === issueParam);
  const withView = issues?.filter(hasView).length ?? 0;
  const modelReady = !!modelName || !ifc;

  // create the viewer (three.js + web-ifc are loaded lazily)
  useEffect(() => {
    let disposed = false;
    import('../lib/viewer')
      .then(({ BimViewer }) => {
        if (disposed || !containerRef.current) return;
        viewerRef.current = new BimViewer(containerRef.current);
        setReady(true);
      })
      .catch((e) => toast('3D-Viewer konnte nicht gestartet werden: ' + e.message, 'error'));
    return () => {
      disposed = true;
      viewerRef.current?.dispose();
      viewerRef.current = null;
    };
  }, [toast]);

  const loadIfc = async (data: Blob, name: string) => {
    const v = viewerRef.current;
    if (!v) return;
    setLoading(`Lade ${name} …`);
    try {
      const buf = new Uint8Array(await data.arrayBuffer());
      let last = 0;
      const n = await v.loadIfc(buf, (done, total) => {
        const pct = Math.round((done / total) * 100);
        if (pct !== last) {
          last = pct;
          setLoading(`Geometrie ${pct} %`);
        }
      });
      setModelName(name);
      appliedIssue.current = undefined; // re-apply the active viewpoint on the new model
      toast(`${name}: ${n} ${n === 1 ? 'Bauteil' : 'Bauteile'} geladen`, 'success');
    } catch (e) {
      toast('IFC konnte nicht geladen werden: ' + (e as Error).message, 'error');
    } finally {
      setLoading(undefined);
    }
  };

  // auto-load the IFC stored at the project
  useEffect(() => {
    if (!ready || !ifc || loadedProjectModel.current) return;
    loadedProjectModel.current = true;
    loadIfc(ifc.data, ifc.fileName);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, ifc]);

  /** Jump to the stored model view of an issue: camera, hidden / isolated and selected elements. */
  const showIssue = useCallback(
    (issue: Issue) => {
      const v = viewerRef.current;
      if (!v) return;
      appliedIssue.current = issue.id;
      setSelection(issue.components?.selection ?? []);
      const res = v.applyComponents(issue.components);
      if (issue.camera) v.setBcfCamera(issue.camera);
      else if (issue.components?.selection.length && v.fitToElements(issue.components.selection)) {
        /* zoomed to the selected elements */
      } else if (!issue.camera) {
        toast('Für diesen Mangel ist noch kein Modellausschnitt gespeichert.', 'info');
        return;
      }
      if (res.total && v.hasModel && res.found < res.total)
        toast(
          res.found === 0
            ? 'Die markierten Bauteile sind im geladenen Modell nicht enthalten.'
            : `${res.found} von ${res.total} markierten Bauteilen im Modell gefunden.`,
          'info',
        );
    },
    [toast],
  );

  // jump to the viewpoint of the selected issue (after the model is loaded, if any)
  useEffect(() => {
    if (!ready || loading || !activeIssue || !modelReady) return;
    if (appliedIssue.current === activeIssue.id) return;
    showIssue(activeIssue);
  }, [ready, loading, activeIssue, modelReady, showIssue]);

  useEffect(() => {
    // the canvas size changes when toggling fullscreen
    const t = setTimeout(() => viewerRef.current?.resize(), 50);
    return () => clearTimeout(t);
  }, [fullscreen]);

  // tap on an element (without dragging) toggles it in the selection
  useEffect(() => {
    const el = containerRef.current;
    if (!el || !pickMode) return;
    let down: { x: number; y: number } | undefined;
    const onDown = (e: PointerEvent) => (down = { x: e.clientX, y: e.clientY });
    const onUp = (e: PointerEvent) => {
      if (!down || Math.hypot(e.clientX - down.x, e.clientY - down.y) > 8) return;
      down = undefined;
      const guid = viewerRef.current?.pick(e.clientX, e.clientY);
      if (!guid) return;
      setSelection((s) => (s.includes(guid) ? s.filter((g) => g !== guid) : [...s, guid]));
    };
    el.addEventListener('pointerdown', onDown);
    el.addEventListener('pointerup', onUp);
    return () => {
      el.removeEventListener('pointerdown', onDown);
      el.removeEventListener('pointerup', onUp);
    };
  }, [pickMode]);

  // highlight the current selection (keeps hidden / isolated elements of the active issue)
  useEffect(() => {
    const v = viewerRef.current;
    if (!v || !ready || !modelReady) return;
    const base = activeIssue?.components;
    v.applyComponents({ defaultVisibility: base?.defaultVisibility ?? true, exceptions: base?.exceptions ?? [], selection });
  }, [selection, ready, modelReady, activeIssue?.components]);

  const currentComponents = (): BcfComponents | undefined => {
    const base = activeIssue?.components;
    const c = { selection, defaultVisibility: base?.defaultVisibility ?? true, exceptions: base?.exceptions ?? [] };
    return c.selection.length || c.exceptions.length || !c.defaultVisibility ? c : undefined;
  };

  const newIssueHere = () => {
    const v = viewerRef.current;
    if (!v) return;
    // new issue: keep only the selection, not the visibility of another issue
    setPreset({
      camera: v.getBcfCamera(),
      components: selection.length ? { selection, defaultVisibility: true, exceptions: [] } : undefined,
      snapshot: v.snapshot(),
    });
  };

  const saveViewToIssue = async () => {
    const v = viewerRef.current;
    if (!v || !activeIssue) return;
    const ts = nowIso();
    await db.issues.update(activeIssue.id, {
      camera: v.getBcfCamera(),
      components: currentComponents(),
      synced: false,
      localOnly: false,
      updatedAt: ts,
    });
    await db.projects.update(projectId, { updatedAt: ts });
    appliedIssue.current = activeIssue.id;
    toast(`Modellausschnitt für „${activeIssue.title}“ gespeichert`, 'success');
  };

  const closeIssue = () => {
    appliedIssue.current = undefined;
    setParams({}, { replace: true });
    setSelection([]);
    viewerRef.current?.applyComponents(undefined);
  };

  return (
    <div className="app">
      <PageHeader title="3D-BIM-Viewer" sub={project?.name} back={`/projects/${projectId}`} />
      <main className="content">
        <div className={`viewer-wrap ${fullscreen ? 'fullscreen' : ''}`}>
          <div ref={containerRef} className="viewer-canvas" />
          <div className="viewer-overlay">
            <button className="icon-btn filled" aria-label="IFC-Datei laden" title="IFC-Datei laden" onClick={() => fileRef.current?.click()}>
              <FileUp />
            </button>
            <button className="icon-btn filled" aria-label="Ansicht zentrieren" title="Ansicht zentrieren" onClick={() => viewerRef.current?.fitToModel()}>
              <Crosshair />
            </button>
            {modelName && (
              <button
                className={`icon-btn filled ${pickMode ? 'on' : ''}`}
                aria-label="Bauteile markieren"
                title="Bauteile markieren (antippen)"
                onClick={() => setPickMode((p) => !p)}
              >
                <MousePointerClick />
              </button>
            )}
            <span className="grow" />
            <button
              className="icon-btn filled"
              aria-label={fullscreen ? 'Vollbild beenden' : 'Vollbild'}
              onClick={() => setFullscreen((f) => !f)}
            >
              {fullscreen ? <Minimize /> : <Maximize />}
            </button>
          </div>
          <div className="viewer-status">
            {loading ? (
              <span className="pill">
                <Loader2 size={14} className="spin" style={{ verticalAlign: -2 }} /> {loading}
              </span>
            ) : (
              <span className="pill">
                {pickMode
                  ? `Bauteil antippen zum Markieren · ${selection.length} markiert`
                  : (modelName ?? (ifc ? 'Modell wird vorbereitet …' : 'Kein IFC-Modell – Beispielkörper')) +
                    (activeIssue ? ` · ${activeIssue.title}` : '')}
              </span>
            )}
          </div>
        </div>
        <input
          ref={fileRef}
          type="file"
          accept=".ifc"
          hidden
          onChange={(e) => {
            const f = e.target.files?.[0];
            e.target.value = '';
            if (f) loadIfc(f, f.name);
          }}
        />

        {activeIssue ? (
          <div className="card" style={{ marginTop: 10, borderColor: 'var(--yellow)' }}>
            <div className="row">
              <Video size={20} color="#f5c400" />
              <strong className="grow">{activeIssue.title}</strong>
              <button className="icon-btn" aria-label="Mangel schliessen" onClick={closeIssue}>
                <X />
              </button>
            </div>
            {!hasView(activeIssue) && <p className="muted small">Noch kein Modellausschnitt gespeichert. Ausschnitt einstellen und speichern.</p>}
            <div className="viewer-actions">
              <button className="btn sm" onClick={() => nav(`/projects/${projectId}/issues/${activeIssue.id}`)}>
                Mangel öffnen
              </button>
              <button className="btn sm primary" onClick={saveViewToIssue}>
                <Save size={18} /> {hasView(activeIssue) ? 'Ausschnitt aktualisieren' : 'Ausschnitt speichern'}
              </button>
            </div>
          </div>
        ) : (
          <div className="viewer-actions">
            <button className="btn primary" onClick={newIssueHere} disabled={!ready}>
              <Plus size={20} /> Neuer Mangel in dieser Ansicht
            </button>
          </div>
        )}

        <p className="muted small" style={{ margin: '10px 4px' }}>
          Ein Finger dreht, zwei Finger zoomen und verschieben. Mit dem Zeiger-Button Bauteile antippen und markieren.{' '}
          {ifc ? '' : 'Lade ein IFC über den IFC-Button in der Mangelliste dauerhaft ans Projekt.'}
        </p>

        <div className="section-title">
          Mängel im Modell ({withView} von {issues?.length ?? 0} mit Ausschnitt)
        </div>
        {issues && issues.length === 0 && <p className="muted small" style={{ margin: '0 4px' }}>Noch keine Mängel erfasst.</p>}
        <div className="list">
          {issues?.map((i) => (
            <button
              key={i.id}
              className="card row"
              style={i.id === issueParam ? { borderColor: 'var(--yellow)' } : undefined}
              onClick={() => {
                setParams({ issue: i.id }, { replace: true });
                if (hasView(i)) showIssue(i);
                else {
                  appliedIssue.current = i.id;
                  setSelection([]);
                }
              }}
            >
              {hasView(i) ? <Video size={20} color="#f5c400" /> : <VideoOff size={20} className="muted" />}
              <span className="grow">{i.title}</span>
              {!hasView(i) && <span className="muted small">kein Ausschnitt</span>}
            </button>
          ))}
        </div>
      </main>
      {preset && <NewIssueSheet projectId={projectId} preset={preset} onClose={() => setPreset(undefined)} />}
    </div>
  );
}
