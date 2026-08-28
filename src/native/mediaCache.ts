// #300 — download+decrypt a store1: media blob on demand and cache the local path.
// Bubbles call useMediaBlob(ref); the first request kicks a native download+decrypt (which
// itself caches the file under cacheDir/media/<cid>), and the result path is memoised.
//
// #309 (OOM fix): downloadDecrypt loads the whole decrypted file into the Java heap
// (AES-GCM buffers the entire plaintext until the tag verifies). The old hook depended on
// the `ref` OBJECT — recreated every render — so every re-render re-fired a fresh concurrent
// downloadDecrypt for the SAME cid; during playback (many re-renders) that stacked N full-file
// copies and blew the 256MB heap. Now: keyed by cid (content-addressed → immutable), a single
// in-flight promise is SHARED across all callers/renders, and distinct downloads are throttled
// so a timeline full of videos can't decrypt them all at once.
import {useCallback, useEffect, useState} from 'react';
import Storage from './Storage';
import type {MediaRef} from '../messages/media';

const pathByCid = new Map<string, string>();
const inflight = new Map<string, Promise<string>>();

// Throttle concurrent (distinct-cid) decrypts — each holds a full file in the heap.
const MAX_CONCURRENT = 2;
/** 120 s at the app's 24 kbps AAC rate is ~360 KiB; 2 MiB leaves ample codec overhead. */
export const MAX_HOSTED_AUDIO_CIPHERTEXT_BYTES = 2 * 1024 * 1024;
const MAX_GENERAL_CIPHERTEXT_BYTES = 100 * 1024 * 1024;
export const maxCiphertextBytesForMime = (mime: string): number =>
  mime.startsWith('audio/')
    ? MAX_HOSTED_AUDIO_CIPHERTEXT_BYTES
    : MAX_GENERAL_CIPHERTEXT_BYTES;
let active = 0;
const queue: Array<() => void> = [];
function acquire(): Promise<void> {
  if (active < MAX_CONCURRENT) {
    active++;
    return Promise.resolve();
  }
  return new Promise(resolve => queue.push(resolve));
}
function release() {
  active--;
  const next = queue.shift();
  if (next) {
    active++;
    next();
  }
}

/** One shared download+decrypt per cid, cached and throttled. */
function fetchBlob(
  cid: string,
  key: string,
  cap: string,
  padded: boolean,
  mime: string,
): Promise<string> {
  const maxBytes = maxCiphertextBytesForMime(mime);
  const cacheKey = `${cid}:${maxBytes}`;
  const cached = pathByCid.get(cacheKey);
  if (cached != null) return Promise.resolve(cached);
  const existing = inflight.get(cacheKey);
  if (existing != null) return existing;
  const p = acquire()
    .then(() => Storage.downloadDecrypt(cid, key, cap, padded, maxBytes))
    .then(path => {
      pathByCid.set(cacheKey, path);
      return path;
    })
    .finally(() => {
      inflight.delete(cacheKey);
      release();
    });
  inflight.set(cacheKey, p);
  return p;
}

export type MediaState =
  | {status: 'idle'}
  | {status: 'loading'}
  | {status: 'ready'; path: string}
  | {status: 'error'; retry: () => void}
  // #303: the blob was evicted by node retention (a 404 on GET) → show an honest placeholder.
  | {status: 'expired'};

export function useMediaBlob(ref: MediaRef | null): MediaState {
  const cid = ref?.cid ?? null;
  const key = ref?.key ?? null;
  const cap = ref?.cap ?? ''; // #302: legacy markers have none → "" (proxy 403s → placeholder)
  const padded = ref?.padded ?? false; // #320: store2 blobs are size-padded → strip on decrypt
  const mime = ref?.mime ?? '';
  const maxBytes = maxCiphertextBytesForMime(mime);
  const cacheKey = cid == null ? null : `${cid}:${maxBytes}`;
  const [attempt, setAttempt] = useState(0);
  const retry = useCallback(() => setAttempt(value => value + 1), []);
  const [state, setState] = useState<MediaState>(() =>
    cacheKey != null && pathByCid.has(cacheKey)
      ? {status: 'ready', path: pathByCid.get(cacheKey)!}
      : {status: cid != null ? 'loading' : 'idle'},
  );
  useEffect(() => {
    if (cid == null || key == null) {
      setState({status: 'idle'});
      return;
    }
    const cached = pathByCid.get(`${cid}:${maxBytes}`);
    if (cached != null) {
      setState({status: 'ready', path: cached});
      return;
    }
    let alive = true;
    setState({status: 'loading'});
    fetchBlob(cid, key, cap, padded, mime)
      .then(path => {
        if (alive) setState({status: 'ready', path});
      })
      .catch((e: unknown) => {
        if (!alive) return;
        // #303: a 404 means the node evicted the blob (retention) → "expired", not a failure.
        const expired = /\b404\b/.test(String((e as {message?: string})?.message ?? e));
        setState(expired ? {status: 'expired'} : {status: 'error', retry});
      });
    return () => {
      alive = false;
    };
    // Primitives only — NOT the `ref` object (which is new each render → re-fire storm).
  }, [cid, key, cap, padded, mime, maxBytes, attempt, retry]);
  return state;
}
