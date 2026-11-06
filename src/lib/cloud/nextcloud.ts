import { nowIso, uuid } from '../util';
import { HttpStatusError, httpBlob, httpJson, httpText } from './http';
import type { CloudEntry, NextcloudAccount } from './types';

/** Accepts "cloud.firma.ch", "https://cloud.firma.ch/index.php/apps/files/…" etc. and returns the server root. */
export function normalizeNextcloudUrl(input: string): string {
  let u = input.trim();
  if (!/^https?:\/\//i.test(u)) u = 'https://' + u;
  const url = new URL(u);
  let path = url.pathname;
  const cut = path.search(/\/(index\.php|remote\.php|apps|ocs|login)(\/|$)/i);
  if (cut >= 0) path = path.slice(0, cut);
  return (url.origin + path).replace(/\/+$/, '');
}

function base64Utf8(s: string): string {
  const bytes = new TextEncoder().encode(s);
  let bin = '';
  bytes.forEach((b) => (bin += String.fromCharCode(b)));
  return btoa(bin);
}

function authHeader(loginName: string, appPassword: string) {
  return 'Basic ' + base64Utf8(`${loginName}:${appPassword}`);
}

/** Check the credentials and return a ready-to-save account. */
export async function connectNextcloud(input: { url: string; loginName: string; appPassword: string }): Promise<NextcloudAccount> {
  const baseUrl = normalizeNextcloudUrl(input.url);
  const loginName = input.loginName.trim();
  const appPassword = input.appPassword.trim();
  if (!loginName || !appPassword) throw new Error('Benutzername und App-Passwort angeben.');
  const r = await httpJson<{ ocs?: { data?: { id?: string; displayname?: string; 'display-name'?: string; email?: string } } }>(
    `${baseUrl}/ocs/v2.php/cloud/user?format=json`,
    { headers: { Authorization: authHeader(loginName, appPassword), 'OCS-APIRequest': 'true' } },
  );
  if (r.status === 401 || r.status === 403) throw new Error('Benutzername oder App-Passwort ist falsch.');
  if (r.status === 404) throw new Error('Unter dieser Adresse wurde keine Nextcloud gefunden.');
  if (!r.ok) throw new Error(`Nextcloud antwortet mit Fehler ${r.status}.`);
  const d = r.data?.ocs?.data;
  if (!d?.id) throw new Error('Unter dieser Adresse wurde keine Nextcloud gefunden.');
  const name = d.displayname || d['display-name'] || d.id;
  return {
    id: uuid(),
    provider: 'nextcloud',
    label: `${name} · ${new URL(baseUrl).host}`,
    baseUrl,
    loginName,
    userId: d.id,
    appPassword,
    createdAt: nowIso(),
  };
}

function filesRoot(acc: NextcloudAccount) {
  return `${acc.baseUrl}/remote.php/dav/files/${encodeURIComponent(acc.userId)}`;
}

function encodePath(path: string) {
  return path
    .split('/')
    .map((s) => encodeURIComponent(s))
    .join('/');
}

const PROPFIND_BODY = `<?xml version="1.0" encoding="UTF-8"?>
<d:propfind xmlns:d="DAV:">
  <d:prop>
    <d:displayname/>
    <d:resourcetype/>
    <d:getcontentlength/>
    <d:getlastmodified/>
  </d:prop>
</d:propfind>`;

/** List a folder. `path` is relative to the user's files root, e.g. "/" or "/Projekte/MFH Seefeld". */
export async function listNextcloud(acc: NextcloudAccount, path = '/'): Promise<CloudEntry[]> {
  const p = path.startsWith('/') ? path : '/' + path;
  const r = await httpText(filesRoot(acc) + encodePath(p.endsWith('/') ? p : p + '/'), {
    method: 'PROPFIND',
    headers: {
      Authorization: authHeader(acc.loginName, acc.appPassword),
      Depth: '1',
      'Content-Type': 'application/xml; charset=utf-8',
    },
    body: PROPFIND_BODY,
  });
  if (r.status === 401) throw new Error('Nextcloud-Anmeldung abgelehnt. App-Passwort prüfen bzw. Konto neu hinzufügen.');
  if (r.status === 404) throw new Error('Ordner nicht gefunden.');
  if (r.status !== 207 && !r.ok) throw new HttpStatusError(r.status, `Nextcloud-Fehler ${r.status}`);
  return parsePropfind(r.text, acc.userId, p);
}

export function parsePropfind(xml: string, userId: string, requestedPath: string): CloudEntry[] {
  const doc = new DOMParser().parseFromString(xml, 'application/xml');
  const marker = `/remote.php/dav/files/${userId}`;
  const self = trimSlash(requestedPath);
  const out: CloudEntry[] = [];
  for (const resp of all(doc, 'response')) {
    const href = all(resp, 'href')[0]?.textContent ?? '';
    let decoded: string;
    try {
      decoded = decodeURIComponent(href);
    } catch {
      decoded = href;
    }
    const idx = decoded.indexOf(marker);
    if (idx < 0) continue;
    const rel = trimSlash(decoded.slice(idx + marker.length));
    if (rel === self) continue;
    // only take the successful propstat
    const propstats = all(resp, 'propstat');
    const ok = propstats.find((ps) => /\s200\s/.test(' ' + (all(ps, 'status')[0]?.textContent ?? '') + ' ')) ?? propstats[0];
    const prop = all(ok, 'prop')[0];
    const isDir = all(all(prop, 'resourcetype')[0], 'collection').length > 0;
    const size = Number(all(prop, 'getcontentlength')[0]?.textContent);
    const lm = all(prop, 'getlastmodified')[0]?.textContent;
    const name = rel.split('/').pop() || rel;
    out.push({
      ref: rel,
      name,
      isDir,
      size: Number.isFinite(size) && !isDir ? size : undefined,
      modified: lm ? new Date(lm).toISOString() : undefined,
    });
  }
  return out;
}

/** Descendants by local name, independent of the namespace prefix (d:, D:, none). */
function all(el: Element | Document | undefined, local: string): Element[] {
  if (!el) return [];
  return Array.from(el.getElementsByTagName('*')).filter((e) => (e.localName || e.nodeName).split(':').pop() === local);
}

function trimSlash(p: string) {
  const t = p.replace(/\/+$/, '');
  return t.startsWith('/') ? t : '/' + t;
}

export async function downloadNextcloud(acc: NextcloudAccount, path: string): Promise<Blob> {
  try {
    return await httpBlob(filesRoot(acc) + encodePath(path), { Authorization: authHeader(acc.loginName, acc.appPassword) });
  } catch (e) {
    if (e instanceof HttpStatusError && e.status === 401) throw new Error('Nextcloud-Anmeldung abgelehnt. App-Passwort prüfen.');
    throw e;
  }
}
