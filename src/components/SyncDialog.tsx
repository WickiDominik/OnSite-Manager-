import { AlertTriangle, Check, Loader2 } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { runSync, type SyncProgress, type SyncResult } from '../lib/sync';
import { Sheet } from './Sheet';

export function SyncDialog({ onClose }: { onClose: () => void }) {
  const [progress, setProgress] = useState<SyncProgress>({ phase: 'upload', message: 'Abgleich wird vorbereitet …', current: 0, total: 1 });
  const [result, setResult] = useState<SyncResult>();
  const [fatal, setFatal] = useState<string>();
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    runSync(setProgress)
      .then(setResult)
      .catch((e) => setFatal((e as Error).message));
  }, []);

  const running = !result && !fatal;
  const pct = progress.total ? Math.round((progress.current / progress.total) * 100) : 0;
  const phaseLabel = { upload: 'Prüfberichte senden', projects: 'Projekte laden', topics: 'Themen laden', done: 'Fertig' }[progress.phase];

  return (
    <Sheet title="Abgleich mit BimCollab" onClose={() => !running && onClose()}>
      <div className="stack">
        {running && (
          <>
            <div className="row">
              <Loader2 className="spin" size={20} />
              <strong>{phaseLabel}</strong>
              <span className="muted small grow" style={{ textAlign: 'right' }}>
                {progress.current}/{progress.total}
              </span>
            </div>
            <div className="progress">
              <div style={{ width: `${pct}%` }} />
            </div>
            <p className="muted small">{progress.message}</p>
          </>
        )}
        {fatal && (
          <div className="banner offline">
            <AlertTriangle size={20} />
            <span className="grow">{fatal}</span>
          </div>
        )}
        {result && (
          <>
            <div className={`banner ${result.errors.length ? 'info' : 'ok'}`}>
              {result.errors.length ? <AlertTriangle size={20} /> : <Check size={20} />}
              <span className="grow">{result.errors.length ? 'Abgleich mit Fehlern beendet' : 'Abgleich erfolgreich'}</span>
            </div>
            <dl className="kv">
              <dt>Projekte</dt>
              <dd>{result.projects}</dd>
              <dt>Themen geladen</dt>
              <dd>{result.topicsFetched}</dd>
              <dt>Berichte gesendet</dt>
              <dd>{result.reportsUploaded}</dd>
              <dt>Lokal übersprungen</dt>
              <dd>{result.skippedLocal}</dd>
            </dl>
            {result.errors.length > 0 && (
              <div className="card small" style={{ maxHeight: 200, overflow: 'auto' }}>
                {result.errors.map((e, i) => (
                  <div key={i} style={{ color: '#fca5a5' }}>
                    • {e}
                  </div>
                ))}
              </div>
            )}
          </>
        )}
        {!running && (
          <button className="btn primary block" onClick={onClose}>
            Schliessen
          </button>
        )}
      </div>
    </Sheet>
  );
}
