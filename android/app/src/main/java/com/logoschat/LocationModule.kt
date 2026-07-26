package com.logoschat

import android.Manifest
import android.annotation.SuppressLint
import android.content.Context
import android.content.pm.PackageManager
import android.location.Location
import android.location.LocationListener
import android.location.LocationManager
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.HandlerThread
import android.util.Log
import androidx.core.content.ContextCompat
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import java.util.concurrent.atomic.AtomicBoolean

/**
 * Single-shot location provider — dependency-free.
 *
 * Resolves ONE current fix as a stringified JSON `{"lat":<double>,"lng":<double>,
 * "accuracy":<float meters>}`. This uses the *platform* [LocationManager] system
 * service only — deliberately NO Google Play Services / FusedLocationProvider
 * dependency, keeping the app free of that transitive weight (same "beside, not
 * bundled" discipline as [MeshCoreModule]).
 *
 * Strategy (fast-path first, then a bounded live request):
 *   1. Verify ACCESS_FINE_LOCATION or ACCESS_COARSE_LOCATION is granted; reject
 *      code "permission" if neither is.
 *   2. Try [LocationManager.getLastKnownLocation] on GPS then NETWORK for an
 *      instant answer.
 *   3. If that is null/stale, request a single live update (one fix, then remove
 *      the listener) with a ~15 s timeout on a dedicated [HandlerThread]; reject
 *      code "timeout" if no fix arrives.
 *
 * Threading: platform location callbacks are delivered on the Looper we hand to
 * [LocationManager.requestLocationUpdates], so we run the whole request on one
 * dedicated HandlerThread ("location-provider") — the listener, the timeout, and
 * listener removal all touch that single thread (same discipline as MeshCoreModule).
 *
 * TODO(manifest): the fine/coarse permissions currently exist in AndroidManifest.xml
 *   ONLY with `android:maxSdkVersion="30"` (they were added for the pre-12 BLE scan).
 *   For this module to work on Android 12+ the manifest needs UNRESTRICTED entries:
 *     <uses-permission android:name="android.permission.ACCESS_FINE_LOCATION"/>
 *     <uses-permission android:name="android.permission.ACCESS_COARSE_LOCATION"/>
 *   Another agent owns app wiring; not edited here. Runtime *requesting* of these
 *   belongs in the JS/UI layer; this module only checks they are granted.
 */
class LocationModule(reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext) {

  companion object {
    private const val TAG = "location-provider"

    /** Overall budget for producing a fix once a live update is requested. */
    private const val FIX_TIMEOUT_MS = 15_000L

    /** A cached last-known fix older than this is treated as stale → live update. */
    private const val STALE_FIX_MS = 60_000L
  }

  override fun getName() = "LocationProvider"

  // All request state below is confined to [handler]'s thread.
  private val handlerThread = HandlerThread("location-provider").apply { start() }
  private val handler = Handler(handlerThread.looper)

  /**
   * Fetch a single current location. Fast-paths a fresh last-known fix; otherwise
   * requests one live update with a [FIX_TIMEOUT_MS] timeout. Resolves a stringified
   * JSON `{"lat":<double>,"lng":<double>,"accuracy":<float meters>}`.
   *
   * Rejects on: missing location permission ("permission"), no location provider
   * enabled ("unavailable"), or no fix within the timeout ("timeout").
   */
  @ReactMethod
  fun getCurrent(promise: Promise) {
    handler.post {
      val ctx = reactApplicationContext
      if (!hasLocationPermission(ctx)) {
        promise.reject("permission", "missing location permission (see manifest TODO)")
        return@post
      }
      val lm = ctx.getSystemService(Context.LOCATION_SERVICE) as? LocationManager
      if (lm == null) {
        promise.reject("unavailable", "LocationManager unavailable")
        return@post
      }

      // 1. Fast path: a fresh last-known fix from GPS then NETWORK.
      val cached = lastKnownFix(lm)
      if (cached != null && !isStale(cached)) {
        promise.resolve(toJson(cached))
        return@post
      }

      // 2. Otherwise request a single live update, bounded by a timeout.
      requestSingleFix(lm, promise, fallback = cached)
    }
  }

