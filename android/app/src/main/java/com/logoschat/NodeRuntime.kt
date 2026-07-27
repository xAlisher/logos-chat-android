package com.logoschat

import android.content.Context
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
  private const val SECURE_PREFS = "logoschat_secure"
  private const val KEY_DB_KEY = "dbKey"
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
  // Both live in the app-private sandbox (filesDir / SharedPreferences). M1' TODO:
  // wrap them in an Android Keystore-encrypted blob (the raw form is the M0'
  // stand-in — see docs/m1prime-log.md "remaining gaps").

  private fun identityPath(context: Context): String =
      File(context.filesDir, IDENTITY_FILE).absolutePath

  private fun storePath(context: Context): String =
      File(context.filesDir, STORE_FILE).absolutePath

  private fun dbKey(context: Context): String {
    val prefs = context.getSharedPreferences(SECURE_PREFS, Context.MODE_PRIVATE)
    prefs.getString(KEY_DB_KEY, null)?.let { return it }
    val bytes = ByteArray(32)
    SecureRandom().nextBytes(bytes)
    val hex = bytes.joinToString("") { "%02x".format(it) }
    prefs.edit().putString(KEY_DB_KEY, hex).commit()
    return hex
  }

  // -- lifecycle (runs ON the node executor) ---------------------------------

  private fun startBlocking(): String? {
    if (ctx != 0L) return "node already started (status=$status)"
    val context = appContext ?: return "no app context"
    setStatus("initializing")
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

  private fun stopBlocking() {
    val c = ctx
    if (c == 0L) return
    NodeBridge.chatShutdown(c)
    ctx = 0L
    address = null
    installationName = null
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
        stopBlocking()
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
