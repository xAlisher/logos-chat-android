// JS wrapper over the native ImagePicker module (#197). Lets the user pick an
// image from the gallery; the native side downscales + JPEG-compresses it to a
// byte budget so the base64 fits ONE chat message (Status's compress-to-fit),
// and can persist a base64 JPEG to app storage (the sender's local copy).
import {NativeModules} from 'react-native';

export interface PickedImage {
  mime: string;
  width: number;
  height: number;
  /** Encoded JPEG size in bytes (before base64 inflation). */
  byteLength: number;
  /** base64 (no line wrapping) of the downscaled JPEG. */
  base64: string;
}

interface ImagePickerNative {
  /**
   * Open the system gallery picker. Resolves a stringified {@link PickedImage},
   * or null if the user cancelled. [maxDim] caps the longest edge; [budgetBytes]
   * is the target JPEG size the native side compresses toward.
   */
  pickImage(maxDim: number, budgetBytes: number): Promise<string | null>;
  /**
   * #207: pick multiple images. Resolves a stringified JSON array of
   * {@link PickedImage} (≤ maxCount), or null if cancelled.
   */
  pickImages(
    maxDim: number,
    budgetBytes: number,
    maxCount: number,
  ): Promise<string | null>;
  /**
   * #203: capture a photo with the camera. Resolves a stringified
   * {@link PickedImage}, or null if cancelled. Needs the CAMERA runtime permission.
   */
  capturePhoto(maxDim: number, budgetBytes: number): Promise<string | null>;
  /** Persist a base64 JPEG to app storage; resolves the absolute file path. */
  saveBase64Jpeg(base64: string): Promise<string>;
  /** #201: read a stored blob file back to base64 (to forward a media message). */
  readFileBase64(path: string): Promise<string>;
  /** #201 Save: copy a stored image into the device gallery; resolves its uri. */
  saveImageToGallery(path: string): Promise<string>;
  /** #300: save any media (photo/gif/video) to the gallery, routed by mime. */
  saveMediaToGallery(path: string, mime: string): Promise<string>;
  /**
   * #300/#306: pick a RAW gif or video (no downscale — animation preserved), copied to a
   * cache file. [kind] scopes the picker: "gif" (image/gif only) or "video" (video/* only).
   * Resolves a stringified {@link PickedRawMedia}, or null if cancelled. For "gif" it rejects
   * over [maxBytes]; for "video" size is unbounded (compression handles it) and the result
   * carries {durationMs, posterPath}.
   */
  pickRawMedia(maxBytes: number, kind: 'gif' | 'video'): Promise<string | null>;
  /** #440: pick a Peers backup file AND restore it in one native flow — the passphrase is
   *  passed in FIRST (so it's captured before the picker can recreate the Activity).
   *  Resolves the restored address, null if cancelled, or rejects with code
   *  'import' / 'import_partial' (see restoreOutcome.ts). DESTRUCTIVE. */
  pickAndImportBackup(passphrase: string): Promise<string | null>;
}

/** #300: a raw (un-re-encoded) gif/video the user picked, staged in a cache file. */
export interface PickedRawMedia {
  path: string;
  mime: string;
  width: number;
  height: number;
  byteLength: number;
  /** #307: video only — duration + a first-frame poster JPEG for the composer thumbnail. */
  durationMs?: number;
  posterPath?: string;
}

/** Parse the JSON pickRawMedia resolves with. Null on cancel/malformed. */
export function parseRawMedia(json: string | null): PickedRawMedia | null {
  if (!json) return null;
  try {
    const o = JSON.parse(json);
    if (typeof o?.path === 'string' && typeof o?.mime === 'string') {
      return {
        path: o.path,
        mime: o.mime,
        width: typeof o.width === 'number' ? o.width : 0,
        height: typeof o.height === 'number' ? o.height : 0,
        byteLength: typeof o.byteLength === 'number' ? o.byteLength : 0,
        durationMs: typeof o.durationMs === 'number' ? o.durationMs : undefined,
        posterPath: typeof o.posterPath === 'string' ? o.posterPath : undefined,
      };
    }
  } catch {
    // fall through
  }
  return null;
}

const native: ImagePickerNative = NativeModules.ImagePicker;

/** Parse the JSON pickImage resolves with. Returns null on cancel/malformed. */
export function parsePicked(json: string | null): PickedImage | null {
  if (!json) return null;
  try {
    const o = JSON.parse(json);
    if (
      typeof o?.base64 === 'string' &&
      typeof o?.mime === 'string' &&
      typeof o?.width === 'number' &&
      typeof o?.height === 'number'
    ) {
      return {
        mime: o.mime,
        width: o.width,
        height: o.height,
        byteLength: typeof o.byteLength === 'number' ? o.byteLength : 0,
        base64: o.base64,
      };
    }
  } catch {
    // fall through
  }
  return null;
}

/** Parse the JSON array pickImages resolves with. Returns [] on cancel/malformed. */
export function parsePickedArray(json: string | null): PickedImage[] {
  if (!json) return [];
  try {
    const arr = JSON.parse(json);
    if (!Array.isArray(arr)) return [];
    return arr
      .map(o => parsePicked(JSON.stringify(o)))
      .filter((p): p is PickedImage => p != null);
  } catch {
    return [];
  }
}

export default native;
