import JSZip from 'jszip';
import { db } from './db';
import {
  BCF_VERSION_XML,
  buildMarkup,
  buildProject,
  buildViewpoint,
  parseMarkup,
  parseProjectName,
  parseViewpointCamera,
} from './bcfXml';
import { bcfPriorityToLocal, bcfStatusToLocal, localPriorityToBcf, localStatusToBcf } from './mapping';
import type { Issue, Photo, Project } from './types';
import { PRIORITY_LABEL, STATUS_LABEL } from './types';
import { dataUrlToBase64, nowIso, uuid } from './util';

export interface ImportResult {
  projectId: string;
  projectName: string;
  issues: number;
  photos: number;
}

async function blobToDataUrl(data: Uint8Array, mime: string): Promise<string> {
  let bin = '';
  const chunk = 0x8000;
  for (let i = 0; i < data.length; i += chunk) bin += String.fromCharCode(...data.subarray(i, i + chunk));
  return `data:${mime};base64,${btoa(bin)}`;
}

/** Import a .bcfzip archive as a new project with all its topics. */
export async function importBcfZip(file: Blob, fileName: string): Promise<ImportResult> {
  const zip = await JSZip.loadAsync(file);
  let projectName = fileName.replace(/\.bcf(zip)?$/i, '');
  let bcfProjectId: string | undefined;
  const projFile = zip.file('project.bcfp');
  if (projFile) {
    try {
      const p = parseProjectName(await projFile.async('string'));
      if (p.name) projectName = p.name;
      bcfProjectId = p.id;
    } catch {
      /* ignore broken project file */
    }
  }

  // If the archive belongs to a BimCollab project we already know, attach the topics to it.
  const existing = bcfProjectId ? await db.projects.where('bcfProjectId').equals(bcfProjectId).first() : undefined;
  const ts = nowIso();
  const project: Project = existing ?? {
    id: uuid(),
    name: projectName,
    location: '',
    status: 'active',
    createdAt: ts,
    updatedAt: ts,
  };

  const markupPaths = Object.keys(zip.files).filter((p) => /(^|\/)markup\.bcf$/i.test(p));
  if (markupPaths.length === 0) throw new Error('Keine Themen (markup.bcf) im Archiv gefunden');

  const issues: Issue[] = [];
  const photos: Photo[] = [];
  for (const path of markupPaths) {
    const folder = path.replace(/markup\.bcf$/i, '');
    const folderGuid = folder.replace(/\/$/, '').split('/').pop() ?? uuid();
    const topic = parseMarkup(await zip.file(path)!.async('string'), folderGuid);

    const already = await db.issues.where('bcfGuid').equals(topic.guid).first();
    const id = already?.id ?? uuid();

    let camera: Issue['camera'];
    const vpNames = topic.viewpoints.map((v) => v.viewpoint).filter(Boolean) as string[];
    if (!vpNames.length && zip.file(folder + 'viewpoint.bcfv')) vpNames.push('viewpoint.bcfv');
    for (const vp of vpNames) {
      const f = zip.file(folder + vp);
      if (!f) continue;
      try {
        camera = parseViewpointCamera(await f.async('string'));
        if (camera) break;
      } catch {
        /* skip */
      }
    }

    const snapNames = new Set(topic.viewpoints.map((v) => v.snapshot).filter(Boolean) as string[]);
    if (!snapNames.size && zip.file(folder + 'snapshot.png')) snapNames.add('snapshot.png');
    for (const s of snapNames) {
      const f = zip.file(folder + s);
      if (!f) continue;
      const mime = /\.jpe?g$/i.test(s) ? 'image/jpeg' : 'image/png';
      photos.push({ id: uuid(), issueId: id, dataUrl: await blobToDataUrl(await f.async('uint8array'), mime), synced: true, createdAt: ts });
    }

    issues.push({
      id,
      projectId: project.id,
      title: topic.title,
      description: topic.description,
      location: topic.labels.join(', '),
      priority: bcfPriorityToLocal(topic.priority),
      status: bcfStatusToLocal(topic.status),
      remark: already?.remark ?? '',
      bcfGuid: topic.guid,
      bcfStatus: topic.status,
      bcfPriority: topic.priority,
      camera,
      comments: topic.comments.map((c) => ({ guid: c.guid || uuid(), author: c.author, date: c.date, text: c.text })),
      author: topic.creationAuthor,
      synced: already?.synced ?? true,
      createdAt: topic.creationDate || ts,
      updatedAt: ts,
    });
  }

  await db.transaction('rw', [db.projects, db.issues, db.photos], async () => {
    await db.projects.put({ ...project, updatedAt: ts });
    await db.issues.bulkPut(issues);
    // replace previously imported snapshots of the same issues
    const ids = issues.map((i) => i.id);
    await db.photos.where('issueId').anyOf(ids).filter((p) => p.synced).delete();
    await db.photos.bulkPut(photos);
  });

  return { projectId: project.id, projectName: project.name, issues: issues.length, photos: photos.length };
}

