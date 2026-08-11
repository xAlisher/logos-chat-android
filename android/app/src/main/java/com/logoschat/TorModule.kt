package com.logoschat

import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.WritableMap
import com.facebook.react.modules.core.DeviceEventManagerModule
import io.matthewnelson.kmp.file.toFile
import io.matthewnelson.kmp.tor.resource.exec.tor.ResourceLoaderTorExec
import io.matthewnelson.kmp.tor.runtime.Action
import io.matthewnelson.kmp.tor.runtime.RuntimeEvent
import io.matthewnelson.kmp.tor.runtime.TorRuntime
import io.matthewnelson.kmp.tor.runtime.core.OnEvent
import io.matthewnelson.kmp.tor.runtime.core.TorEvent
import io.matthewnelson.kmp.tor.runtime.core.config.TorOption

/**
 * #318 (metadata privacy): an embedded Tor (kmp-tor, in-process) used to route media
 * upload/download so the storage node sees a Tor exit IP, not the user's real IP.
 *   - start(): boot the daemon; emits `torBootstrap` {percent} as it bootstraps and
 *     `torSocks` {port} once the SOCKS listener is up.
 *   - stop(): shut the daemon down (user cancelled / disabled the toggle).
 *   - getSocksPort(): the live SOCKS port (0 until ready).
 * The JS "Starting Tor…" modal watches torBootstrap; at 100% it wires StorageModule to the
 * SOCKS port. In-process (no foreground service) — fine for on-demand media while foregrounded.
 */
class TorModule(private val ctx: ReactApplicationContext) :
    ReactContextBaseJavaModule(ctx) {

  override fun getName() = "Tor"

  @Volatile private var runtime: TorRuntime? = null
  @Volatile private var socksPort = 0
  @Volatile private var relay: TorSocksRelay? = null

  private fun emit(name: String, data: WritableMap) {
    try {
      ctx.getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java).emit(name, data)
    } catch (_: Throwable) {}
  }

  private val bootstrapRe = Regex("Bootstrapped (\\d+)%")

  private fun ensureRuntime(): TorRuntime {
    runtime?.let { return it }
    val work = java.io.File(ctx.filesDir, "tor").apply { mkdirs() }
    val cache = java.io.File(ctx.cacheDir, "tor").apply { mkdirs() }
    val env = TorRuntime.Environment.Builder(
        work.absolutePath.toFile(),
        cache.absolutePath.toFile(),
        ResourceLoaderTorExec::getOrCreate,
    ) {}
    val rt = TorRuntime.Builder(env) {
      config {
        TorOption.__SocksPort.configure { auto() }
      }
      // SOCKS listener address → port for StorageModule.
      observerStatic(RuntimeEvent.LISTENERS, OnEvent.Executor.Immediate) { listeners ->
        val p = listeners.socks.firstOrNull()?.port?.value ?: 0
        socksPort = p
        if (p > 0) emit("torSocks", Arguments.createMap().apply { putInt("port", p) })
      }
      // Bootstrap progress from tor's NOTICE lines ("Bootstrapped N% ...").
      required(TorEvent.NOTICE)
      observerStatic(TorEvent.NOTICE, OnEvent.Executor.Immediate) { line ->
        val m = bootstrapRe.find(line)
        if (m != null) {
          emit("torBootstrap", Arguments.createMap().apply {
            putInt("percent", m.groupValues[1].toIntOrNull() ?: 0)
          })
        }
      }
    }
    runtime = rt
    return rt
  }

  @ReactMethod
  fun start(promise: Promise) {
    try {
      val rt = ensureRuntime()
      rt.enqueue(
          Action.StartDaemon,
          { t -> promise.reject("tor_start", t.message, t) },
          { _ -> promise.resolve(socksPort) },
      )
    } catch (t: Throwable) {
      promise.reject("tor_start", t.message, t)
    }
  }

  @ReactMethod
  fun stop() {
    runtime?.enqueue(Action.StopDaemon, {}, {})
    socksPort = 0
    relay?.stop()
    relay = null
    TorState.deliveryRelayLive = false // #GHSA-jj3m: relay no longer live this process
  }

  @ReactMethod
  fun getSocksPort(promise: Promise) {
    promise.resolve(socksPort)
  }

  /**
   * #319: start a local TCP→SOCKS relay for the DELIVERY path. Requires Tor already
   * running (SOCKS listener up). Resolves the loopback port the caller should point the
   * delivery service node at (/ip4/127.0.0.1/tcp/<port>/p2p/<same peerId>).
   */
  @ReactMethod
  fun startDeliveryRelay(host: String, port: Int, localPort: Int, promise: Promise) {
    try {
      if (socksPort <= 0) {
        promise.reject("tor_relay", "tor not running (no SOCKS port)")
        return
      }
      relay?.stop()
      val r = TorSocksRelay(socksPort, host, port, localPort)
      val bound = r.start()
      relay = r
      // #GHSA-jj3m: mark THIS process's delivery relay live so the node's
      // fail-closed cold-start gate can tell it from a stale KV multiaddr.
      TorState.deliveryRelayLive = true
      promise.resolve(bound)
    } catch (t: Throwable) {
      promise.reject("tor_relay", t.message, t)
    }
  }

  @ReactMethod
  fun stopDeliveryRelay() {
    relay?.stop()
    relay = null
    TorState.deliveryRelayLive = false // #GHSA-jj3m
  }
}
