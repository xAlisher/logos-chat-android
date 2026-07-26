// JS wrapper over the native AudioRecorder module — voice-note capture + playback
// for the chat composer. The native side records a small AAC/.m4a file (mono,
// 16 kHz, ~24 kbps — legacy Status's AAC/mono voice-note shape) and returns it as
// base64 so it can ride the chat wire as an attachment envelope (cf. ImagePicker),
// plus a compact 0..100 amplitude waveform for the bubble. Recording auto-stops at
// a 120 s cap (Status's `max-audio-duration-ms`), signalled by a "maxDuration"
// DeviceEventEmitter event on the "AudioRecorderEvent" channel.
import {NativeModules} from 'react-native';

/** Hard recording cap enforced natively (ms) — Status's max-audio-duration-ms. */
export const MAX_RECORDING_MS = 120_000;

export interface Recording {
  /** base64 (no line wrapping) of the AAC/.m4a bytes. */
  base64: string;
  /** Captured length in milliseconds. */
  durationMs: number;
  /** Container MIME — always "audio/mp4". */
  mime: string;
  /** ~40 evenly-sampled amplitude bars, each normalised to 0..100. */
  waveform: number[];
}

interface AudioRecorderNative {
  /**
   * Start recording to a temp AAC/.m4a file. Resolves once capture has started.
   * Rejects "permission" if RECORD_AUDIO is not granted, "busy" if already
   * recording, or "start_failed" on a recorder error. Auto-stops at the 120 s cap
   * (emits a "maxDuration" event); collect the note with {@link stopRecording}.
   */
  startRecording(): Promise<null>;
  /**
   * Stop recording and resolve a stringified {@link Recording} JSON. Rejects
   * "not_recording" if nothing was captured or "empty" if the clip was too short
   * to encode. Also usable after the cap's auto-stop to collect the note.
   */
  stopRecording(): Promise<string>;
  /** Abort the current recording and delete its temp file. Resolves null. */
  cancelRecording(): Promise<null>;
  /**
   * Persist a base64 AAC/.m4a payload content-addressed under app storage;
   * resolves the absolute file path.
   */
  saveBase64Audio(base64: string): Promise<string>;
  /**
   * Play the AAC/.m4a file at [path] (stops any current playback first). Resolves
   * once playback starts; a "playbackEnded" event fires when it finishes.
   */
  playFile(path: string): Promise<null>;
  /** Stop any current playback. Resolves null. */
  stopPlaying(): Promise<null>;
}

const native: AudioRecorderNative = NativeModules.AudioRecorder;

/** Parse the JSON {@link stopRecording} resolves with. Returns null if malformed. */
export function parseRecording(json: string | null): Recording | null {
  if (!json) return null;
  try {
    const o = JSON.parse(json);
    if (
      typeof o?.base64 === 'string' &&
      typeof o?.durationMs === 'number' &&
      typeof o?.mime === 'string' &&
      Array.isArray(o?.waveform)
    ) {
      return {
        base64: o.base64,
        durationMs: o.durationMs,
        mime: o.mime,
        waveform: o.waveform.filter((n: unknown): n is number => typeof n === 'number'),
      };
    }
  } catch {
    // fall through
  }
  return null;
}

export default native;