/** Export a project as BCF 2.1 archive including the Prüfbericht data. */
export async function exportBcfZip(projectId: string, author = 'BCF-OnSite'): Promise<Blob> {
  const project = await db.projects.get(projectId);
  if (!project) throw new Error('Projekt nicht gefunden');
  const issues = await db.issues.where('projectId').equals(projectId).toArray();
  const zip = new JSZip();
  zip.file('bcf.version', BCF_VERSION_XML);
  zip.file('project.bcfp', buildProject(project.bcfProjectId ?? project.id, project.name));

  for (const issue of issues) {
    const guid = issue.bcfGuid ?? issue.id;
    const folder = zip.folder(guid)!;
    const photos = await db.photos.where('issueId').equals(issue.id).sortBy('createdAt');
    const viewpoints: { guid: string; viewpoint?: string; snapshot?: string }[] = [];

    if (issue.camera && photos.length === 0) {
      const vg = uuid();
      folder.file('viewpoint.bcfv', buildViewpoint(vg, issue.camera));
      viewpoints.push({ guid: vg, viewpoint: 'viewpoint.bcfv' });
    }
    photos.forEach((p, i) => {
      const vg = uuid();
      const { base64, mime } = dataUrlToBase64(p.dataUrl);
      const ext = mime === 'image/png' ? 'png' : 'jpg';
      const vpName = i === 0 ? 'viewpoint.bcfv' : `viewpoint_${i}.bcfv`;
      const snapName = i === 0 ? `snapshot.${ext}` : `snapshot_${i}.${ext}`;
      folder.file(vpName, buildViewpoint(vg, issue.camera));
      folder.file(snapName, base64, { base64: true });
      viewpoints.push({ guid: vg, viewpoint: vpName, snapshot: snapName });
    });

    const comments = (issue.comments ?? []).map((c) => ({ ...c }));
    const pruef = [
      `Prüfbericht – Status: ${STATUS_LABEL[issue.status]}, Priorität: ${PRIORITY_LABEL[issue.priority]}`,
      issue.location ? `Ort: ${issue.location}` : '',
      issue.remark ? `Bemerkung: ${issue.remark}` : '',
    ]
      .filter(Boolean)
      .join('\n');
    comments.push({ guid: uuid(), date: issue.updatedAt, author, text: pruef });

    folder.file(
      'markup.bcf',
      buildMarkup({
        guid,
        title: issue.title,
        description: issue.description,
        status: localStatusToBcf(issue.status, undefined, issue.bcfStatus),
        priority: localPriorityToBcf(issue.priority, undefined, issue.bcfPriority),
        type: 'Issue',
        creationDate: issue.createdAt,
        modifiedDate: issue.updatedAt,
        author: issue.author ?? author,
        labels: issue.location ? [issue.location] : [],
        comments: comments.map((c, i) => ({ ...c, viewpointGuid: i === comments.length - 1 ? viewpoints[0]?.guid : undefined })),
        viewpoints,
      }),
    );
  }
  return zip.generateAsync({ type: 'blob', mimeType: 'application/octet-stream', compression: 'DEFLATE' });
}
