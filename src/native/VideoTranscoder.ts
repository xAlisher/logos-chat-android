// #305 — JS face of the native on-device video compressor (VideoTranscoder.kt).
// Re-encodes a picked clip to ~720p H.264 (audio passed through) so it fits a sane upload
// budget. Progress arrives as `mediaProgress` device events keyed by [id] (see mediaProgress.ts);
// on any failure the native side resolves {skipped:true, path:<original>} so we still send.
import {NativeModules} from 'react-native';

interface VideoTranscoderNative {
  transcode(
    inputPath: string,
    id: string,
  ): Promise<{
    path: string;
    width?: number;
    height?: number;
    skipped?: boolean;
    cancelled?: boolean;
  }>;
  // #385: cancel a queued or in-flight transcode by [id]. No-op if there is none. The pending
  // transcode() promise then resolves {skipped:true, cancelled:true, path:<original>}.
  cancelTranscode(id: string): void;
}

const VideoTranscoder = NativeModules.VideoTranscoder as VideoTranscoderNative;
export default VideoTranscoder;
