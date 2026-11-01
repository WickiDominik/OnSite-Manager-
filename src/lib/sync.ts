import { db } from './db';
import {
  bcfApi,
  type ApiComment,
  type ApiExtensions,
  type ApiProject,
  type ApiTopic,
  type ApiViewpoint,
} from './bimcollab';
import { bcfPriorityToLocal, bcfStatusToLocal, localStatusToBcf } from './mapping';
import type { BcfCamera, Issue, Project } from './types';
import { dataUrlToBase64, nowIso, uuid } from './util';

export interface SyncProgress {
  phase: 'projects' | 'topics' | 'upload' | 'done';
  message: string;
  current: number;
  total: number;
}

export interface SyncResult {
  projects: number;
  topicsFetched: number;
  reportsUploaded: number;
  skippedLocal: number;
  errors: string[];
}

const enc = encodeURIComponent;

function cameraFromApi(v?: ApiViewpoint): BcfCamera | undefined {
  const c = v?.perspective_camera;
  if (!c) return undefined;
  return {
    viewPoint: c.camera_view_point,
    direction: c.camera_direction,
    upVector: c.camera_up_vector,
    fieldOfView: c.field_of_view || 60,
  };
}

/**
 * Full sync with BimCollab:
 * 1. upload local Prüfberichte (remark → comment, photos → viewpoint snapshots, status → topic update)
 * 2. fetch projects and topics
 */
export async function runSync(onProgress: (p: SyncProgress) => void): Promise<SyncResult> {
  const result: SyncResult = { projects: 0, topicsFetched: 0, reportsUploaded: 0, skippedLocal: 0, errors: [] };

  // ---- 1. Upload ----
  const pending = await db.issues.filter((i) => !i.synced).toArray();
  const extCache = new Map<string, ApiExtensions>();
  let n = 0;
  for (const issue of pending) {
    n++;
    onProgress({ phase: 'upload', message: `Prüfbericht „${issue.title}“ übertragen`, current: n, total: pending.length });
    const project = await db.projects.get(issue.projectId);
    if (!issue.bcfGuid || !project?.bcfProjectId) {
      // purely local issues cannot be written to BimCollab – mark them as handled
      await db.issues.update(issue.id, { synced: true, localOnly: true, syncedAt: nowIso() });
      await db.photos.where('issueId').equals(issue.id).modify({ synced: true });
      result.skippedLocal++;
      continue;
    }
    try {
      await uploadReport(project.bcfProjectId, issue, extCache);
      result.reportsUploaded++;
    } catch (e) {
      result.errors.push(`„${issue.title}“: ${(e as Error).message}`);
    }
  }

  // ---- 2. Projects ----
  onProgress({ phase: 'projects', message: 'Projekte von BimCollab laden', current: 0, total: 1 });
  let apiProjects: ApiProject[] = [];
  try {
    apiProjects = await bcfApi<ApiProject[]>('/projects');
  } catch (e) {
    result.errors.push(`Projekte: ${(e as Error).message}`);
    onProgress({ phase: 'done', message: 'Abgleich mit Fehlern beendet', current: 1, total: 1 });
    return result;
  }
  const ts = nowIso();
  const localProjects: Project[] = [];
  for (const ap of apiProjects) {
    const existing = await db.projects.where('bcfProjectId').equals(ap.project_id).first();
    const p: Project = existing
      ? { ...existing, name: ap.name || existing.name, updatedAt: ts }
      : { id: uuid(), name: ap.name, location: '', status: 'active', bcfProjectId: ap.project_id, createdAt: ts, updatedAt: ts };
    await db.projects.put(p);
    localProjects.push(p);
  }
  result.projects = localProjects.length;

  // ---- 3. Topics ----
  let pi = 0;
  for (const p of localProjects) {
    pi++;
    onProgress({ phase: 'topics', message: `Themen für „${p.name}“ laden`, current: pi, total: localProjects.length });
    try {
      const topics = await bcfApi<ApiTopic[]>(`/projects/${enc(p.bcfProjectId!)}/topics`);
      for (const t of topics) {
        await upsertTopic(p, t);
        result.topicsFetched++;
      }
    } catch (e) {
      result.errors.push(`Themen „${p.name}“: ${(e as Error).message}`);
    }
  }

  onProgress({
    phase: 'done',
    message: result.errors.length ? 'Abgleich mit Fehlern beendet' : 'Abgleich abgeschlossen',
    current: 1,
    total: 1,
  });
  return result;
}

