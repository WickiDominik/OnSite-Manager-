import { useLiveQuery } from 'dexie-react-hooks';
import { Crosshair, FileUp, Loader2, Maximize, Minimize, Video } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { PageHeader } from '../components/Header';
import { useToast } from '../components/Toast';
import { db } from '../lib/db';
import type { BimViewer } from '../lib/viewer';
import { PRIORITY_RANK } from '../lib/types';

export function ViewerPage() {
  const { projectId = '' } = useParams();
  const [params, setParams] = useSearchParams();
  const toast = useToast();
  const containerRef = useRef<HTMLDivElement>(null);
  const viewerRef = useRef<BimViewer | null>(null);
  const [ready, setReady] = useState(false);
  const [loading, setLoading] = useState<string>();
  const [modelName, setModelName] = useState<string>();
  const [fullscreen, setFullscreen] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const loadedProjectModel = useRef(false);

  const project = useLiveQuery(() => db.projects.get(projectId), [projectId]);
  const ifc = useLiveQuery(() => db.ifcModels.get(projectId), [projectId]);
  const withCamera = useLiveQuery(
    async () =>
      (await db.issues.where('projectId').equals(projectId).filter((i) => !!i.camera).toArray()).sort(
        (a, b) => PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority],
      ),
    [projectId],
  );
  const issueParam = params.get('issue');
  const activeIssue = withCamera?.find((i) => i.id === issueParam);

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

  // jump to the BCF viewpoint of the selected issue (after the model is loaded, if any)
  useEffect(() => {
    if (!ready || loading || !activeIssue?.camera) return;
    if (ifc && !modelName) return;
    viewerRef.current?.setBcfCamera(activeIssue.camera);
  }, [ready, loading, activeIssue, ifc, modelName]);

  useEffect(() => {
    // the canvas size changes when toggling fullscreen
    const t = setTimeout(() => viewerRef.current?.resize(), 50);
    return () => clearTimeout(t);
  }, [fullscreen]);

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
                {modelName ?? (ifc ? 'Modell wird vorbereitet …' : 'Kein IFC-Modell – Beispielkörper')}
                {activeIssue ? ` · Blickwinkel: ${activeIssue.title}` : ''}
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

        <p className="muted small" style={{ margin: '10px 4px' }}>
          Ein Finger dreht, zwei Finger zoomen und verschieben. {ifc ? '' : 'Lade ein IFC über den IFC-Button in der Mangelliste dauerhaft ans Projekt.'}
        </p>

        <div className="section-title">BCF-Blickwinkel ({withCamera?.length ?? 0})</div>
        {withCamera && withCamera.length === 0 && <p className="muted small" style={{ margin: '0 4px' }}>Keine Mängel mit gespeichertem Kamerastandpunkt.</p>}
        <div className="list">
          {withCamera?.map((i) => (
            <button
              key={i.id}
              className="card row"
              style={i.id === issueParam ? { borderColor: 'var(--yellow)' } : undefined}
              onClick={() => {
                setParams({ issue: i.id }, { replace: true });
                if (i.camera) viewerRef.current?.setBcfCamera(i.camera);
              }}
            >
              <Video size={20} color="#f5c400" />
              <span className="grow">{i.title}</span>
            </button>
          ))}
        </div>
      </main>
    </div>
  );
}
