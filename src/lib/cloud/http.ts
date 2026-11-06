import { Capacitor, registerPlugin } from '@capacitor/core';

/**
 * HTTP for the cloud import.
 *
 * Android app: everything goes through the app-local native plugin `CloudHttp` (OkHttp). It supports
 * WebDAV methods like PROPFIND (CapacitorHttp does not) and is not subject to CORS.
 * Browser: plain fetch. Microsoft Graph allows CORS; most Nextcloud servers do not.
 */
interface NativeResponse {
  status: number;
  headers: Record<string, string>;
  data?: string;
  path?: string;
}
interface CloudHttpPlugin {
  request(o: { url: string; method: string; headers: Record<string, string>; body?: string }): Promise<NativeResponse>;
  download(o: { url: string; method: string; headers: Record<string, string> }): Promise<NativeResponse>;
  remove(o: { path: string }): Promise<void>;
}
const Native = registerPlugin<CloudHttpPlugin>('CloudHttp');

const native = () => Capacitor.isNativePlatform();

export interface HttpOptions {
  method?: string;
  headers?: Record<string, string>;
  body?: string;
}

export interface HttpResult {
  status: number;
  ok: boolean;
  text: string;
  headers: Record<string, string>;
}

export class NetworkError extends Error {}

function networkError(e: unknown, url: string): NetworkError {
  const host = safeHost(url);
  if (!native()) {
    return new NetworkError(
      `Keine Verbindung zu ${host}. In der Browser-Version blockiert der Server die Anfrage vermutlich (CORS). ` +
        'Die Android-App ist davon nicht betroffen.',
    );
  }
  return new NetworkError(`Keine Verbindung zu ${host}: ${(e as Error)?.message ?? e}`);
}

function safeHost(url: string) {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

export async function httpText(url: string, o: HttpOptions = {}): Promise<HttpResult> {
  const method = (o.method ?? 'GET').toUpperCase();
  const headers = o.headers ?? {};
  if (native()) {
    let r: NativeResponse;
    try {
      r = await Native.request({ url, method, headers, body: o.body });
    } catch (e) {
      throw networkError(e, url);
    }
    return { status: r.status, ok: r.status >= 200 && r.status < 300, text: r.data ?? '', headers: r.headers ?? {} };
  }
  let res: Response;
  try {
    res = await fetch(url, { method, headers, body: o.body });
  } catch (e) {
    throw networkError(e, url);
  }
  const h: Record<string, string> = {};
  res.headers.forEach((v, k) => (h[k.toLowerCase()] = v));
  return { status: res.status, ok: res.ok, text: await res.text(), headers: h };
}

export async function httpJson<T>(url: string, o: HttpOptions = {}): Promise<{ status: number; ok: boolean; data: T; text: string }> {
  const r = await httpText(url, { ...o, headers: { Accept: 'application/json', ...(o.headers ?? {}) } });
  let data: T = undefined as T;
  try {
    data = r.text ? JSON.parse(r.text) : (undefined as T);
  } catch {
    /* not JSON */
  }
  return { status: r.status, ok: r.ok, data, text: r.text };
}

export class HttpStatusError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

/** Download a file as Blob. On Android it is streamed into the app cache first (no base64 over the bridge). */
export async function httpBlob(url: string, headers: Record<string, string> = {}): Promise<Blob> {
  if (native()) {
    let r: NativeResponse;
    try {
      r = await Native.download({ url, method: 'GET', headers });
    } catch (e) {
      throw networkError(e, url);
    }
    if (r.status < 200 || r.status >= 300 || !r.path) throw new HttpStatusError(r.status, `Download fehlgeschlagen (${r.status})`);
    try {
      const res = await fetch(Capacitor.convertFileSrc(r.path));
      return await res.blob();
    } finally {
      Native.remove({ path: r.path }).catch(() => {});
    }
  }
  let res: Response;
  try {
    res = await fetch(url, { headers });
  } catch (e) {
    throw networkError(e, url);
  }
  if (!res.ok) throw new HttpStatusError(res.status, `Download fehlgeschlagen (${res.status})`);
  return res.blob();
}
