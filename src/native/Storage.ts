// #297/#300 — JS face of the native Logos Storage (Codex) media client.
// Encrypt+upload / download+decrypt happen natively (StorageModule.kt) so multi-MB blobs
// never cross the RN bridge. The returned `key` travels E2E in the `store1:` marker
// (src/messages/media.ts); the storage node only ever holds ciphertext.
import {NativeModules} from 'react-native';

interface StorageNative {
  /**
   * AES-256-GCM encrypt the file, POST to the storage node → {cid, key(base64), cap}.
   * [id] (#308) keys `mediaProgress` upload events for the "sending" ring; pass "" to skip.
   * `cap` (#302) is the per-blob fetch capability the proxy issued; travels in the marker.
   */
  uploadEncrypted(localPath: string, id: string): Promise<{cid: string; key: string; cap: string}>;
  /**
   * GET ciphertext by cid (presenting [cap], #302), decrypt with key(base64), cache locally
   * → local file path. Pass "" for cap on legacy markers that predate #302.
   */
  downloadDecrypt(cid: string, key: string, cap: string): Promise<string>;
}

const Storage = NativeModules.Storage as StorageNative;
export default Storage;
