import { Capacitor } from '@capacitor/core';
import { Camera as CameraIcon, Image as ImageIcon } from 'lucide-react';
import { useRef } from 'react';
import { normalizeImage, readFileAsDataUrl } from '../lib/util';

async function nativePhoto(fromCamera: boolean): Promise<string | undefined> {
  const { Camera, CameraResultType, CameraSource } = await import('@capacitor/camera');
  try {
    const photo = await Camera.getPhoto({
      resultType: CameraResultType.DataUrl,
      source: fromCamera ? CameraSource.Camera : CameraSource.Photos,
      quality: 85,
      width: 1920,
      correctOrientation: true,
    });
    return photo.dataUrl;
  } catch (e) {
    if (/cancel/i.test((e as Error).message)) return undefined;
    throw e;
  }
}

/** Two buttons: take a photo with the camera or pick an existing image. */
export function PhotoCapture({ onPhoto, onError }: { onPhoto: (dataUrl: string) => void; onError: (msg: string) => void }) {
  const camInput = useRef<HTMLInputElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const native = Capacitor.isNativePlatform();

  const handleFile = async (f?: File | null) => {
    if (!f) return;
    try {
      onPhoto(await normalizeImage(await readFileAsDataUrl(f)));
    } catch (e) {
      onError((e as Error).message);
    }
  };

  const pick = async (fromCamera: boolean) => {
    if (!native) return (fromCamera ? camInput : fileInput).current?.click();
    try {
      const url = await nativePhoto(fromCamera);
      if (url) onPhoto(await normalizeImage(url));
    } catch (e) {
      onError('Kamera nicht verfügbar: ' + (e as Error).message);
    }
  };

  return (
    <div className="row">
      <button className="btn primary grow" onClick={() => pick(true)}>
        <CameraIcon size={20} /> Kamera
      </button>
      <button className="btn grow" onClick={() => pick(false)}>
        <ImageIcon size={20} /> Auswählen
      </button>
      <input ref={camInput} type="file" accept="image/*" capture="environment" hidden onChange={(e) => (handleFile(e.target.files?.[0]), (e.target.value = ''))} />
      <input ref={fileInput} type="file" accept="image/*" hidden onChange={(e) => (handleFile(e.target.files?.[0]), (e.target.value = ''))} />
    </div>
  );
}
