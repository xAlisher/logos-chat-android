package com.logoschat

import android.content.Context
import android.system.Os
import android.util.Log
import java.io.File
import java.security.SecureRandom
import java.util.concurrent.Executors

/**
 * Process-wide node lifecycle owner — shared by LogosChatModule (JS RPC) and
 * ChatService (foreground, JS-independent). One node per process.
 *
 * M1' address model: "starting the node" = `open_persistent` (embedded delivery
 * node + registry publish + encrypted storage + STABLE identity from a seed file).
 * "stopping" = `shutdown`. The event callback is registered right after open;
 * events arriving before that are buffered on the lib's channel (no loss window).
 *
 * All lib calls run on the single "logoschat-node" executor — open_persistent
 * blocks while the node boots and must never hold the JS (or main) thread.
 */
object NodeRuntime {
  private const val TAG = "logos-chat-bridge"

  const val KV_AUTO_RESTART = "nodeAutoRestart"
  // #219: multiaddr of our self-hosted delivery node to pin the Edge client to
  // (`/dns4/<host>/tcp/<port>/p2p/<peerId>`), instead of the flaky public fleet.
  // Empty = default fleet behaviour. Read into env before open (the Rust delivery
  // layer reads LOGOS_DELIVERY_FILTERNODE / LOGOS_DELIVERY_LIGHTPUSHNODE, threaded.rs).
  const val KV_DELIVERY_SERVICE_NODE = "deliveryServiceNode"
  private const val SECURE_PREFS = "logoschat_secure"
  private const val KEY_DB_KEY = "dbKey" // legacy plaintext (pre-#258); migrated below
  private const val KEY_DB_KEY_ENC = "dbKeyEnc" // #258: Keystore-wrapped dbKey
  private const val IDENTITY_FILE = "logoschat-identity.bin"
  private const val STORE_FILE = "logoschat-store.db"

  @Volatile var ctx: Long = 0L; private set
  @Volatile var status: String = "stopped"; private set
  @Volatile var address: String? = null; private set
  @Volatile var installationName: String? = null; private set
  private var setupDone = false
  @Volatile private var appContext: Context? = null

  val executor = Executors.newSingleThreadExecutor { r ->
    Thread(r, "logoschat-node").apply { isDaemon = true }
  }

  fun attachContext(context: Context) {
    if (appContext == null) appContext = context.applicationContext
  }

  private fun setStatus(next: String, detail: String? = null) {
    status = next
    Log.i(TAG, "node_status: $next${detail?.let { " ($it)" } ?: ""}")
    EventCallbackManager.emitNodeStatus(next, detail)
    ChatService.refreshNotification()
    val ctx = ChatService.appContext ?: appContext ?: return
    when (next) {
      "error" -> {
        val wanted = try {
          ChatRepo.requireDb().kvGet(KV_AUTO_RESTART) == "1"
        } catch (_: Throwable) { false }
        if (wanted) MessageNotifier.notifyNodeDown(ctx, detail)
      }
      "running" -> MessageNotifier.clearNodeDown(ctx)
    }
  }

  // -- secure storage --------------------------------------------------------
  //
  // The identity seed (64 bytes, account||delegate) and the encrypted-store key
  // both must be STABLE across restarts for the address + history to persist.
  // Both live in the app-private sandbox (filesDir / SharedPreferences).
  //
  // #258 Phase 1: the store key (`dbKey`) is now wrapped by a hardware Keystore key
  // (KeystoreCrypto) instead of sitting as plaintext hex — so root/forensics can't
  // read it out of SharedPreferences and decrypt the (already-encrypted) store.
  // The identity seed file is still plaintext (lib-managed; see #258 follow-up).

  private fun identityPath(context: Context): String =
      File(context.filesDir, IDENTITY_FILE).absolutePath

  private fun storePath(context: Context): String =
      File(context.filesDir, STORE_FILE).absolutePath

