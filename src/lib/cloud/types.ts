import type { TokenSet } from '../bimcollab';

export type CloudProvider = 'nextcloud' | 'onedrive';

export interface NextcloudAccount {
  id: string;
  provider: 'nextcloud';
  label: string;
  /** server root, e.g. https://cloud.example.ch (without /remote.php …) */
  baseUrl: string;
  /** name used to log in (Basic auth) */
  loginName: string;
  /** Nextcloud user id (WebDAV path segment), can differ from the login name */
  userId: string;
  /** app password (Nextcloud: Einstellungen → Sicherheit → Geräte & Sitzungen) */
  appPassword: string;
  createdAt: string;
}

export interface OneDriveAccount {
  id: string;
  provider: 'onedrive';
  label: string;
  email?: string;
  clientId: string;
  tenant: string;
  tokens: TokenSet;
  createdAt: string;
}

export type CloudAccount = NextcloudAccount | OneDriveAccount;

/** One entry in a cloud folder listing. `ref` is what list()/download() need to address it again. */
export interface CloudEntry {
  ref: string;
  name: string;
  isDir: boolean;
  size?: number;
  modified?: string;
}

export const PROVIDER_LABEL: Record<CloudProvider, string> = {
  nextcloud: 'Nextcloud',
  onedrive: 'OneDrive',
};
