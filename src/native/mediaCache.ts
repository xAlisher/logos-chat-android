// #300 — download+decrypt a store1: media blob on demand and cache the local path.
// Bubbles call useMediaBlob(ref); the first render kicks a native download+decrypt (which
// itself caches the file under cacheDir/media/<cid>), subsequent renders hit the in-memory
// map. Keyed by cid (content-addressed → immutable).
import {useEffect, useState} from 'react';
import Storage from './Storage';
import type {MediaRef} from '../messages/media';

const pathByCid = new Map<string, string>();

export type MediaState =
  | {status: 'idle'}
  | {status: 'loading'}
  | {status: 'ready'; path: string}
  | {status: 'error'};

export function useMediaBlob(ref: MediaRef | null): MediaState {
  const cid = ref?.cid ?? null;
  const [state, setState] = useState<MediaState>(() =>
    cid != null && pathByCid.has(cid)
      ? {status: 'ready', path: pathByCid.get(cid)!}
      : {status: cid != null ? 'loading' : 'idle'},
  );
  useEffect(() => {
    if (ref == null || cid == null) {
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
    Storage.downloadDecrypt(ref.cid, ref.key)
      .then(path => {
        pathByCid.set(cid, path);
        if (alive) setState({status: 'ready', path});
      })
      .catch(() => {
        if (alive) setState({status: 'error'});
      });
    return () => {
      alive = false;
    };
  }, [cid, ref?.key, ref]);
  return state;
}