async function upsertTopic(p: Project, t: ApiTopic) {
  const existing = await db.issues.where('bcfGuid').equals(t.guid).first();
  const base = `/projects/${enc(p.bcfProjectId!)}/topics/${enc(t.guid)}`;

  let camera = existing?.camera;
  let comments = existing?.comments;
  const changed = !existing || !existing.syncedAt || (t.modified_date ?? '') > existing.syncedAt;
  if (changed) {
    try {
      const vps = await bcfApi<ApiViewpoint[]>(`${base}/viewpoints`);
      camera = vps.map(cameraFromApi).find(Boolean) ?? camera;
    } catch {
      /* viewpoints are optional */
    }
    try {
      const cs = await bcfApi<ApiComment[]>(`${base}/comments`);
      comments = cs.map((c) => ({ guid: c.guid, author: c.author, date: c.date, text: c.comment }));
    } catch {
      /* comments are optional */
    }
  }

  const ts = nowIso();
  // local unsynced Prüfbericht data wins over the server state
  const keepLocal = existing && !existing.synced;
  const issue: Issue = {
    id: existing?.id ?? uuid(),
    projectId: p.id,
    title: t.title,
    description: t.description ?? '',
    location: existing?.location || (t.labels ?? []).join(', '),
    priority: keepLocal ? existing!.priority : bcfPriorityToLocal(t.priority),
    status: keepLocal ? existing!.status : bcfStatusToLocal(t.topic_status),
    remark: existing?.remark ?? '',
    syncedRemark: existing?.syncedRemark,
    bcfGuid: t.guid,
    bcfStatus: t.topic_status,
    bcfPriority: t.priority,
    camera,
    comments,
    author: t.creation_author,
    synced: keepLocal ? false : true,
    syncedAt: keepLocal ? existing!.syncedAt : ts,
    createdAt: existing?.createdAt ?? t.creation_date ?? ts,
    updatedAt: keepLocal ? existing!.updatedAt : ts,
  };
  await db.issues.put(issue);
}

async function getExtensions(projectId: string, cache: Map<string, ApiExtensions>) {
  if (!cache.has(projectId)) {
    try {
      cache.set(projectId, await bcfApi<ApiExtensions>(`/projects/${enc(projectId)}/extensions`));
    } catch {
      cache.set(projectId, {});
    }
  }
  return cache.get(projectId)!;
}

async function uploadReport(bcfProjectId: string, issue: Issue, extCache: Map<string, ApiExtensions>) {
  const base = `/projects/${enc(bcfProjectId)}/topics/${enc(issue.bcfGuid!)}`;

  // Photos → viewpoints with snapshot
  const photos = await db.photos.where('issueId').equals(issue.id).filter((p) => !p.synced).toArray();
  const viewpointGuids: string[] = [];
  for (const photo of photos) {
    const { base64, mime } = dataUrlToBase64(photo.dataUrl);
    const vp: Record<string, unknown> = {
      snapshot: { snapshot_type: mime === 'image/png' ? 'png' : 'jpg', snapshot_data: base64 },
    };
    if (issue.camera) {
      vp.perspective_camera = {
        camera_view_point: issue.camera.viewPoint,
        camera_direction: issue.camera.direction,
        camera_up_vector: issue.camera.upVector,
        field_of_view: issue.camera.fieldOfView,
        aspect_ratio: 1.33,
      };
    }
    const created = await bcfApi<{ guid: string }>(`${base}/viewpoints`, { method: 'POST', body: JSON.stringify(vp) });
    if (created?.guid) viewpointGuids.push(created.guid);
    await db.photos.update(photo.id, { synced: true });
  }

  // Remark → comment
  const remark = issue.remark.trim();
  if (remark && remark !== (issue.syncedRemark ?? '').trim()) {
    const body: Record<string, unknown> = { comment: remark };
    if (viewpointGuids[0]) body.viewpoint_guid = viewpointGuids[0];
    await bcfApi(`${base}/comments`, { method: 'POST', body: JSON.stringify(body) });
  }

  // Status → topic update (PUT needs the full editable topic)
  const ext = await getExtensions(bcfProjectId, extCache);
  const topic = await bcfApi<ApiTopic>(base);
  const newStatus = localStatusToBcf(issue.status, ext.topic_status, topic.topic_status);
  if (newStatus !== topic.topic_status) {
    const put: Record<string, unknown> = {
      title: topic.title,
      topic_type: topic.topic_type,
      topic_status: newStatus,
      priority: topic.priority,
      labels: topic.labels,
      description: topic.description,
      assigned_to: topic.assigned_to,
      stage: topic.stage,
      due_date: topic.due_date,
      reference_links: topic.reference_links,
    };
    Object.keys(put).forEach((k) => put[k] === undefined && delete put[k]);
    await bcfApi(base, { method: 'PUT', body: JSON.stringify(put) });
  }

  await db.issues.update(issue.id, {
    synced: true,
    syncedAt: nowIso(),
    bcfStatus: newStatus,
    syncedRemark: issue.remark,
    localOnly: false,
  });
}
