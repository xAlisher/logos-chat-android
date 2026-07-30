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
import {useEffect, useState} from 'react';
import Storage from './Storage';
import type {MediaRef} from '../messages/media';

const pathByCid = new Map<string, string>();
const inflight = new Map<string, Promise<string>>();

// Throttle concurrent (distinct-cid) decrypts — each holds a full file in the heap.
const MAX_CONCURRENT = 2;
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
function fetchBlob(cid: string, key: string): Promise<string> {
  const cached = pathByCid.get(cid);
  if (cached != null) return Promise.resolve(cached);
  const existing = inflight.get(cid);
  if (existing != null) return existing;
  const p = acquire()
    .then(() => Storage.downloadDecrypt(cid, key))
    .then(path => {
      pathByCid.set(cid, path);
      return path;
    })
    .finally(() => {
      inflight.delete(cid);
      release();
    });
  inflight.set(cid, p);
  return p;
}

export type MediaState =
  | {status: 'idle'}
  | {status: 'loading'}
  | {status: 'ready'; path: string}
  | {status: 'error'}
  // #303: the blob was evicted by node retention (a 404 on GET) → show an honest placeholder.
  | {status: 'expired'};

export function useMediaBlob(ref: MediaRef | null): MediaState {
  const cid = ref?.cid ?? null;
  const key = ref?.key ?? null;
  const [state, setState] = useState<MediaState>(() =>
    cid != null && pathByCid.has(cid)
      ? {status: 'ready', path: pathByCid.get(cid)!}
      : {status: cid != null ? 'loading' : 'idle'},
  );
  useEffect(() => {
    if (cid == null || key == null) {
      setState({status: 'idle'});
      return;
    }
    const cached = pathByCid.get(cid);
    if (cached != null) {
      setState({status: 'ready', path: cached});
      return;
    }
    let alive = true;
    setState({status: 'loading'});
    fetchBlob(cid, key)
      .then(path => {
        if (alive) setState({status: 'ready', path});
      })
      .catch((e: unknown) => {
        if (!alive) return;
        // #303: a 404 means the node evicted the blob (retention) → "expired", not a failure.
        const expired = /\b404\b/.test(String((e as {message?: string})?.message ?? e));
        setState({status: expired ? 'expired' : 'error'});
      });
    return () => {
      alive = false;
    };
    // Primitives only — NOT the `ref` object (which is new each render → re-fire storm).
  }, [cid, key]);
  return state;
}
