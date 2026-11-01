import { Capacitor } from '@capacitor/core';

export function uuid(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
}

export const nowIso = () => new Date().toISOString();

export function formatDate(iso?: string): string {
  if (!iso) return '–';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '–';
  return d.toLocaleString('de-CH', { dateStyle: 'short', timeStyle: 'short' });
}

export function dataUrlToBase64(dataUrl: string): { base64: string; mime: string } {
  const m = /^data:([^;]+);base64,(.*)$/.exec(dataUrl);
  if (!m) throw new Error('Ungültige Bilddaten');
  return { mime: m[1], base64: m[2] };
}

export function base64ToDataUrl(base64: string, mime: string): string {
  return `data:${mime};base64,${base64}`;
}

export function downloadBlob(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

export function safeFileName(name: string): string {
  return name.replace(/[^\p{L}\p{N}_.-]+/gu, '_').replace(/_+/g, '_').slice(0, 80) || 'projekt';
}

export function readFileAsDataUrl(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result as string);
    r.onerror = () => reject(r.error);
    r.readAsDataURL(file);
  });
}

/** Downscale an image so photos stay small enough for IndexedDB and BCF snapshots. */
export async function normalizeImage(dataUrl: string, maxSide = 1920, quality = 0.85): Promise<string> {
  const img = await loadImage(dataUrl);
  const scale = Math.min(1, maxSide / Math.max(img.width, img.height));
  const w = Math.round(img.width * scale);
  const h = Math.round(img.height * scale);
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  canvas.getContext('2d')!.drawImage(img, 0, 0, w, h);
  return canvas.toDataURL('image/jpeg', quality);
}

export function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Bild konnte nicht geladen werden'));
    img.src = src;
  });
}

/**
 * Save/share a generated file. In the Android app the file is written to the cache
 * and handed to the share sheet (save to Downloads, mail, Teams …); in the browser it is downloaded.
 */
export async function saveFile(blob: Blob, fileName: string): Promise<void> {
  if (!Capacitor.isNativePlatform()) return downloadBlob(blob, fileName);
  const { Filesystem, Directory } = await import('@capacitor/filesystem');
  const { Share } = await import('@capacitor/share');
  const dataUrl = await readFileAsDataUrl(blob);
  const res = await Filesystem.writeFile({ path: fileName, data: dataUrl.split(',')[1], directory: Directory.Cache });
  await Share.share({ title: fileName, files: [res.uri] });
}