  /**
   * The store-encryption key, STABLE across restarts. #258: preferred form is a
   * Keystore-wrapped blob; legacy plaintext is migrated on first run and only
   * deleted after a verified unwrap round-trip (so a Keystore failure can never
   * orphan the store). Falls back to plaintext ONLY if the Keystore is unusable,
   * so the node always opens.
   */
  private fun dbKey(context: Context): String {
    val prefs = context.getSharedPreferences(SECURE_PREFS, Context.MODE_PRIVATE)

    // 1) Preferred: the Keystore-wrapped key.
    prefs.getString(KEY_DB_KEY_ENC, null)?.let { blob ->
      try {
        return KeystoreCrypto.unwrap(blob)
      } catch (t: Throwable) {
        // Only dangerous if we'd already dropped the plaintext — but we only drop
        // it after a verified round-trip (below), and Keystore keys survive
        // restarts/updates. Log and fall through to any plaintext fallback.
        Log.e(TAG, "dbKey unwrap failed: ${t.message}")
      }
    }

    // 2) Legacy plaintext (pre-#258) OR a kept fallback → migrate to Keystore.
    prefs.getString(KEY_DB_KEY, null)?.let { plain ->
      try {
        val blob = KeystoreCrypto.wrap(plain)
        if (KeystoreCrypto.unwrap(blob) == plain) {
          // Verified round-trip → safe to switch: store enc, drop plaintext.
          prefs.edit().putString(KEY_DB_KEY_ENC, blob).remove(KEY_DB_KEY).commit()
          Log.i(TAG, "dbKey migrated to Keystore-wrapped storage")
        } else {
          Log.e(TAG, "dbKey migration round-trip mismatch; keeping plaintext")
        }
      } catch (t: Throwable) {
        Log.w(TAG, "dbKey Keystore migration failed (${t.message}); keeping plaintext")
      }
      return plain
    }

    // 3) Fresh install: generate, wrap (verified), store. No plaintext persisted
    //    unless the Keystore is unusable (then plaintext so the node still opens).
    val bytes = ByteArray(32)
    SecureRandom().nextBytes(bytes)
    val hex = bytes.joinToString("") { "%02x".format(it) }
    try {
      val blob = KeystoreCrypto.wrap(hex)
      if (KeystoreCrypto.unwrap(blob) == hex) {
        prefs.edit().putString(KEY_DB_KEY_ENC, blob).commit()
        return hex
      }
      Log.e(TAG, "dbKey Keystore round-trip mismatch on create; plaintext fallback")
    } catch (t: Throwable) {
      Log.e(TAG, "dbKey Keystore wrap failed on create (${t.message}); plaintext fallback")
    }
    prefs.edit().putString(KEY_DB_KEY, hex).commit()
    return hex
  }

  // -- lifecycle (runs ON the node executor) ---------------------------------

  /**
   * #219: if a self-hosted delivery node is configured (KV), export its multiaddr as
   * the static filter + lightpush service peer so the Edge client uses it instead of
   * the public fleet. No-op when unset. Best-effort — never blocks node start.
   */
  private fun applyDeliveryPeerEnv() {
    try {
      val db = ChatRepo.requireDb()
      // Override the baked-in self-hosted node (threaded.rs DEFAULT_SERVICE_NODE).
      // Empty string forces the old preset/fleet behaviour.
      db.kvGet(KV_DELIVERY_SERVICE_NODE)?.let {
        Os.setenv("LOGOS_DELIVERY_SERVICE_NODE", it, true)
        Log.i(TAG, "delivery service node override: '${it}'")
      }
    } catch (t: Throwable) {
      Log.w(TAG, "applyDeliveryPeerEnv failed (non-fatal): ${t.message}")
    }
  }

  private fun startBlocking(): String? {
    if (ctx != 0L) {
      // #237: the node is already open — "Logos on" is a RESUME of paused Waku
      // delivery (the node/MLS engine was kept alive so BLE could still work).
      val rc = NodeBridge.chatSetDeliveryActive(ctx, true)
      if (rc != 0) {
        val why = NodeBridge.chatLastError().ifEmpty { "resume delivery failed" }
        setStatus("error", why)
        return why
      }
      setStatus("running")
      return null
    }
    val context = appContext ?: return "no app context"
    setStatus("initializing")
    // #219: pin the delivery client to our self-hosted node if configured. Set the
    // env vars the Rust delivery layer reads BEFORE opening the node (the node thread
    // inherits this process's env). Empty/unset KV → no-op → default fleet behaviour.
    applyDeliveryPeerEnv()
    if (!setupDone) {
      NodeBridge.chatSetup() // stdout/stderr -> logcat pump, once per process
      setupDone = true
    }
    setStatus("starting")
    val handle =
        NodeBridge.chatOpenPersistent(
            storePath(context), dbKey(context), null, identityPath(context))
    if (handle == 0L) {
      val why = NodeBridge.chatLastError().ifEmpty { "open_persistent returned null" }
      setStatus("error", why)
      return why
    }
    ctx = handle
    // Register the event pump BEFORE we consider ourselves running.
    NodeBridge.chatSetEventCallback(ctx)
    address = NodeBridge.chatGetAddress(ctx)
    installationName = NodeBridge.chatInstallationName(ctx)
    Log.i(TAG, "node up: address=${address ?: "?"} installation=${installationName ?: "?"}")
    setStatus("running")
    return null
  }

