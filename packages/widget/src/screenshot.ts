/**
 * Screenshot capture + downscale. Desktop browsers: one frame from
 * `getDisplayMedia` (the user picks a screen/window/tab; the host hides the
 * widget panel during the dialog so it is not in the capture). Everywhere:
 * a file picker or a pasted image. Output is a data URL ≤ MAX_BYTES decoded.
 */
export const MAX_LONG_SIDE = 1600;
export const MAX_BYTES = 1.5 * 1024 * 1024;
export const JPEG_QUALITY = 0.82;

/** Target size keeping aspect ratio with the long side ≤ `max`. Pure. */
export function fitWithin(width: number, height: number, max = MAX_LONG_SIDE): { width: number; height: number } {
  if (width <= 0 || height <= 0) return { width: 0, height: 0 };
  const long = Math.max(width, height);
  if (long <= max) return { width: Math.round(width), height: Math.round(height) };
  const scale = max / long;
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

/** Decoded byte length of a base64 data URL. Pure. */
export function dataUrlBytes(dataUrl: string): number {
  const comma = dataUrl.indexOf(",");
  if (comma === -1) return 0;
  const b64 = dataUrl.slice(comma + 1);
  const padding = b64.endsWith("==") ? 2 : b64.endsWith("=") ? 1 : 0;
  return Math.floor((b64.length * 3) / 4) - padding;
}

export function canCaptureScreen(): boolean {
  try {
    return typeof navigator !== "undefined" && !!navigator.mediaDevices && typeof navigator.mediaDevices.getDisplayMedia === "function"
      && !/Mobi|Android|iPhone|iPad/i.test(navigator.userAgent);
  } catch {
    return false;
  }
}

function hasTransparency(ctx: CanvasRenderingContext2D, w: number, h: number): boolean {
  // Sample a sparse grid; good enough to decide PNG vs JPEG.
  const step = Math.max(1, Math.floor(Math.min(w, h) / 24));
  const data = ctx.getImageData(0, 0, w, h).data;
  for (let y = 0; y < h; y += step) {
    for (let x = 0; x < w; x += step) {
      if (data[(y * w + x) * 4 + 3] < 250) return true;
    }
  }
  return false;
}

/** Draw a source onto a canvas within the size budget and encode it. */
export function encodeSource(source: CanvasImageSource, sw: number, sh: number): string {
  const { width, height } = fitWithin(sw, sh);
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("canvas unavailable");
  ctx.drawImage(source, 0, 0, width, height);
  if (hasTransparency(ctx, width, height)) {
    const png = canvas.toDataURL("image/png");
    if (dataUrlBytes(png) <= MAX_BYTES) return png;
  }
  let q = JPEG_QUALITY;
  let out = canvas.toDataURL("image/jpeg", q);
  while (dataUrlBytes(out) > MAX_BYTES && q > 0.3) {
    q -= 0.12;
    out = canvas.toDataURL("image/jpeg", q);
  }
  if (dataUrlBytes(out) > MAX_BYTES) throw new Error("screenshot too large");
  return out;
}

export async function captureScreen(): Promise<string> {
  const stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false } as MediaStreamConstraints);
  try {
    const video = document.createElement("video");
    video.srcObject = stream;
    video.muted = true;
    (video as any).playsInline = true;
    await new Promise<void>((res, rej) => {
      video.onloadedmetadata = () => res();
      video.onerror = () => rej(new Error("video error"));
      setTimeout(() => rej(new Error("capture timeout")), 8000);
    });
    await video.play();
    // Let the first real frame land (some browsers deliver a black frame first).
    await new Promise((r) => setTimeout(r, 180));
    return encodeSource(video, video.videoWidth, video.videoHeight);
  } finally {
    stream.getTracks().forEach((t) => t.stop());
  }
}

export function fileToDataUrl(file: Blob): Promise<string> {
  if (!/^image\/(png|jpeg|webp|gif)$/.test(file.type)) return Promise.reject(new Error("unsupported image type"));
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      try {
        resolve(encodeSource(img, img.naturalWidth, img.naturalHeight));
      } catch (e) {
        reject(e);
      } finally {
        URL.revokeObjectURL(url);
      }
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("could not decode image"));
    };
    img.src = url;
  });
}

/** First image file in a paste event, if any. */
export function imageFromPaste(e: ClipboardEvent): File | null {
  const items = e.clipboardData && e.clipboardData.items;
  if (!items) return null;
  for (let i = 0; i < items.length; i++) {
    const it = items[i];
    if (it.kind === "file" && it.type.indexOf("image/") === 0) {
      const f = it.getAsFile();
      if (f) return f;
    }
  }
  return null;
}
