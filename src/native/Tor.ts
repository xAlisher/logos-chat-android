// #318 (metadata privacy): thin JS wrapper over the native `Tor` module (TorModule.kt),
// an embedded in-process Tor (kmp-tor) used to route media upload/download so the storage
// node sees a Tor exit IP, not the user's real IP.
//
//   start()        -> boots the daemon; resolves with the local SOCKS port once the
//                     listener binds (early — bootstrap to 100% continues after).
//   stop()         -> shuts the daemon down (user cancelled / disabled the toggle).
//   getSocksPort() -> the live SOCKS port (0 until ready).
//
// Bootstrap progress arrives as global DeviceEventEmitter events (the native side emits
// via RCTDeviceEventEmitter, so we listen on DeviceEventEmitter, NOT a per-module
// NativeEventEmitter — that would demand addListener/removeListeners stubs):
//   'torBootstrap' {percent}  — 0..100 as tor connects to the network / builds circuits
//   'torSocks'     {port}     — the SOCKS listener came up on this port
import {DeviceEventEmitter, NativeModules} from 'react-native';

interface TorNative {
  start(): Promise<number>;
  stop(): void;
  getSocksPort(): Promise<number>;
  /**
   * #319: start a local TCP→SOCKS relay for the delivery path. Requires Tor running.
   * Point the delivery service node at /ip4/127.0.0.1/tcp/<localPort>/p2p/<same peerId>
   * so the node dials the relay → Tor → the real node (which sees a Tor exit IP).
   */
  startDeliveryRelay(host: string, port: number, localPort: number): Promise<number>;
  stopDeliveryRelay(): void;
}

const Tor = NativeModules.Tor as TorNative;

/** Subscribe to bootstrap progress (0..100). Returns an unsubscribe fn. */
export function onTorBootstrap(cb: (percent: number) => void): () => void {
  const sub = DeviceEventEmitter.addListener('torBootstrap', (e: {percent: number}) =>
    cb(e?.percent ?? 0),
  );
  return () => sub.remove();
}

/** Subscribe to the SOCKS listener coming up. Returns an unsubscribe fn. */
export function onTorSocks(cb: (port: number) => void): () => void {
  const sub = DeviceEventEmitter.addListener('torSocks', (e: {port: number}) =>
    cb(e?.port ?? 0),
  );
  return () => sub.remove();
}

export default Tor;
