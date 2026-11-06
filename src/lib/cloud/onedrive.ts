import { getSetting, setSetting } from '../db';
import { nowIso, uuid } from '../util';
import { getAccount, saveAccount } from './accounts';
import { HttpStatusError, httpBlob, httpJson } from './http';
import type { CloudEntry, OneDriveAccount } from './types';

/**
 * OneDrive / SharePoint via Microsoft Graph.
 * OAuth 2.0 Authorization Code + PKCE as public client (no secret). Needs an app registration in
 * Microsoft Entra ID (Azure AD); its client id and tenant are configured in the app settings.
 */
export interface OneDriveConfig {
  clientId: string;
  /** "common", "organizations", a tenant id or a domain such as schaerholzbau.ch */
  tenant: string;
}

const K_CONFIG = 'cloud.onedrive.config';
const PKCE_KEY = 'onedrive.pkce';
export const GRAPH = 'https://graph.microsoft.com/v1.0';
export const ONEDRIVE_SCOPES = 'openid profile offline_access User.Read Files.Read.All';

export const DEFAULT_ONEDRIVE: OneDriveConfig = {
  clientId: (import.meta.env.VITE_ONEDRIVE_CLIENT_ID as string | undefined) ?? '',
  tenant: (import.meta.env.VITE_ONEDRIVE_TENANT as string | undefined) || 'common',
};

export async function getOneDriveConfig(): Promise<OneDriveConfig> {
  const c = await getSetting<Partial<OneDriveConfig>>(K_CONFIG);
  return { clientId: c?.clientId?.trim() || DEFAULT_ONEDRIVE.clientId, tenant: c?.tenant?.trim() || DEFAULT_ONEDRIVE.tenant };
}

export async function getStoredOneDriveConfig() {
  return getSetting<Partial<OneDriveConfig>>(K_CONFIG);
}

export async function saveOneDriveConfig(c: Partial<OneDriveConfig>) {
  await setSetting(K_CONFIG, { clientId: c.clientId?.trim() ?? '', tenant: c.tenant?.trim() ?? '' });
}

export function oneDriveRedirectUri(): string {
  return window.location.origin + window.location.pathname;
}

const authority = (tenant: string) => `https://login.microsoftonline.com/${encodeURIComponent(tenant)}/oauth2/v2.0`;

function b64url(bytes: Uint8Array): string {
  let s = '';
  bytes.forEach((b) => (s += String.fromCharCode(b)));
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function randomString(len: number) {
  const bytes = new Uint8Array(len);
  crypto.getRandomValues(bytes);
  return b64url(bytes).slice(0, len);
}
async function challenge(verifier: string) {
  return b64url(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))));
}

/** Navigate to the Microsoft sign-in page. The app is reloaded with ?code=… afterwards. */
export async function startOneDriveLogin(): Promise<void> {
  const cfg = await getOneDriveConfig();
  if (!cfg.clientId) throw new Error('Bitte zuerst die Client-ID der Azure-App-Registrierung eintragen.');
  const verifier = randomString(64);
  const state = 'od-' + randomString(24);
  const redirect = oneDriveRedirectUri();
  localStorage.setItem(PKCE_KEY, JSON.stringify({ verifier, state, redirect, ...cfg }));
  const params = new URLSearchParams({
    client_id: cfg.clientId,
    response_type: 'code',
    redirect_uri: redirect,
    response_mode: 'query',
    scope: ONEDRIVE_SCOPES,
    state,
    code_challenge: await challenge(verifier),
    code_challenge_method: 'S256',
    prompt: 'select_account',
  });
  window.location.assign(`${authority(cfg.tenant)}/authorize?${params}`);
}

/**
 * Finish a Microsoft redirect on app start. Returns the new account, or undefined when the
 * URL does not belong to a OneDrive login (e.g. a BimCollab one).
 */
