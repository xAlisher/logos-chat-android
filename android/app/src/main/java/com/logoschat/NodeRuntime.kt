package com.logoschat

import android.content.Context
import android.system.Os
import android.util.Base64
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
  // #319: when Private mode (Tor) is on, a loopback multiaddr pointing at the local
  // TCP→SOCKS relay (/ip4/127.0.0.1/tcp/<port>/p2p/<realPeerId>). Set by settingsStore
  // only after the relay is up. Takes precedence over the direct node so delivery
  // libp2p egresses via a Tor exit. Empty = route delivery directly.
  const val KV_DELIVERY_RELAY_NODE = "deliveryRelayNode"
  // #GHSA-jj3m: the persisted Private-mode master flag (settingsStore.mediaOverTor).
  // "true" means the user opted into routing over Tor — so the device-bundle publish
  // inside open_persistent must NOT egress before the Tor relay exists.
  const val KV_MEDIA_OVER_TOR = "mediaOverTor"
  // #490: the reject reason when a wipe reopened the node but could not delete every
  // file — the caller must be able to tell a partial wipe from a clean one.
  const val WIPE_INCOMPLETE = "wipe_incomplete"
  // #GHSA-jj3m: how long a cold start waits for the (JS-driven) Tor bootstrap to
  // write the relay multiaddr before failing closed. The node executor has nothing
  // else to do on a cold start, so a bounded block here is safe; on timeout we
  // return without opening (no direct publish) and the next start retries.
  private const val PRIVATE_MODE_TOR_WAIT_MS = 60_000L
  internal const val SECURE_PREFS = "logoschat_secure" // internal: NodeRuntimeDbKeyTest (#358)
  internal const val KEY_DB_KEY = "dbKey" // legacy plaintext (pre-#258); migrated below
  internal const val KEY_DB_KEY_ENC = "dbKeyEnc" // #258: Keystore-wrapped dbKey
  private const val IDENTITY_FILE = "logoschat-identity.bin"
  // #258: the identity seed encrypted at rest (Keystore-wrapped). The plaintext
  // IDENTITY_FILE exists only transiently, while the node is opening.
  private const val IDENTITY_ENC_FILE = "logoschat-identity.enc"
  private const val STORE_FILE = "logoschat-store.db"

  /**
   * #443 (review): marks the one restore outcome that is neither success nor failure —
   * the wipe happened, the identity/address came back, but the chat history did not.
   * [importAndRestart] prefixes its error with this so the bridge can reject with a
   * distinct code and the UI can say what actually survived instead of "Restored".
   */
  const val PARTIAL_RESTORE_PREFIX = "identity restored, but the chat history was not: "

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
   * orphan the store). Falls back to plaintext ONLY if the Keystore is unusable
   * on a fresh key, so the node always opens.
   *
   * #358 — FAIL CLOSED on an existing wrapped key: if a Keystore-wrapped key
   * already exists (the store is encrypted with it) but can't be unwrapped, THROW
   * rather than falling through to regenerate/return a fresh key — a fresh key
   * would orphan the encrypted store (and creating a new plaintext one beside it
   * is the leak). First-run creation is unchanged.
   */
  // #358: `internal` (not private) so the fail-closed fresh-key path is unit-testable
  // (NodeRuntimeDbKeyTest). See the fresh-key branch (case 3) below.
  internal fun dbKey(context: Context): String {
    val prefs = context.getSharedPreferences(SECURE_PREFS, Context.MODE_PRIVATE)

    // 1) Preferred: the Keystore-wrapped key. If it exists, the store is encrypted
    //    with it — an unwrap failure MUST fail closed (never re-key an existing store).
    prefs.getString(KEY_DB_KEY_ENC, null)?.let { blob ->
      try {
        return KeystoreCrypto.unwrap(blob)
      } catch (t: Throwable) {
        Log.e(TAG, "dbKey unwrap failed: ${t.message}; refusing to re-key the existing encrypted store")
        // TODO(#358): needs a user-facing 'secure storage unavailable' screen instead of a crash
        throw IllegalStateException(
            "secure storage unavailable — refusing to re-key the existing encrypted store", t)
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

    // 3) Fresh install: generate, wrap (verified), store. #358 P0 — FAIL CLOSED: if the
    //    Keystore is unusable we THROW rather than persisting a plaintext store key beside
    //    the (about-to-be) encrypted store. That plaintext fallback key was the leak.
    val bytes = ByteArray(32)
    SecureRandom().nextBytes(bytes)
    val hex = bytes.joinToString("") { "%02x".format(it) }
    try {
      val blob = KeystoreCrypto.wrap(hex)
      if (KeystoreCrypto.unwrap(blob) == hex) {
        prefs.edit().putString(KEY_DB_KEY_ENC, blob).commit()
        return hex
      }
      Log.e(TAG, "dbKey Keystore round-trip mismatch on create; refusing plaintext fallback")
    } catch (t: Throwable) {
      Log.e(TAG, "dbKey Keystore wrap failed on create (${t.message}); refusing plaintext fallback")
      // TODO(#358): needs a user-facing 'secure storage unavailable' screen instead of a crash
      throw IllegalStateException(
          "secure storage unavailable — refusing to persist a plaintext store key", t)
    }
    // Round-trip mismatch (no exception) → also fail closed; never persist plaintext.
    // TODO(#358): needs a user-facing 'secure storage unavailable' screen instead of a crash
    throw IllegalStateException(
        "secure storage unavailable — store key round-trip mismatch on create")
  }

  // #258: decrypt the sealed identity to the plaintext path the wrapper reads at
  // open. No-op on a fresh install (the wrapper then generates + writes the seed,
  // which sealIdentity encrypts right after). Best-effort: on failure we leave any
  // existing plaintext in place so the node can still open.
  private fun prepareIdentity(context: Context) {
    val enc = File(context.filesDir, IDENTITY_ENC_FILE)
    if (!enc.exists()) return
    try {
      val b64 = KeystoreCrypto.unwrap(enc.readText())
      File(identityPath(context)).writeBytes(Base64.decode(b64, Base64.NO_WRAP))
    } catch (t: Throwable) {
      Log.e(TAG, "prepareIdentity failed: ${t.message}")
    }
  }

  // #258: encrypt the plaintext identity seed at rest and remove the plaintext, so
  // a powered-off device holds only the Keystore-wrapped copy. Only deletes the
  // plaintext after a verified wrap round-trip. Best-effort: on failure we keep the
  // plaintext (no worse than pre-#258).
  private fun sealIdentity(context: Context) {
    val plain = File(identityPath(context))
    if (!plain.exists()) return
    try {
      val b64 = Base64.encodeToString(plain.readBytes(), Base64.NO_WRAP)
      val blob = KeystoreCrypto.wrap(b64)
      if (KeystoreCrypto.unwrap(blob) == b64) {
        File(context.filesDir, IDENTITY_ENC_FILE).writeText(blob)
        plain.delete()
      } else {
        Log.e(TAG, "sealIdentity round-trip mismatch; keeping plaintext")
      }
    } catch (t: Throwable) {
      Log.w(TAG, "sealIdentity failed (${t.message}); keeping plaintext")
    }
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
      // #319: Private mode routes delivery through the local Tor relay — its loopback
      // multiaddr (set only once the relay is up) wins over the direct node so libp2p
      // egresses via a Tor exit. Falls back to the custom node, then the baked-in default.
      // #GHSA-jj3m: the relay only wins when it is LIVE in this process. The multiaddr
      // persists in KV but the loopback listener dies with the process, so exporting a
      // stale value would point the delivery client at a dead port and silently break
      // delivery. (Erasing the KV on open covered this, but raced enableTor's one-shot
      // write — Senti P2 on #498. Checking liveness here needs no write at all.)
      val relayAddr = db.kvGet(KV_DELIVERY_RELAY_NODE)
      val direct = db.kvGet(KV_DELIVERY_SERVICE_NODE)
      val viaRelay = TorRelayGate.relayUsable(TorState.deliveryRelayLive, relayAddr)
      val node = TorRelayGate.deliveryNode(TorState.deliveryRelayLive, relayAddr, direct)
      if (node != null) {
        Os.setenv("LOGOS_DELIVERY_SERVICE_NODE", node, true)
        // #360: the node multiaddr (host/IP + peerId) is network-metadata — only log it
        // in DEBUG; in release just note that a custom/relay node is in use.
        if (BuildConfig.DEBUG)
            Log.i(TAG, "delivery service node: '${node}'${if (viaRelay) " (Tor relay)" else ""}")
        else Log.i(TAG, "delivery service node set${if (viaRelay) " (Tor relay)" else ""}")
      }
    } catch (t: Throwable) {
      Log.w(TAG, "applyDeliveryPeerEnv failed (non-fatal): ${t.message}")
    }
  }

  /** #GHSA-jj3m: was Private mode (Tor) opted into? Persisted by settingsStore. */
  private fun privateModeEnabled(): Boolean =
      try {
        ChatRepo.requireDb().kvGet(KV_MEDIA_OVER_TOR) == "true"
      } catch (t: Throwable) {
        false // DB not ready → treat as not-private; the caller only gates when true
      }

  /**
   * #GHSA-jj3m: is a LIVE, current-process Tor delivery relay available? Requires
   * both the in-memory [TorState.deliveryRelayLive] flag (true only once THIS
   * process's relay is standing — false at process start, so a stale KV value can
   * never satisfy it) AND the relay multiaddr in KV that applyDeliveryPeerEnv needs
   * to point the delivery client at. Keying on the in-memory flag is why we no
   * longer clear the KV (which raced enableTor's one-shot write — Senti P2 on #498).
   */
  private fun torRelayReady(): Boolean =
      TorRelayGate.relayUsable(TorState.deliveryRelayLive, relayMultiaddr())

  /** #GHSA-jj3m: the relay multiaddr the JS Tor bootstrap publishes, if any. */
  private fun relayMultiaddr(): String? =
      try {
        ChatRepo.requireDb().kvGet(KV_DELIVERY_RELAY_NODE)
      } catch (t: Throwable) {
        null
      }

  /**
   * #GHSA-jj3m: block until the Tor relay multiaddr appears, up to [timeoutMs].
   * Returns true if the relay is ready (safe to publish over Tor), false on timeout
   * (caller must fail closed and NOT open — publishing now would leak the real IP).
   * Runs on the node executor, so a bounded sleep-poll is acceptable.
   */
  private fun awaitTorRelay(timeoutMs: Long): Boolean {
    val deadline = System.nanoTime() + timeoutMs * 1_000_000L
    while (System.nanoTime() < deadline) {
      if (torRelayReady()) return true
      try {
        Thread.sleep(500)
      } catch (ie: InterruptedException) {
        Thread.currentThread().interrupt()
        return torRelayReady()
      }
    }
    return torRelayReady()
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
    // #GHSA-jj3m: fail CLOSED in Private mode. open_persistent publishes this
    // device's bundle to the registry as part of coming up; on a cold start the
    // (JS-driven) Tor bootstrap may not have written the relay multiaddr yet, so
    // publishing now would join the real IP to a stable identity. When Private
    // mode is on and the relay isn't ready, wait for it; if it never arrives, do
    // NOT open — return so the node stays down (no direct publish) and the next
    // start retries once Tor is up. When Private mode is off, this is a no-op.
    if (privateModeEnabled() && !torRelayReady()) {
      setStatus("initializing", "Private mode: waiting for Tor before connecting")
      if (!awaitTorRelay(PRIVATE_MODE_TOR_WAIT_MS)) {
        setStatus("error", "Private mode: waiting for Tor — not publishing over a direct connection")
        return "waiting for Tor"
      }
    }
    // #219: pin the delivery client to our self-hosted node if configured. Set the
    // env vars the Rust delivery layer reads BEFORE opening the node (the node thread
    // inherits this process's env). Empty/unset KV → no-op → default fleet behaviour.
    applyDeliveryPeerEnv()
    if (!setupDone) {
      // #360: in release, cap the Rust lib's log level so info-level lines (which can
      // carry message content / addresses) don't reach logcat. overwrite=false respects
      // an explicitly-set RUST_LOG; DEBUG keeps full verbosity. NOTE: efficacy depends on
      // the Rust side reading RUST_LOG at chatSetup init (not at .so load) — the proper
      // fix is defaulting RUST_LOG=warn in the wrapper's release build (see report).
      if (!BuildConfig.DEBUG) {
        try {
          Os.setenv("RUST_LOG", "warn", false)
        } catch (t: Throwable) {
          Log.w(TAG, "could not set RUST_LOG (non-fatal): ${t.message}")
        }
      }
      NodeBridge.chatSetup() // stdout/stderr -> logcat pump, once per process
      setupDone = true
    }
    setStatus("starting")
    prepareIdentity(context) // #258: decrypt the sealed seed to the path the wrapper reads
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
    sealIdentity(context) // #258: encrypt the seed at rest, drop the plaintext
    // #360: our own address + installation name are identity PII — only log in DEBUG.
    if (BuildConfig.DEBUG)
        Log.i(TAG, "node up: address=${address ?: "?"} installation=${installationName ?: "?"}")
    else Log.i(TAG, "node up")
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

  /**
   * #292: force an immediate store catch-up on all active topics. Called on app
   * foreground so messages/reactions that arrived while the node was frozen surface at
   * once instead of on the next periodic (~20s) pull. Best-effort + non-fatal; a no-op
   * when the node isn't open or delivery is paused (the native side gates it).
   */
  /** #383: returns true on a successful store pull, false otherwise, so the caller can back off. */
  fun catchupNow(): Boolean {
    val c = ctx
    if (c == 0L) return false
    return try {
      val rc = NodeBridge.chatCatchupNow(c)
      if (rc != 0) Log.w(TAG, "catchupNow failed: ${NodeBridge.chatLastError()}")
      rc == 0
    } catch (t: Throwable) {
      Log.w(TAG, "catchupNow threw (non-fatal): ${t.message}")
      false
    }
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

  /**
   * #517 path 2: re-open the node so the Private-mode delivery gate in [startBlocking]
   * re-applies. Toggling Private mode on an ALREADY-RUNNING node otherwise never re-routes
   * ongoing delivery egress — startBlocking's resume branch (`ctx != 0`) returns before the
   * gate, so only a cold open applies the routing. A full teardown + cold reopen is the only
   * path that runs the gate; the identity/address are unchanged (same seed on disk), and if
   * Private mode is on but Tor isn't ready the reopen fails CLOSED (delivery down, not direct).
   * No-op when the node isn't open — the next open applies the gate itself.
   */
  fun reopenForRouting(onDone: (String?) -> Unit) {
    executor.execute {
      try {
        if (ctx == 0L) { onDone(null); return@execute } // not open → nothing to re-route
        stopBlocking()
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

  // #490: return whether the delete FULLY succeeded. A wipe whose whole value is
  // "the data is gone" must be able to tell success from partial failure — a
  // swallowed delete used to let a partial wipe report clean success.
  private fun deleteWithSiblings(base: File): Boolean {
    // SQLite/rusqlite leaves -wal/-shm (WAL mode) or -journal beside the db file;
    // delete them all so no fragment of the old encrypted store survives.
    var ok = true
    for (suffix in listOf("", "-wal", "-shm", "-journal")) {
      val f = File(base.parentFile, base.name + suffix)
      if (f.exists() && !f.delete()) {
        Log.w(TAG, "wipe: could not delete ${f.name}")
        ok = false
      }
    }
    return ok
  }

  private fun deleteRecursively(f: File): Boolean {
    if (!f.exists()) return true
    var ok = true
    if (f.isDirectory) {
      // #490: null = an I/O error listing the dir, NOT an empty dir — treat as failure
      // (else `?.forEach` silently skips every child and the dir "wipe" is a no-op).
      val kids = f.listFiles() ?: return false
      kids.forEach { if (!deleteRecursively(it)) ok = false }
    }
    if (!f.delete()) {
      Log.w(TAG, "wipe: could not delete ${f.absolutePath}")
      ok = false
    }
    return ok
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
        // #490: accumulate every delete result — a partial wipe must NOT report clean
        // success. `&&` order matters: keep calling all deletes (don't short-circuit),
        // so we remove as much as possible even when one fails.
        var wipeOk = true
        wipeOk = deleteWithSiblings(File(context.filesDir, IDENTITY_FILE)) && wipeOk
        wipeOk = deleteWithSiblings(File(context.filesDir, IDENTITY_ENC_FILE)) && wipeOk // #258 sealed seed
        wipeOk = deleteWithSiblings(File(context.filesDir, STORE_FILE)) && wipeOk
        // #258: drop ALL wrapped crypto material (dbKey + dbKeyEnc + ChatDb key +
        // migration flag) so the fresh identity starts with fresh keys. #490: commit()
        // returns whether it persisted — a discarded false left stale keys silently.
        val prefsOk = context
            .getSharedPreferences(SECURE_PREFS, Context.MODE_PRIVATE)
            .edit()
            .clear()
            .commit()
        wipeOk = wipeOk && prefsOk
        // Chat images (#197) live outside the DB — clear them too.
        wipeOk = deleteRecursively(File(context.filesDir, "chat-images")) && wipeOk
        // #492 (Senti review): the databases/ sweep can fail too — a surviving
        // `.migbak` is an UNENCRYPTED copy of the chat history. Fold its result in, or
        // the reset reports clean success with the plaintext history still on disk.
        wipeOk = ChatRepo.wipeAndReinit(context) && wipeOk
        Log.i(TAG, "identity + data wiped (complete=$wipeOk); reopening with a fresh identity")
        val err = startBlocking()
        // #490: the node still reopens above (a partial wipe must not brick the app),
        // but surface the partial failure so the caller can react honestly — the
        // user-initiated Reset shows "Reset failed"; the covert duress path swallows it
        // but a real failure is no longer disguised as a clean wipe. A node-open error
        // takes precedence (it's the more actionable one).
        onDone(err ?: if (!wipeOk) WIPE_INCOMPLETE else null)
      } catch (t: Throwable) {
        setStatus("error", t.message)
        onDone(t.message ?: t.toString())
      }
    }
  }

  // -- identity backup / restore (#440) --------------------------------------

  /**
   * #440: read this device's 64-byte identity seed (account||delegate) for an
   * encrypted backup. While the node is up the plaintext seed has been sealed +
   * deleted (#258), so it is read back out of the Keystore-wrapped `.enc`; on the
   * rare window where a plaintext `.bin` still exists we read that. `null` if no
   * identity is provisioned yet or the Keystore unwrap fails.
   */
  fun readIdentitySeed(context: Context): ByteArray? {
    val enc = File(context.filesDir, IDENTITY_ENC_FILE)
    if (enc.exists()) {
      return try {
        Base64.decode(KeystoreCrypto.unwrap(enc.readText()), Base64.NO_WRAP)
      } catch (t: Throwable) {
        Log.e(TAG, "readIdentitySeed unwrap failed: ${t.message}")
        null
      }
    }
    val plain = File(identityPath(context))
    return if (plain.exists()) plain.readBytes() else null
  }

  /**
   * #440: restore an identity + chat history from a decrypted backup. Same
   * destructive primitive as [wipeAndRestart] (stop → clear all local state →
   * reopen), except we INSTALL the backed-up 64-byte seed and re-import the ChatDb
   * tables before reopening — so the node comes back up with the SAME address, and
   * the app history/contacts are restored. The native store is intentionally NOT
   * restored (MLS group state isn't portable — groups are re-formed via re-invite).
   *
   * #443 (review): the chat payload is VALIDATED against this build's schema before
   * anything destructive happens, and a chat import that fails anyway (after the wipe)
   * is reported as [PARTIAL_RESTORE_PREFIX] rather than swallowed — the caller must not
   * tell the user "Restored" when the history it just wiped did not come back.
   */
  fun importAndRestart(seed: ByteArray, chatJson: String?, onDone: (String?) -> Unit) {
    executor.execute {
      try {
        val context = appContext ?: run { onDone("no app context"); return@execute }
        if (seed.size != 64) { onDone("bad identity seed (${seed.size} bytes, expected 64)"); return@execute }
        // Gate FIRST: refuse a backup this build can't read while the user's data is
        // still here, instead of finding out after the wipe has thrown it away.
        if (!chatJson.isNullOrEmpty()) {
          try {
            ChatRepo.requireDb().validateImportJson(chatJson)
          } catch (t: Throwable) {
            Log.w(TAG, "restore refused before wipe: ${t.message}")
            onDone("${t.message} — nothing on this device was changed")
            return@execute
          }
        }
        stopBlocking()
        // Clean slate — identical to the wipe flow, and its COMPLETENESS matters: a failed
        // deletion can leave stale identity/store/keys — or a PLAINTEXT `.migbak` of the old
        // history — sitting beside the restored identity. #514: account for it exactly like
        // wipeAndRestart's `wipeOk`, so a partial clean surfaces as WIPE_INCOMPLETE below
        // instead of being reported as a clean success.
        var wipeOk = true
        wipeOk = deleteWithSiblings(File(context.filesDir, IDENTITY_FILE)) && wipeOk
        wipeOk = deleteWithSiblings(File(context.filesDir, IDENTITY_ENC_FILE)) && wipeOk
        wipeOk = deleteWithSiblings(File(context.filesDir, STORE_FILE)) && wipeOk
        val prefsOk = context.getSharedPreferences(SECURE_PREFS, Context.MODE_PRIVATE)
          .edit().clear().commit()
        wipeOk = wipeOk && prefsOk
        wipeOk = deleteRecursively(File(context.filesDir, "chat-images")) && wipeOk
        // wipeAndReinit sweeps the `.migbak`/`.enc` siblings of the old db — fold its result in.
        wipeOk = ChatRepo.wipeAndReinit(context) && wipeOk
        // INSTALL the backup's identity: write the plaintext seed the wrapper reads at
        // open (no .enc present → prepareIdentity no-ops → open_persistent uses this →
        // same address → sealIdentity re-seals it right after).
        File(identityPath(context)).writeBytes(seed)
        // Restore app-side history/contacts. Validation above makes this the unlikely
        // path, but if it still fails the wipe has already happened — so the identity
        // comes back and the caller is told the history did NOT (#443 review). Never
        // silently swallowed: the user must know what they lost.
        var partial: String? = null
        if (!chatJson.isNullOrEmpty()) {
          try {
            ChatRepo.requireDb().importJson(chatJson)
          } catch (t: Throwable) {
            Log.e(TAG, "importJson failed after wipe (identity still restored)", t)
            partial = "$PARTIAL_RESTORE_PREFIX${t.message ?: t.toString()}"
          }
        }
        Log.i(TAG, "identity restored from backup; reopening")
        val err = startBlocking()
        // Precedence: a node-open failure is the hardest stop; then #514's incomplete wipe
        // (old plaintext data may survive — the user must know their prior data wasn't
        // cleared); then a partial history restore. Never report a clean success when the
        // pre-restore wipe did not complete.
        onDone(err ?: if (!wipeOk) WIPE_INCOMPLETE else partial)
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
