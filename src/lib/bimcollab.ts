import { getSetting, setSetting } from './db';

export interface TenantSettings {
  baseUrl: string;
  clientId: string;
  clientSecret: string;
  scope: string;
}

export interface TokenSet {
  accessToken: string;
  refreshToken?: string;
  expiresAt: number;
}

export interface BimCollabUser {
  id: string;
  name: string;
}

export const PLAYGROUND: TenantSettings = {
  baseUrl: 'https://playground.bimcollab.com',
  clientId: 'PlayGround_Client',
  clientSecret: 'PlayGround_Secret',
  scope: 'openid offline_access bcf',
};

const K_TENANT = 'bimcollab.tenant';
const K_TOKENS = 'bimcollab.tokens';
const K_USER = 'bimcollab.user';
const PKCE_KEY = 'bimcollab.pkce';
export const BCF_VERSION = '3.0';

export async function getTenant(): Promise<TenantSettings> {
  const t = await getSetting<Partial<TenantSettings>>(K_TENANT);
  if (!t?.baseUrl) return PLAYGROUND;
  return {
    baseUrl: normalizeBaseUrl(t.baseUrl),
    clientId: t.clientId || PLAYGROUND.clientId,
    clientSecret: t.clientSecret ?? '',
    scope: t.scope || PLAYGROUND.scope,
  };
}

export async function getStoredTenant(): Promise<Partial<TenantSettings> | undefined> {
  return getSetting<Partial<TenantSettings>>(K_TENANT);
}

export async function saveTenant(t: Partial<TenantSettings> | undefined) {
  const current = await getTenant();
  await setSetting(K_TENANT, t ? { ...t, baseUrl: t.baseUrl ? normalizeBaseUrl(t.baseUrl) : '' } : undefined);
  const next = await getTenant();
  // a different server or client invalidates the existing login
  if (current.baseUrl !== next.baseUrl || current.clientId !== next.clientId) await disconnect();
}

export function normalizeBaseUrl(url: string): string {
  let u = url.trim();
  if (!/^https?:\/\//i.test(u)) u = 'https://' + u;
  return u.replace(/\/+$/, '');
}

export const getTokens = () => getSetting<TokenSet>(K_TOKENS);
export const getUser = () => getSetting<BimCollabUser>(K_USER);

export async function isConnected() {
  return !!(await getTokens());
}

export async function disconnect() {
  await setSetting(K_TOKENS, undefined);
  await setSetting(K_USER, undefined);
  notify();
}

// ---------- change notifications for the UI ----------
type Listener = () => void;
const listeners = new Set<Listener>();
export function onAuthChange(l: Listener) {
  listeners.add(l);
  return () => listeners.delete(l);
}
function notify() {
  listeners.forEach((l) => l());
}

// ---------- PKCE ----------
function b64url(bytes: Uint8Array): string {
  let s = '';
  bytes.forEach((b) => (s += String.fromCharCode(b)));
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function randomString(len = 64): string {
  const bytes = new Uint8Array(len);
  crypto.getRandomValues(bytes);
  return b64url(bytes).slice(0, len);
}

export async function pkceChallenge(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
  return b64url(new Uint8Array(digest));
}

export function redirectUri(): string {
  return window.location.origin + window.location.pathname;
}

interface AuthEndpoints {
  authUrl: string;
  tokenUrl: string;
}

async function discover(t: TenantSettings): Promise<AuthEndpoints> {
  try {
    const res = await fetch(`${t.baseUrl}/bcf/${BCF_VERSION}/auth`, { headers: { Accept: 'application/json' } });
    if (res.ok) {
      const j = await res.json();
      if (j.oauth2_auth_url && j.oauth2_token_url) return { authUrl: j.oauth2_auth_url, tokenUrl: j.oauth2_token_url };
    }
  } catch {
    /* fall back to the BimCollab defaults */
  }
  return { authUrl: `${t.baseUrl}/identity/connect/authorize`, tokenUrl: `${t.baseUrl}/identity/connect/token` };
}

/** Start the OAuth2 Authorization Code + PKCE flow (navigates away). */
export async function startLogin(): Promise<void> {
  const t = await getTenant();
  const ep = await discover(t);
  const verifier = randomString(64);
  const state = randomString(24);
  localStorage.setItem(PKCE_KEY, JSON.stringify({ verifier, state, tokenUrl: ep.tokenUrl, redirect: redirectUri() }));
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: t.clientId,
    redirect_uri: redirectUri(),
    scope: t.scope,
    state,
    code_challenge: await pkceChallenge(verifier),
    code_challenge_method: 'S256',
  });
  window.location.assign(`${ep.authUrl}?${params}`);
}

/**
 * Called on app start: if the URL carries an OAuth code for us, exchange it for tokens.
 * Returns true if a login was completed.
 */
