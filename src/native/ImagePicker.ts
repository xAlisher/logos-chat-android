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
  /** Persist a base64 JPEG to app storage; resolves the absolute file path. */
  saveBase64Jpeg(base64: string): Promise<string>;
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

export default native;