  /** Real teardown — frees the ctx. Used by the wipe/reset flow only. */
  private fun stopBlocking() {
    val c = ctx
    if (c == 0L) return
    NodeBridge.chatShutdown(c)
    ctx = 0L
    address = null
    installationName = null
    setStatus("stopped")
  }

  /**
   * #237: PAUSE Waku delivery for the "Logos off" toggle — stops filter/lightpush +
   * subscriptions but KEEPS the node (and its MLS engine) alive so BLE messaging
   * (encryptForConvo/ingestCiphertext) keeps working offline. The stable address
   * stays valid (node is up), so the QR/identity is unaffected.
   */
  private fun pauseBlocking() {
    val c = ctx
    if (c == 0L) return
    val rc = NodeBridge.chatSetDeliveryActive(c, false)
    if (rc != 0) Log.w(TAG, "pause delivery failed: ${NodeBridge.chatLastError()}")
    setStatus("stopped")
  }

  // -- async entry points ----------------------------------------------------

  fun start(onDone: (String?) -> Unit) {
    executor.execute {
      try {
        onDone(startBlocking())
      } catch (t: Throwable) {
        setStatus("error", t.message)
        onDone(t.message ?: t.toString())
      }
    }
  }

  fun stop(onDone: (String?) -> Unit) {
    executor.execute {
      try {
        // #237: the "Logos off" toggle pauses delivery (keeps the engine); it does
        // NOT tear the node down. Real teardown is stopBlocking (wipe flow only).
        pauseBlocking()
        onDone(null)
      } catch (t: Throwable) {
        setStatus("error", t.message)
        onDone(t.message ?: t.toString())
      }
    }
  }

  // -- destructive wipe / identity reset (#232) ------------------------------

  private fun deleteWithSiblings(base: File) {
    // SQLite/rusqlite leaves -wal/-shm (WAL mode) or -journal beside the db file;
    // delete them all so no fragment of the old encrypted store survives.
    for (suffix in listOf("", "-wal", "-shm", "-journal")) {
      val f = File(base.parentFile, base.name + suffix)
      if (f.exists() && !f.delete()) Log.w(TAG, "wipe: could not delete ${f.name}")
    }
  }

  private fun deleteRecursively(f: File) {
    if (!f.exists()) return
    if (f.isDirectory) f.listFiles()?.forEach { deleteRecursively(it) }
    if (!f.delete()) Log.w(TAG, "wipe: could not delete ${f.absolutePath}")
  }

  /**
   * #232 — reset identity and data. Runs ON the node executor (serialized with
   * every other lib call). Steps, in order:
   *   1. shut the node down (frees the ctx),
   *   2. delete the identity seed (→ a NEW stable address is generated on reopen)
   *      and the lib's encrypted store, plus clear the store key so a fresh key is
   *      minted,
   *   3. wipe the app-side ChatDb (all chats/groups/mesh pairings + kv/PIN) and
   *      the stored chat images,
   *   4. re-open the node → a brand-new identity + empty history.
   *
   * This is the SAME primitive behind "Reset identity and data", the duress/wipe
   * PIN, and the 3-wrong-attempts "Create new identity" — all app-level, NO native
   * Rust verb (we just delete the files the lib opens and re-open it).
   */
  fun wipeAndRestart(onDone: (String?) -> Unit) {
    executor.execute {
      try {
        val context = appContext
        if (context == null) {
          onDone("no app context")
          return@execute
        }
        stopBlocking()
        deleteWithSiblings(File(context.filesDir, IDENTITY_FILE))
        deleteWithSiblings(File(context.filesDir, STORE_FILE))
        context
            .getSharedPreferences(SECURE_PREFS, Context.MODE_PRIVATE)
            .edit()
            .remove(KEY_DB_KEY)
            .commit()
        // Chat images (#197) live outside the DB — clear them too.
        deleteRecursively(File(context.filesDir, "chat-images"))
        ChatRepo.wipeAndReinit(context)
        Log.i(TAG, "identity + data wiped; reopening with a fresh identity")
        val err = startBlocking()
        onDone(err)
      } catch (t: Throwable) {
        setStatus("error", t.message)
        onDone(t.message ?: t.toString())
      }
    }
  }

  /**
   * ChatService START_STICKY path: the process died with the node running and the
   * system restarted the service — bring the node back, no JS involved. The
   * identity seed + store persist, so the SAME address returns.
   */
  fun autoRestartIfWanted() {
    executor.execute {
      try {
        if (ctx != 0L) return@execute
        val db = ChatRepo.requireDb()
        if (db.kvGet(KV_AUTO_RESTART) != "1") return@execute
        Log.i(TAG, "service auto-restart: bringing the node back (JS-independent)")
        startBlocking()
      } catch (t: Throwable) {
        Log.e(TAG, "auto-restart failed", t)
      }
    }
  }
}
