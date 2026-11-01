export type ProjectStatus = 'active' | 'completed' | 'paused';
export type IssueStatus = 'open' | 'in_progress' | 'done';
export type Priority = 'low' | 'medium' | 'high' | 'critical';

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

/** BCF perspective camera (BCF coordinates, Z-up, metres). */
export interface BcfCamera {
  viewPoint: Vec3;
  direction: Vec3;
  upVector: Vec3;
  fieldOfView: number;
}

export interface Project {
  id: string;
  name: string;
  location: string;
  status: ProjectStatus;
  /** BimCollab / BCF-API project id, if linked */
  bcfProjectId?: string;
  createdAt: string;
  updatedAt: string;
}

export interface IssueComment {
  guid: string;
  author: string;
  date: string;
  text: string;
}

export interface Issue {
  id: string;
  projectId: string;
  title: string;
  description: string;
  location: string;
  priority: Priority;
  status: IssueStatus;
  /** Prüfbericht-Bemerkung */
  remark: string;
  /** remark text that was last posted to BimCollab as comment */
  syncedRemark?: string;
  /** BCF topic guid, if the issue exists in BimCollab */
  bcfGuid?: string;
  /** Original BCF topic status / priority strings */
  bcfStatus?: string;
  bcfPriority?: string;
  camera?: BcfCamera;
  comments?: IssueComment[];
  author?: string;
  /** false = local Prüfbericht changes that still need to be sent to BimCollab */
  synced: boolean;
  /** timestamp of the last successful sync */
  syncedAt?: string;
  /** set when the sync skipped this issue because it has no BimCollab reference */
  localOnly?: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface Photo {
  id: string;
  issueId: string;
  /** annotated image as data URL (image/jpeg or image/png) */
  dataUrl: string;
  synced: boolean;
  createdAt: string;
}

export interface IfcModel {
  projectId: string;
  fileName: string;
  data: Blob;
  uploadedAt: string;
}

export interface KeyValue {
  key: string;
  value: unknown;
}

export const STATUS_LABEL: Record<IssueStatus, string> = {
  open: 'Offen',
  in_progress: 'In Arbeit',
  done: 'Erledigt',
};

export const PRIORITY_LABEL: Record<Priority, string> = {
  low: 'Niedrig',
  medium: 'Mittel',
  high: 'Hoch',
  critical: 'Kritisch',
};

export const PRIORITY_RANK: Record<Priority, number> = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
};

export const PROJECT_STATUS_LABEL: Record<ProjectStatus, string> = {
  active: 'Aktiv',
  completed: 'Abgeschlossen',
  paused: 'Pausiert',
};
