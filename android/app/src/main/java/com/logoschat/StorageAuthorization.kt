package com.logoschat

/**
 * Transitional authorization policy for hosted media.
 *
 * New downloads use the per-blob capability carried inside the MLS message and do not need a
 * shared application bearer. The legacy bearer remains accepted during the gateway migration.
 * Upload authorization is separate and uses anonymous short-lived one-use grants.
 */
object StorageAuthorization {
  fun canDownload(legacyToken: String, capability: String): Boolean =
      legacyToken.isNotEmpty() || capability.isNotEmpty()

  fun bearerHeader(legacyToken: String, capability: String): String =
      if (legacyToken.isEmpty() || capability.isNotEmpty()) "" else "Bearer $legacyToken"
}
