export const IMAGE_TYPES = ["image/png", "image/jpeg", "image/gif", "image/webp", "image/svg+xml"];
export const MAX_IMAGE_BYTES = 4 * 1024 * 1024;
/** Token art is shown up to 512 px (share cards); smaller art is allowed but looks soft. */
export const RECOMMENDED_IMAGE_PX = 512;
/** Non-square raster art is centre-cropped to a square no larger than this. */
const MAX_CROP_PX = 1024;

export interface TokenImage {
  file: File;
  /** Pixel size of `file` (null for SVGs without an intrinsic size). */
  width: number | null;
  height: number | null;
  /** The original wasn't square and was centre-cropped. */
  cropped: boolean;
}

function loadImage(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("This file couldn't be read as an image"));
    };
    img.src = url;
  });
}

/**
 * Token art is square everywhere it appears. Non-square PNG/JPG/WebP files are centre-cropped to
 * a square (at most 1024 px) before upload so what's minted matches the preview. SVGs and GIFs
 * (animation) are uploaded untouched and displayed cropped.
 */
export async function prepareTokenImage(file: File): Promise<TokenImage> {
  if (!IMAGE_TYPES.includes(file.type)) return { file, width: null, height: null, cropped: false };
  const img = await loadImage(file);
  const w = img.naturalWidth || null;
  const h = img.naturalHeight || null;
  const raster = file.type !== "image/svg+xml" && file.type !== "image/gif";
  if (!raster || !w || !h || w === h) return { file, width: w, height: h, cropped: false };

  const side = Math.min(w, h);
  const out = Math.min(side, MAX_CROP_PX);
  const canvas = document.createElement("canvas");
  canvas.width = out;
  canvas.height = out;
  const ctx = canvas.getContext("2d");
  if (!ctx) return { file, width: w, height: h, cropped: false };
  ctx.drawImage(img, (w - side) / 2, (h - side) / 2, side, side, 0, 0, out, out);
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, file.type, 0.92));
  if (!blob) return { file, width: w, height: h, cropped: false };
  return { file: new File([blob], file.name, { type: blob.type }), width: out, height: out, cropped: true };
}
