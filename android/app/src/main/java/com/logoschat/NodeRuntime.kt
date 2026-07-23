package com.logoschat

import android.util.Log
import java.util.concurrent.Executors
import org.json.JSONObject

/**
 * Process-wide node lifecycle owner — shared by LogosChatModule (JS RPC) and
 * ChatService (foreground, JS-independent). Survives JS reloads AND module
 * re-instantiation; one node per process.
 *
 * Invariant #1 encoded here once: chat_new → set_event_callback → chat_start.
 * All lib calls run on the single "logoschat-node" executor — chat_start blocks
 * while the node boots and must never hold the JS (or main) thread.
 */
object NodeRuntime {
  private const val TAG = "logos-chat-bridge"

  /** kv keys for the service auto-restart path (#25). */
  const val KV_NODE_CONFIG = "nodeConfig"
  const val KV_AUTO_RESTART = "nodeAutoRestart"

  @Volatile var ctx: Long = 0L; private set
  @Volatile var status: String = "stopped"; private set
  private var setupDone = false

  /** Mix ("Private routing", #30): the mode this epoch was opened in. */
  @Volatile var mixEnabled: Boolean = false; private set
  /** Latest mix status JSON from chat_get_mix_status (#31), "" when unknown. */
  @Volatile var mixStatusJson: String = ""; private set
  /** Parsed pool state for the send guard (#32) — updated with every poll. */
  @Volatile var mixReady: Boolean = false; private set
  @Volatile var mixPoolSize: Int = 0; private set
  @Volatile var minMixPoolSize: Int = 4; private set

  val executor = Executors.newSingleThreadExecutor { r ->
    Thread(r, "logoschat-node").apply { isDaemon = true }
  }

  private fun setStatus(next: String, detail: String? = null) {
    status = next
    Log.i(TAG, "node_status: $next${detail?.let { " ($it)" } ?: ""}")
    EventCallbackManager.emitNodeStatus(next, detail)
    ChatService.refreshNotification()
  }

  /** Runs ON the node executor. Returns null on success, error message on failure. */
  private fun startBlocking(configJson: String): String? {
    if (ctx != 0L) return "node already started (status=$status)"
    setStatus("initializing")
    if (!setupDone) {
      NodeBridge.chatSetup() // stdout/stderr → logcat pump, once per process
      setupDone = true
    }
    val p = NodeBridge.chatNew(configJson)
    if (p.error || p.ptr == 0L || p.ptr == -1L) {
      val why = if (p.error) p.errorMessage else "chat_new returned null (config rejected)"
      setStatus("error", why)
      return why
    }
    ctx = p.ptr
    // Toggling Private routing = chat_new with mixEnabled flipped = a NEW EPOCH
    // (docs/architecture.md §4/§7): read it straight off the config we booted with.
    mixEnabled = parseMixEnabled(configJson)
    minMixPoolSize = parseMinMixPoolSize(configJson)
    mixReady = false
    mixPoolSize = 0
    mixStatusJson = ""
    // One epoch row per chat_new (docs/architecture.md §4).
    ChatRepo.onNodeStarted(mixEnabled = mixEnabled)
    NodeBridge.chatSetEventCallback(ctx) // BEFORE chat_start — invariant #1
    setStatus("starting")
    val r = NodeBridge.chatStart(ctx)
    if (r.error) {
      setStatus("error", r.message)
      NodeBridge.chatDestroy(ctx)
      ctx = 0L
      ChatRepo.onNodeStopped()
      return r.message
    }
    setStatus("running")
    return null
  }

  /** Runs ON the node executor. */
  private fun stopBlocking() {
    val c = ctx
    if (c == 0L) return
    val stop = NodeBridge.chatStop(c)
    if (stop.error) Log.w(TAG, "chat_stop error: ${stop.message}")
    val destroy = NodeBridge.chatDestroy(c)
    if (destroy.error) Log.w(TAG, "chat_destroy error: ${destroy.message}")
    ctx = 0L
    mixEnabled = false
    mixReady = false
    mixPoolSize = 0
    mixStatusJson = ""
    ChatRepo.onNodeStopped() // closes the epoch — all sessions now expired
    setStatus("stopped")
  }

  /**
   * Poll chat_get_mix_status (#31). MUST run on the node executor — the lib is
   * single-threaded per the FFI contract. Called from ChatService's native
   * ScheduledExecutor (never a JS timer — background-throttle lesson §2.1).
   * Updates the parsed pool fields (feeding the #32 send guard) and emits the
   * status to JS.
   */
  fun pollMixStatus() {
    executor.execute {
      val c = ctx
      if (c == 0L || !mixEnabled) return@execute
      val r = try {
        NodeBridge.chatGetMixStatus(c)
      } catch (t: Throwable) {
        Log.w(TAG, "chat_get_mix_status failed: ${t.message}")
        return@execute
      }
      if (r.error) {
        Log.w(TAG, "chat_get_mix_status error: ${r.message}")
        return@execute
      }
      mixStatusJson = r.message
      try {
        val j = JSONObject(r.message)
        mixReady = j.optBoolean("mixReady", false)
        mixPoolSize = j.optInt("mixPoolSize", 0)
        minMixPoolSize = j.optInt("minPoolSize", minMixPoolSize)
      } catch (_: Exception) {}
      EventCallbackManager.emitMixStatus(r.message)
    }
  }

  /** Is a mix send allowed right now? Anti-downgrade guard (#32): mix on but the
   * pool is short ⇒ NO send (never over relay). Non-mix mode always allows. */
  fun mixSendBlocked(): Boolean = mixEnabled && (!mixReady || mixPoolSize < minMixPoolSize)

  private fun parseMixEnabled(configJson: String): Boolean =
      try { JSONObject(configJson).optBoolean("mixEnabled", false) } catch (_: Exception) { false }

  private fun parseMinMixPoolSize(configJson: String): Int =
      try { JSONObject(configJson).optInt("minMixPoolSize", 4) } catch (_: Exception) { 4 }

  /** Async start; [onDone] gets null on success or the error message. */
  fun start(configJson: String, onDone: (String?) -> Unit) {
    executor.execute {
      try {
        onDone(startBlocking(configJson))
      } catch (t: Throwable) {
        setStatus("error", t.message)
        onDone(t.message ?: t.toString())
      }
    }
  }

  fun stop(onDone: (String?) -> Unit) {
    executor.execute {
      try {
        stopBlocking()
        onDone(null)
      } catch (t: Throwable) {
        setStatus("error", t.message)
        onDone(t.message ?: t.toString())
      }
    }
  }

  /**
   * ChatService START_STICKY path: the process died with the node running
   * (swipe-away / OOM) and the system restarted the service — bring the node
   * back with the last config, no JS involved. A fresh chat_new means a fresh
   * epoch: sessions expire, exactly the §4 model.
   */
  fun autoRestartIfWanted() {
    executor.execute {
      try {
        if (ctx != 0L) return@execute
        val db = ChatRepo.requireDb()
        if (db.kvGet(KV_AUTO_RESTART) != "1") return@execute
        val config = db.kvGet(KV_NODE_CONFIG) ?: return@execute
        Log.i(TAG, "service auto-restart: bringing the node back (JS-independent)")
        startBlocking(config)
      } catch (t: Throwable) {
        Log.e(TAG, "auto-restart failed", t)
      }
    }
  }
}