export async function completeOneDriveLoginFromUrl(): Promise<OneDriveAccount | undefined> {
  const url = new URL(window.location.href);
  const state = url.searchParams.get('state');
  const raw = localStorage.getItem(PKCE_KEY);
  if (!raw || !state) return undefined;
  const pkce = JSON.parse(raw) as { verifier: string; state: string; redirect: string } & OneDriveConfig;
  if (state !== pkce.state) return undefined;
  const code = url.searchParams.get('code');
  const error = url.searchParams.get('error');
  const errorDesc = url.searchParams.get('error_description');
  ['code', 'state', 'error', 'error_description', 'error_uri', 'session_state', 'client_info'].forEach((k) => url.searchParams.delete(k));
  window.history.replaceState(null, '', url.pathname + url.search + url.hash);
  localStorage.removeItem(PKCE_KEY);
  if (error) throw new Error(`Microsoft-Anmeldung abgelehnt: ${errorDesc || error}`);
  if (!code) return undefined;

  const tokens = await tokenRequest(pkce.tenant, {
    grant_type: 'authorization_code',
    client_id: pkce.clientId,
    code,
    redirect_uri: pkce.redirect,
    code_verifier: pkce.verifier,
    scope: ONEDRIVE_SCOPES,
  });
  const acc: OneDriveAccount = {
    id: uuid(),
    provider: 'onedrive',
    label: 'OneDrive',
    clientId: pkce.clientId,
    tenant: pkce.tenant,
    tokens,
    createdAt: nowIso(),
  };
  try {
    const me = await graphGet<{ displayName?: string; mail?: string; userPrincipalName?: string }>(acc, '/me?$select=displayName,mail,userPrincipalName');
    acc.email = me.mail || me.userPrincipalName;
    acc.label = [me.displayName, acc.email].filter(Boolean).join(' · ') || 'OneDrive';
  } catch {
    /* label stays generic */
  }
  await saveAccount(acc);
  return acc;
}

async function tokenRequest(tenant: string, params: Record<string, string>, old?: OneDriveAccount['tokens']) {
  const r = await httpJson<{ access_token?: string; refresh_token?: string; expires_in?: number; error?: string; error_description?: string }>(
    `${authority(tenant)}/token`,
    { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(params).toString() },
  );
  if (!r.ok || !r.data?.access_token) {
    const desc = r.data?.error_description?.split('\r\n')[0] ?? r.text.slice(0, 200);
    throw new Error(`Microsoft-Token-Anfrage fehlgeschlagen (${r.status}): ${desc}`);
  }
  return {
    accessToken: r.data.access_token,
    refreshToken: r.data.refresh_token ?? old?.refreshToken,
    expiresAt: Date.now() + (Number(r.data.expires_in) || 3600) * 1000,
  };
}

async function refresh(acc: OneDriveAccount): Promise<OneDriveAccount> {
  if (!acc.tokens.refreshToken) throw new Error('OneDrive-Sitzung abgelaufen. Bitte Konto neu verbinden.');
  try {
    acc.tokens = await tokenRequest(
      acc.tenant,
      { grant_type: 'refresh_token', client_id: acc.clientId, refresh_token: acc.tokens.refreshToken, scope: ONEDRIVE_SCOPES },
      acc.tokens,
    );
  } catch (e) {
    throw new Error('OneDrive-Sitzung abgelaufen. Bitte Konto entfernen und neu verbinden. ' + (e as Error).message);
  }
  // persist only if the account is (still) saved
  if (await getAccount(acc.id)) await saveAccount(acc);
  return acc;
}

async function token(acc: OneDriveAccount): Promise<string> {
  if (acc.tokens.expiresAt - 60_000 < Date.now()) await refresh(acc);
  return acc.tokens.accessToken;
}

