import type { IssueStatus, Priority } from './types';

export function bcfStatusToLocal(s?: string | null): IssueStatus {
  const v = (s ?? '').toLowerCase();
  if (/clos|resol|done|erledigt|fixed|abgeschlossen|geschlossen|behoben/.test(v)) return 'done';
  if (/progress|arbeit|bearbeitung|working|assigned/.test(v)) return 'in_progress';
  return 'open';
}

export function bcfPriorityToLocal(s?: string | null): Priority {
  const v = (s ?? '').toLowerCase();
  if (/crit|krit|urgent|dringend|blocker/.test(v)) return 'critical';
  if (/high|hoch|major|wichtig/.test(v)) return 'high';
  if (/low|niedrig|minor|gering|tief/.test(v)) return 'low';
  return 'medium';
}

const STATUS_DEFAULT: Record<IssueStatus, string> = { open: 'Open', in_progress: 'InProgress', done: 'Closed' };
const PRIORITY_DEFAULT: Record<Priority, string> = { low: 'Low', medium: 'Normal', high: 'High', critical: 'Critical' };

/**
 * Pick the server-side BCF status string for a local status.
 * Prefers a value from the project's extension list (e.g. BimCollab uses Active/Resolved/Closed).
 */
export function localStatusToBcf(status: IssueStatus, allowed?: string[], current?: string): string {
  if (current && bcfStatusToLocal(current) === status) return current;
  if (allowed?.length) {
    const candidates = allowed.filter((a) => bcfStatusToLocal(a) === status);
    if (status === 'done') {
      const resolved = candidates.find((c) => /resol|erledigt|done|fixed/i.test(c));
      if (resolved) return resolved;
    }
    if (candidates.length) return candidates[0];
    // "In Arbeit" without an explicit server status: keep it open/active on the server
    if (status === 'in_progress') {
      const open = allowed.find((a) => bcfStatusToLocal(a) === 'open');
      if (open) return open;
    }
  }
  return STATUS_DEFAULT[status];
}

export function localPriorityToBcf(p: Priority, allowed?: string[], current?: string): string {
  if (current && bcfPriorityToLocal(current) === p) return current;
  const hit = allowed?.find((a) => bcfPriorityToLocal(a) === p);
  return hit ?? PRIORITY_DEFAULT[p];
}
