import { CloudOff, CloudCheck } from 'lucide-react';
import {
  PRIORITY_LABEL,
  PROJECT_STATUS_LABEL,
  STATUS_LABEL,
  type IssueStatus,
  type Priority,
  type ProjectStatus,
} from '../lib/types';

export const StatusBadge = ({ status }: { status: IssueStatus }) => <span className={`badge b-${status}`}>{STATUS_LABEL[status]}</span>;
export const PriorityBadge = ({ priority }: { priority: Priority }) => (
  <span className={`badge b-${priority}`}>{PRIORITY_LABEL[priority]}</span>
);
export const ProjectStatusBadge = ({ status }: { status: ProjectStatus }) => (
  <span className={`badge b-${status}`}>{PROJECT_STATUS_LABEL[status]}</span>
);
export const BcfBadge = () => <span className="badge b-bcf">BCF</span>;
export const SyncBadge = ({ synced }: { synced: boolean }) =>
  synced ? (
    <span className="badge b-synced">
      <CloudCheck size={13} /> synchronisiert
    </span>
  ) : (
    <span className="badge b-unsynced">
      <CloudOff size={13} /> nicht synchronisiert
    </span>
  );
