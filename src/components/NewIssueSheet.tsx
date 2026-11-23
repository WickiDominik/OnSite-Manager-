import { Video } from 'lucide-react';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { db } from '../lib/db';
import { PRIORITY_LABEL, type BcfCamera, type BcfComponents, type Issue, type Priority } from '../lib/types';
import { nowIso, uuid } from '../lib/util';
import { Sheet } from './Sheet';
import { useToast } from './Toast';

/** Viewpoint taken over from the 3D viewer when a Mangel is created there. */
export interface ViewpointPreset {
  camera: BcfCamera;
  components?: BcfComponents;
  /** screenshot of the 3D view (data URL), stored as first photo / BCF snapshot */
  snapshot?: string;
}

export function NewIssueSheet({ projectId, preset, onClose }: { projectId: string; preset?: ViewpointPreset; onClose: () => void }) {
  const nav = useNavigate();
  const toast = useToast();
  const [f, setF] = useState({ title: '', description: '', location: '', priority: 'medium' as Priority });
  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!f.title.trim()) return;
    const ts = nowIso();
    const issue: Issue = {
      id: uuid(),
      projectId,
      title: f.title.trim(),
      description: f.description.trim(),
      location: f.location.trim(),
      priority: f.priority,
      status: 'open',
      remark: '',
      camera: preset?.camera,
      components: preset?.components,
      synced: false,
      createdAt: ts,
      updatedAt: ts,
    };
    await db.issues.add(issue);
    if (preset?.snapshot) await db.photos.add({ id: uuid(), issueId: issue.id, dataUrl: preset.snapshot, synced: false, createdAt: ts });
    await db.projects.update(projectId, { updatedAt: ts });
    toast(preset ? 'Mangel mit Modellausschnitt erfasst' : 'Mangel erfasst', 'success');
    onClose();
    nav(`/projects/${projectId}/issues/${issue.id}`);
  };
  const selected = preset?.components?.selection.length ?? 0;
  return (
    <Sheet title="Neuer Mangel" onClose={onClose}>
      <form className="stack" onSubmit={save}>
        {preset && (
          <div className="banner info small">
            <Video size={18} />
            <span className="grow">
              Der aktuelle Modellausschnitt wird gespeichert
              {selected ? ` (${selected} ${selected === 1 ? 'Bauteil' : 'Bauteile'} markiert)` : ''}.
            </span>
          </div>
        )}
        <label className="field">
          <span>Titel *</span>
          <input className="input" autoFocus required value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} placeholder="z. B. Riss in Wandabschluss" />
        </label>
        <label className="field">
          <span>Beschreibung</span>
          <textarea className="textarea" value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} />
        </label>
        <label className="field">
          <span>Ort</span>
          <input className="input" value={f.location} onChange={(e) => setF({ ...f, location: e.target.value })} placeholder="z. B. 2. OG, Bad Wohnung 3" />
        </label>
        <div className="field">
          <span>Priorität</span>
          <div className="seg">
            {(['low', 'medium', 'high', 'critical'] as Priority[]).map((p) => (
              <button type="button" key={p} className={f.priority === p ? 'on' : ''} onClick={() => setF({ ...f, priority: p })}>
                {PRIORITY_LABEL[p]}
              </button>
            ))}
          </div>
        </div>
        <button className="btn primary block" type="submit" disabled={!f.title.trim()}>
          Mangel anlegen
        </button>
      </form>
    </Sheet>
  );
}