export async function completeLoginFromUrl(): Promise<boolean> {
  const url = new URL(window.location.href);
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  const error = url.searchParams.get('error');
  const raw = localStorage.getItem(PKCE_KEY);
  if (!raw || (!code && !error)) return false;
  const pkce = JSON.parse(raw) as { verifier: string; state: string; tokenUrl: string; redirect: string };
  // clean the URL so a reload does not re-run the exchange
  ['code', 'state', 'error', 'error_description', 'session_state', 'iss', 'scope'].forEach((k) => url.searchParams.delete(k));
  window.history.replaceState(null, '', url.pathname + url.search + url.hash);
  localStorage.removeItem(PKCE_KEY);
  if (error) throw new Error(`BimCollab-Anmeldung abgelehnt: ${error}`);
  if (state !== pkce.state) throw new Error('Ungültiger Anmeldestatus (state). Bitte erneut verbinden.');

  const t = await getTenant();
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code: code!,
    redirect_uri: pkce.redirect,
    client_id: t.clientId,
    code_verifier: pkce.verifier,
  });
  if (t.clientSecret) body.set('client_secret', t.clientSecret);
  await requestTokens(pkce.tokenUrl, body);
  localStorage.setItem('bimcollab.tokenUrl', pkce.tokenUrl);
  await refreshUser();
  notify();
  return true;
}

async function requestTokens(tokenUrl: string, body: URLSearchParams): Promise<TokenSet> {
  const res = await fetch(tokenUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
    body: body.toString(),
  });
  if (!res.ok) throw new Error(`Token-Anfrage fehlgeschlagen (${res.status}): ${await safeText(res)}`);
  const j = await res.json();
  const old = await getTokens();
  const tokens: TokenSet = {
    accessToken: j.access_token,
    refreshToken: j.refresh_token ?? old?.refreshToken,
    expiresAt: Date.now() + (Number(j.expires_in) || 3600) * 1000,
  };
  await setSetting(K_TOKENS, tokens);
  return tokens;
}

let refreshing: Promise<TokenSet> | null = null;

export async function refreshTokens(): Promise<TokenSet> {
  if (refreshing) return refreshing;
  refreshing = (async () => {
    const tokens = await getTokens();
    if (!tokens?.refreshToken) {
      await disconnect();
      throw new Error('BimCollab-Sitzung abgelaufen. Bitte Konto neu verbinden.');
    }
    const t = await getTenant();
    const tokenUrl = localStorage.getItem('bimcollab.tokenUrl') ?? (await discover(t)).tokenUrl;
    const body = new URLSearchParams({ grant_type: 'refresh_token', refresh_token: tokens.refreshToken, client_id: t.clientId });
    if (t.clientSecret) body.set('client_secret', t.clientSecret);
    try {
      return await requestTokens(tokenUrl, body);
    } catch (e) {
      await disconnect();
      throw new Error('Token-Erneuerung fehlgeschlagen. Bitte Konto neu verbinden. ' + (e as Error).message);
    }
  })();
  try {
    return await refreshing;
  } finally {
    refreshing = null;
  }
}

async function accessToken(): Promise<string> {
  let tokens = await getTokens();
  if (!tokens) throw new Error('Kein BimCollab-Konto verbunden');
  if (tokens.expiresAt - 60_000 < Date.now()) tokens = await refreshTokens();
  return tokens.accessToken;
}

async function safeText(res: Response) {
  try {
    return (await res.text()).slice(0, 300);
  } catch {
    return '';
  }
}

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

/** Authenticated request against the BCF REST API of the configured BimCollab space. */
export async function bcfApi<T = unknown>(path: string, init: RequestInit = {}, retry = true): Promise<T> {
  const t = await getTenant();
  const token = await accessToken();
  const res = await fetch(`${t.baseUrl}/bcf/${BCF_VERSION}${path}`, {
    ...init,
    headers: {
      Accept: 'application/json',
      ...(init.body ? { 'Content-Type': 'application/json' } : {}),
      ...(init.headers ?? {}),
      Authorization: `Bearer ${token}`,
    },
  });
  if (res.status === 401 && retry) {
    await refreshTokens();
    return bcfApi<T>(path, init, false);
  }
  if (!res.ok) throw new ApiError(res.status, `${init.method ?? 'GET'} ${path} → ${res.status} ${await safeText(res)}`);
  if (res.status === 204) return undefined as T;
  const ct = res.headers.get('content-type') ?? '';
  return (ct.includes('json') ? res.json() : res.text()) as Promise<T>;
}

export async function refreshUser(): Promise<BimCollabUser | undefined> {
  try {
    const u = await bcfApi<{ id: string; name?: string }>('/current-user');
    const user = { id: u.id, name: u.name || u.id };
    await setSetting(K_USER, user);
    return user;
  } catch {
    return undefined;
  }
}

// ---------- BCF API 3.0 types ----------
export interface ApiProject {
  project_id: string;
  name: string;
}
export interface ApiTopic {
  guid: string;
  title: string;
  description?: string;
  topic_status?: string;
  topic_type?: string;
  priority?: string;
  labels?: string[];
  creation_date?: string;
  creation_author?: string;
  modified_date?: string;
  assigned_to?: string;
  stage?: string;
  due_date?: string;
  reference_links?: string[];
}
export interface ApiComment {
  guid: string;
  date: string;
  author: string;
  comment: string;
}
export interface ApiViewpoint {
  guid: string;
  perspective_camera?: {
    camera_view_point: { x: number; y: number; z: number };
    camera_direction: { x: number; y: number; z: number };
    camera_up_vector: { x: number; y: number; z: number };
    field_of_view: number;
  };
}
export interface ApiExtensions {
  topic_type?: string[];
  topic_status?: string[];
  priority?: string[];
}
