package com.logoschat

import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

/**
 * #258 (Phase 1): AES-GCM wrap/unwrap backed by a hardware key in the Android
 * Keystore (TEE/StrongBox when available). Used to encrypt the node's `dbKey`
 * (and, later, other secrets) at rest so root/forensics can't read them straight
 * out of SharedPreferences — the key material never leaves the secure hardware.
 *
 * The Keystore key is deliberately NOT user-authentication-gated: it must survive
 * the user changing/removing their lock screen, otherwise the wrapped `dbKey`
 * would become undecryptable and orphan the (already-encrypted) node store.
 * Protection is "at rest against a powered-off / rooted-after-the-fact device",
 * not against a live rooted process — see #258.
 */
object KeystoreCrypto {
  private const val KS = "AndroidKeyStore"
  private const val ALIAS = "logoschat_dek"
  private const val TRANSFORM = "AES/GCM/NoPadding"
  private const val IV_LEN = 12
  private const val TAG_BITS = 128

  private fun secretKey(): SecretKey {
    val ks = KeyStore.getInstance(KS).apply { load(null) }
    (ks.getEntry(ALIAS, null) as? KeyStore.SecretKeyEntry)?.let { return it.secretKey }
    val kg = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, KS)
    kg.init(
        KeyGenParameterSpec.Builder(
                ALIAS,
                KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
            .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
            .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
            .setKeySize(256)
            // NOT setUserAuthenticationRequired(true) — see class doc.
            .build())
    return kg.generateKey()
  }

  /** Encrypt [plaintext] → base64(iv‖ciphertext‖tag). */
  fun wrap(plaintext: String): String {
    val c = Cipher.getInstance(TRANSFORM)
    c.init(Cipher.ENCRYPT_MODE, secretKey())
    val iv = c.iv
    val ct = c.doFinal(plaintext.toByteArray(Charsets.UTF_8))
    val out = ByteArray(iv.size + ct.size)
    System.arraycopy(iv, 0, out, 0, iv.size)
    System.arraycopy(ct, 0, out, iv.size, ct.size)
    return Base64.encodeToString(out, Base64.NO_WRAP)
  }

  /** Inverse of [wrap]. Throws if the blob is corrupt or the key is gone. */
  fun unwrap(blob: String): String {
    val raw = Base64.decode(blob, Base64.NO_WRAP)
    val iv = raw.copyOfRange(0, IV_LEN)
    val ct = raw.copyOfRange(IV_LEN, raw.size)
    val c = Cipher.getInstance(TRANSFORM)
    c.init(Cipher.DECRYPT_MODE, secretKey(), GCMParameterSpec(TAG_BITS, iv))
    return String(c.doFinal(ct), Charsets.UTF_8)
  }
}
