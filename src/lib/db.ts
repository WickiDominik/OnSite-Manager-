import Dexie, { type Table } from 'dexie';
import type { IfcModel, Issue, KeyValue, Photo, Project } from './types';

class OnSiteDb extends Dexie {
  projects!: Table<Project, string>;
  issues!: Table<Issue, string>;
  photos!: Table<Photo, string>;
  ifcModels!: Table<IfcModel, string>;
  kv!: Table<KeyValue, string>;

  constructor() {
    super('bcf-onsite');
    this.version(1).stores({
      projects: 'id, bcfProjectId, updatedAt',
      issues: 'id, projectId, bcfGuid, status, synced, updatedAt',
      photos: 'id, issueId, synced',
      ifcModels: 'projectId',
      kv: 'key',
    });
  }
}

export const db = new OnSiteDb();

export async function getSetting<T>(key: string): Promise<T | undefined> {
  const row = await db.kv.get(key);
  return row?.value as T | undefined;
}

export async function setSetting<T>(key: string, value: T | undefined): Promise<void> {
  if (value === undefined) await db.kv.delete(key);
  else await db.kv.put({ key, value });
}

export async function deleteProjectCascade(projectId: string) {
  await db.transaction('rw', [db.projects, db.issues, db.photos, db.ifcModels], async () => {
    const issueIds = await db.issues.where('projectId').equals(projectId).primaryKeys();
    if (issueIds.length) await db.photos.where('issueId').anyOf(issueIds).delete();
    await db.issues.where('projectId').equals(projectId).delete();
    await db.ifcModels.delete(projectId);
    await db.projects.delete(projectId);
  });
}

export async function deleteIssueCascade(issueId: string) {
  await db.transaction('rw', [db.issues, db.photos], async () => {
    await db.photos.where('issueId').equals(issueId).delete();
    await db.issues.delete(issueId);
  });
}
