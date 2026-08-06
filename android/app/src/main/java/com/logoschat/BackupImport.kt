package com.logoschat

import android.content.Context
import android.net.Uri
import android.util.Base64
import org.json.JSONObject

/**
 * #440: shared restore logic — read a backup file (a SAF content URI), decrypt it,
 * extract the 64-byte identity seed, and hand off to [NodeRuntime.importAndRestart].
 *
 * Lives outside the React modules on purpose: the restore must survive the file
 * picker recreating the host Activity (low memory / "Don't keep activities"), so the
 * pick→import runs in native `onActivityResult` (ImagePickerModule) rather than across
 * a JS-held promise. Both that path and the direct JS `importChatData` call in.
 */
object BackupImport {
  /** [onDone] gets (restoredAddress, null) on success or (null, error) on failure.
   *  Runs the read + heavy PBKDF2 decrypt on the node executor — off the main thread
   *  (the picker's onActivityResult fires on main) and serialized with the node ops
   *  importAndRestart performs. [onDone] fires on the executor thread. */
  fun run(context: Context, uriStr: String, passphrase: String, onDone: (String?, String?) -> Unit) {
    NodeRuntime.executor.execute { runBlocking(context, uriStr, passphrase, onDone) }
  }

  private fun runBlocking(
      context: Context,
      uriStr: String,
      passphrase: String,
      onDone: (String?, String?) -> Unit,
  ) {
    try {
      val envelope =
          context.contentResolver
              .openInputStream(Uri.parse(uriStr))
              ?.bufferedReader(Charsets.UTF_8)
              ?.use { it.readText() }
              ?: throw IllegalArgumentException("could not read the backup file")
      val json =
          try {
            BackupCrypto.decrypt(passphrase, envelope)
          } catch (e: Throwable) {
            throw IllegalArgumentException("wrong passphrase, or not a Peers backup")
          }
      val root = JSONObject(json)
      val idB64 = root.optString("identity", "")
      if (idB64.isEmpty()) {
        throw IllegalArgumentException(
            "this backup has no identity (it was made before identity backup existed)")
      }
      val seed = Base64.decode(idB64, Base64.NO_WRAP)
      NodeRuntime.importAndRestart(seed, json) { err ->
        if (err == null) onDone(NodeRuntime.address, null) else onDone(null, err)
      }
    } catch (t: Throwable) {
      onDone(null, t.message ?: t.toString())
    }
  }
}
