// #479: JS shim for the native MediaShare module — share a decrypted media file
// (photo/gif/video) via the OS share sheet. Backed by MediaShareModule.kt, which
// copies the file into the FileProvider-exposed cacheDir/exports/ and fires
// ACTION_SEND with a scoped content:// URI.
import {NativeModules} from 'react-native';

interface MediaShareModule {
  /** Share the file at [path] with the given [mime] via the OS chooser. */
  shareFile(path: string, mime: string): Promise<void>;
}

export default NativeModules.MediaShare as MediaShareModule;
