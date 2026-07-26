// voiceMsg — the voice-note wire format (#205), pure + RN-free (unit-tested).
// Like images, the audio rides as base64 over the text pipe and is saved to a
// file on both ends; the DB keeps a small local marker.
//
//   WIRE (transport):  voc1:<mime>:<durMs>:<w,w,…>␟<base64>
//   LOCAL (DB):        voc1v:<mime>:<durMs>:<w,w,…>␟<absoluteFilePath>
// The waveform is a compact CSV of 0..100 amplitude samples for the bubble UI.

export const VOICE_WIRE_PREFIX = 'voc1:';
export const VOICE_LOCAL_PREFIX = 'voc1v:';
const SEP = '␟';

export interface VoiceMeta {
  mime: string;
  durationMs: number;
  waveform: number[];
}

function header(m: VoiceMeta): string {
  return `${m.mime}:${m.durationMs}:${m.waveform.join(',')}`;
}

export function buildVoiceWire(m: VoiceMeta, base64: string): string {
  return `${VOICE_WIRE_PREFIX}${header(m)}${SEP}${base64}`;
}

export function buildVoiceLocal(m: VoiceMeta, path: string): string {
  return `${VOICE_LOCAL_PREFIX}${header(m)}${SEP}${path}`;
}

function parse(
  s: string,
  prefix: string,
): {meta: VoiceMeta; payload: string} | null {
  if (!s.startsWith(prefix)) return null;
  const sep = s.indexOf(SEP);
  if (sep < 0) return null;
  const head = s.slice(prefix.length, sep);
  const payload = s.slice(sep + 1);
  if (payload.length === 0) return null;
  // head = "<mime>:<durMs>:<csv>" — mime has no ':', so split on the first two.
  const c1 = head.indexOf(':');
  const c2 = head.indexOf(':', c1 + 1);
  if (c1 < 0 || c2 < 0) return null;
  const mime = head.slice(0, c1);
  const durationMs = parseInt(head.slice(c1 + 1, c2), 10);
  const csv = head.slice(c2 + 1);
  const waveform = csv.length
    ? csv.split(',').map(x => parseInt(x, 10)).filter(n => Number.isFinite(n))
    : [];
  if (!mime || !Number.isFinite(durationMs)) return null;
  return {meta: {mime, durationMs, waveform}, payload};
}

export function parseVoiceWire(
  s: string,
): {meta: VoiceMeta; base64: string} | null {
  const p = parse(s, VOICE_WIRE_PREFIX);
  return p ? {meta: p.meta, base64: p.payload} : null;
}

export function parseVoiceLocal(
  s: string,
): {meta: VoiceMeta; path: string} | null {
  const p = parse(s, VOICE_LOCAL_PREFIX);
  return p ? {meta: p.meta, path: p.payload} : null;
}

export function isVoiceContent(s: string): boolean {
  return s.startsWith(VOICE_WIRE_PREFIX) || s.startsWith(VOICE_LOCAL_PREFIX);
}

/** mm:ss for a duration in ms. */
export function formatDuration(ms: number): string {
  const total = Math.round(ms / 1000);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}