  /**
   * Request exactly one live location update. Settles [promise] with the first fix
   * (removing the listener), or on timeout resolves a [fallback] stale fix if one
   * exists else rejects "timeout". Everything runs on [handler]'s thread.
   */
  @SuppressLint("MissingPermission") // permission verified in getCurrent()
  private fun requestSingleFix(lm: LocationManager, promise: Promise, fallback: Location?) {
    val settle = SettleOnce(promise)

    // Prefer a provider that is actually enabled; NETWORK first for speed, GPS as
    // a fallback (NETWORK may be off on Wi-Fi-less devices).
    val providers =
        listOf(LocationManager.NETWORK_PROVIDER, LocationManager.GPS_PROVIDER).filter {
          try {
            lm.isProviderEnabled(it)
          } catch (t: Throwable) {
            false
          }
        }
    if (providers.isEmpty()) {
      if (fallback != null) settle.resolve(toJson(fallback))
      else settle.reject("unavailable", "no location provider enabled")
      return
    }

    val listener =
        object : LocationListener {
          override fun onLocationChanged(location: Location) {
            handler.post {
              removeUpdates(lm, this)
              settle.resolve(toJson(location))
            }
          }

          // Deprecated on API 29+ but still part of the interface pre-29; harmless no-ops.
          override fun onStatusChanged(provider: String?, status: Int, extras: Bundle?) {}

          override fun onProviderEnabled(provider: String) {}

          override fun onProviderDisabled(provider: String) {}
        }

    val timeout = Runnable {
      removeUpdates(lm, listener)
      // A stale cached fix beats nothing — return it rather than failing outright.
      if (fallback != null) settle.resolve(toJson(fallback))
      else settle.reject("timeout", "no location fix within ${FIX_TIMEOUT_MS}ms")
    }

    try {
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
        // requestSingleUpdate is deprecated; use a normal request + self-removal on
        // first fix. minTimeMs/minDistanceM = 0 → fastest possible single fix.
        for (p in providers) {
          lm.requestLocationUpdates(p, 0L, 0f, listener, handler.looper)
        }
      } else {
        @Suppress("DEPRECATION")
        for (p in providers) {
          lm.requestSingleUpdate(p, listener, handler.looper)
        }
      }
    } catch (t: Throwable) {
      removeUpdates(lm, listener)
      settle.reject("unavailable", "requestLocationUpdates failed: ${t.message}")
      return
    }
    handler.postDelayed(timeout, FIX_TIMEOUT_MS)
    Log.i(TAG, "awaiting single fix from $providers")
  }

  @SuppressLint("MissingPermission")
  private fun removeUpdates(lm: LocationManager, listener: LocationListener) {
    try {
      lm.removeUpdates(listener)
    } catch (t: Throwable) {
      Log.w(TAG, "removeUpdates: ${t.message}")
    }
  }

  /** Most recent last-known fix across GPS then NETWORK, or null if none. */
  @SuppressLint("MissingPermission")
  private fun lastKnownFix(lm: LocationManager): Location? {
    var best: Location? = null
    for (p in listOf(LocationManager.GPS_PROVIDER, LocationManager.NETWORK_PROVIDER)) {
      val loc =
          try {
            lm.getLastKnownLocation(p)
          } catch (t: Throwable) {
            null
          }
      if (loc != null && (best == null || loc.time > best!!.time)) best = loc
    }
    return best
  }

  private fun isStale(loc: Location): Boolean =
      System.currentTimeMillis() - loc.time > STALE_FIX_MS

  private fun hasLocationPermission(ctx: Context): Boolean {
    fun granted(p: String) =
        ContextCompat.checkSelfPermission(ctx, p) == PackageManager.PERMISSION_GRANTED
    return granted(Manifest.permission.ACCESS_FINE_LOCATION) ||
        granted(Manifest.permission.ACCESS_COARSE_LOCATION)
  }

  /** Serialise a fix to the stringified JSON the JS wrapper parses. */
  private fun toJson(loc: Location): String =
      org.json.JSONObject()
          .apply {
            put("lat", loc.latitude)
            put("lng", loc.longitude)
            put("accuracy", loc.accuracy.toDouble())
          }
          .toString()

  /** A promise that can be settled from exactly one place, exactly once. */
  private class SettleOnce(private val promise: Promise) {
    private val done = AtomicBoolean(false)
    fun resolve(value: Any?) {
      if (done.compareAndSet(false, true)) promise.resolve(value)
    }
    fun reject(code: String, message: String) {
      if (done.compareAndSet(false, true)) promise.reject(code, message)
    }
  }
}