export async function graphGet<T>(acc: OneDriveAccount, pathOrUrl: string, retry = true): Promise<T> {
  const url = pathOrUrl.startsWith('https://') ? pathOrUrl : GRAPH + pathOrUrl;
  const r = await httpJson<T & { error?: { message?: string } }>(url, { headers: { Authorization: `Bearer ${await token(acc)}` } });
  if (r.status === 401 && retry) {
    await refresh(acc);
    return graphGet<T>(acc, pathOrUrl, false);
  }
  if (r.status === 403) throw new Error('Kein Zugriff auf diesen Ordner.');
  if (r.status === 404) throw new Error('Ordner oder Datei nicht gefunden.');
  if (!r.ok) throw new HttpStatusError(r.status, `OneDrive-Fehler ${r.status}: ${r.data?.error?.message ?? ''}`);
  return r.data;
}

interface DriveItem {
  id: string;
  name: string;
  size?: number;
  lastModifiedDateTime?: string;
  folder?: unknown;
  file?: unknown;
  package?: unknown;
  parentReference?: { driveId?: string };
  remoteItem?: { id: string; folder?: unknown; file?: unknown; size?: number; parentReference?: { driveId?: string } };
  '@microsoft.graph.downloadUrl'?: string;
}

/** Virtual top level. */
export const OD_ROOT = '';
const OD_MY = 'my';
const OD_SHARED = 'shared';

export function mapDriveItem(it: DriveItem): CloudEntry | undefined {
  const remote = it.remoteItem;
  const id = remote?.id ?? it.id;
  const driveId = remote?.parentReference?.driveId ?? it.parentReference?.driveId;
  if (!driveId) return undefined;
  const isDir = !!(remote ? remote.folder : it.folder);
  if (!isDir && !(remote ? remote.file : it.file)) return undefined; // OneNote notebooks etc.
  return {
    ref: `${driveId}|${id}`,
    name: it.name,
    isDir,
    size: isDir ? undefined : (remote?.size ?? it.size),
    modified: it.lastModifiedDateTime,
  };
}

// drive ids ("b!…") and item ids ("…!105") contain "!", so "|" separates them
function splitRef(ref: string): [string, string] {
  const i = ref.indexOf('|');
  return [ref.slice(0, i), ref.slice(i + 1)];
}

export async function listOneDrive(acc: OneDriveAccount, ref = OD_ROOT): Promise<CloudEntry[]> {
  if (ref === OD_ROOT) {
    return [
      { ref: OD_MY, name: 'Meine Dateien', isDir: true },
      { ref: OD_SHARED, name: 'Für mich freigegeben', isDir: true },
    ];
  }
  let url: string;
  if (ref === OD_MY) url = '/me/drive/root/children?$top=200';
  else if (ref === OD_SHARED) url = '/me/drive/sharedWithMe?$top=200';
  else {
    const [driveId, itemId] = splitRef(ref);
    url = `/drives/${encodeURIComponent(driveId)}/items/${encodeURIComponent(itemId)}/children?$top=200`;
  }
  const out: CloudEntry[] = [];
  for (let page = 0; url && page < 20; page++) {
    const r = await graphGet<{ value: DriveItem[]; '@odata.nextLink'?: string }>(acc, url);
    r.value.forEach((it) => {
      const e = mapDriveItem(it);
      if (e) out.push(e);
    });
    url = r['@odata.nextLink'] ?? '';
  }
  return out;
}

export async function downloadOneDrive(acc: OneDriveAccount, ref: string): Promise<Blob> {
  const [driveId, itemId] = splitRef(ref);
  const item = await graphGet<DriveItem>(acc, `/drives/${encodeURIComponent(driveId)}/items/${encodeURIComponent(itemId)}`);
  const dl = item['@microsoft.graph.downloadUrl'];
  if (dl) return httpBlob(dl); // pre-authenticated, short-lived URL
  return httpBlob(`${GRAPH}/drives/${encodeURIComponent(driveId)}/items/${encodeURIComponent(itemId)}/content`, {
    Authorization: `Bearer ${await token(acc)}`,
  });
}
