import { downloadNextcloud, listNextcloud } from './nextcloud';
import { downloadOneDrive, listOneDrive, OD_ROOT } from './onedrive';
import type { CloudAccount, CloudEntry } from './types';

export * from './types';
export { getAccounts, removeAccount, saveAccount, K_ACCOUNTS } from './accounts';

export const rootRef = (acc: CloudAccount) => (acc.provider === 'nextcloud' ? '/' : OD_ROOT);

export async function listFolder(acc: CloudAccount, ref: string): Promise<CloudEntry[]> {
  const items = acc.provider === 'nextcloud' ? await listNextcloud(acc, ref) : await listOneDrive(acc, ref);
  return items.sort((a, b) => Number(b.isDir) - Number(a.isDir) || a.name.localeCompare(b.name, 'de'));
}

/** Download an entry as File (keeps the original name so the importers can detect the type). */
export async function downloadEntry(acc: CloudAccount, entry: CloudEntry): Promise<File> {
  const blob = acc.provider === 'nextcloud' ? await downloadNextcloud(acc, entry.ref) : await downloadOneDrive(acc, entry.ref);
  return new File([blob], entry.name, { type: blob.type || 'application/octet-stream' });
}

export function matchesAccept(name: string, accept: string[]) {
  const n = name.toLowerCase();
  return accept.some((ext) => n.endsWith(ext.toLowerCase()));
}

export function formatSize(bytes?: number) {
  if (bytes === undefined) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
