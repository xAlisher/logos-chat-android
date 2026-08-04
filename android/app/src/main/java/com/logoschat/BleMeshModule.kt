package com.logoschat

import android.Manifest
import android.annotation.SuppressLint
import android.bluetooth.BluetoothAdapter
import android.bluetooth.BluetoothDevice
import android.bluetooth.BluetoothGatt
import android.bluetooth.BluetoothGattCallback
import android.bluetooth.BluetoothGattCharacteristic
import android.bluetooth.BluetoothGattDescriptor
import android.bluetooth.BluetoothGattServer
import android.bluetooth.BluetoothGattServerCallback
import android.bluetooth.BluetoothGattService
import android.bluetooth.BluetoothManager
import android.bluetooth.BluetoothProfile
import android.bluetooth.le.AdvertiseCallback
import android.bluetooth.le.AdvertiseData
import android.bluetooth.le.AdvertiseSettings
import android.bluetooth.le.BluetoothLeAdvertiser
import android.bluetooth.le.BluetoothLeScanner
import android.bluetooth.le.ScanCallback
import android.bluetooth.le.ScanFilter
import android.bluetooth.le.ScanResult
import android.bluetooth.le.ScanSettings
import android.content.Context
import android.content.pm.PackageManager
import android.os.Build
import android.os.Handler
import android.os.HandlerThread
import android.os.ParcelUuid
import android.os.SystemClock
import android.util.Log
import androidx.core.content.ContextCompat
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.WritableMap
import com.facebook.react.modules.core.DeviceEventManagerModule
import java.util.UUID
import java.util.concurrent.atomic.AtomicBoolean
import org.json.JSONObject

/**
 * BleMesh — the BLE-mesh transport (epic #133), the THIRD transport beside the
 * Logos MLS node (LogosChatModule / NodeBridge) and the paired MeshCore LoRa
 * radio (MeshCoreModule). Like MeshCore it is pure Kotlin BLE + JS + UI — no
 * Rust / FFI / bridge involvement.
 *
 * This first increment is a **presence** layer, not yet the full flood mesh:
 *   - Peripheral role: advertise a fixed Logos-mesh service UUID so nearby
 *     devices running this app can see us.
 *   - Central role: scan for that same service UUID and maintain a live count of
 *     nearby peers (pruned by a TTL so the count reflects who is actually here).
 *
 * It emits on the single 'BleMeshEvent' channel:
 *   - {eventType:'status', status:'off'|'starting'|'on'}
 *   - {eventType:'peers', count:Int}
 *
 * Data GATT channels, flood routing, and MLS-over-sub-MTU fragmentation are
 * deliberately out of scope here — they are later children (#142/#139/#136).
 */
class BleMeshModule(reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext) {

  companion object {
    private const val TAG = "ble-mesh"
    private const val JS_EVENT = "BleMeshEvent"

    /** Our fixed presence service UUID — devices advertising it are Logos-mesh peers. */
    private val SERVICE_UUID: UUID =
        UUID.fromString("d1e5f0a0-1b2c-4d3e-9f5a-0123456789ab")
    private val SERVICE_PARCEL = ParcelUuid(SERVICE_UUID)
    /** #142: the mesh packet characteristic (WRITE from a central, NOTIFY to it). */
    private val MESH_CHAR_UUID: UUID =
        UUID.fromString("d1e5f0a0-1b2c-4d3e-9f5a-0123456789ac")
    /** Standard Client Characteristic Config Descriptor (for enabling notify). */
    private val CCCD_UUID: UUID =
        UUID.fromString("00002902-0000-1000-8000-00805f9b34fb")

    /** Drop a peer we haven't heard from in this long (ms). */
    private const val PEER_TTL_MS = 20_000L
    /** How often to prune stale peers (ms). */
    private const val PRUNE_INTERVAL_MS = 5_000L
    /** #214: advertised rotating-id length in bytes. */
    private const val ID_LEN = 6
    /** #239: hard cap on concurrent GATT client links. Android's BLE stack chokes
     *  well before this, and — with MAC rotation making one phone look like many
     *  addresses — an uncapped dial-everyone burst balloons memory (100MB+ in
     *  seconds) until the OS kills the app. */
    private const val MAX_LINKS = 6
  }

  override fun getName() = "BleMesh"

  // All BLE start/stop + bookkeeping runs on a dedicated thread so callbacks and
  // the peers map are only ever touched off the JS/main thread.
  private val handlerThread = HandlerThread("ble-mesh").apply { start() }
  private val handler = Handler(handlerThread.looper)

  @Volatile private var status: String = "off"
  private var advertiser: BluetoothLeAdvertiser? = null
  private var scanner: BluetoothLeScanner? = null
  private var advertiseCallback: AdvertiseCallback? = null
  private var scanCallback: ScanCallback? = null

  /** #214: advertised service-data payload = idBytes(6) + flags(1). id all-zero
   *  when advertising anonymously (presence only, no identity). */
  @Volatile private var advPayload: ByteArray = ByteArray(ID_LEN + 1)

  /** address -> [lastSeenElapsed, heardIdHex('' if anonymous)]; guarded by [peers]. */
  private val peers = HashMap<String, Pair<Long, String>>()
  private var lastEmittedCount = -1
  private var lastEmittedIds: Set<String> = emptySet()

  // #142: GATT dual-role transport. Server hosts the mesh characteristic;
  // centrals connect to it. We also connect (as central) to heard peers' servers.
  private var gattServer: BluetoothGattServer? = null
  private var meshChar: BluetoothGattCharacteristic? = null
  /** centrals currently connected to OUR server (we notify them). */
  private val serverClients = java.util.Collections.synchronizedSet(HashSet<BluetoothDevice>())
  /** peripherals WE are connected to as a central, by address (we write to them). */
  private val clientConns = java.util.concurrent.ConcurrentHashMap<String, BluetoothGatt>()
  /** addresses we're mid-connect to, to avoid duplicate connectGatt. */
  private val connecting = java.util.Collections.synchronizedSet(HashSet<String>())
  // #239: identities (advertised idHex) we already hold a link to, so a peer whose
  // BLE MAC rotated isn't dialled again; and addr->idHex to clean up on disconnect.
  private val linkedIds = java.util.Collections.synchronizedSet(HashSet<String>())
  private val idByAddr = java.util.concurrent.ConcurrentHashMap<String, String>()
  // #364: pre-JS-bridge admission control — size cap + per-source/global rate limit + replay
  // dedup for unauthenticated GATT ingress. Not authentication; a handshake is remaining #364.
  private val ingressGate = BleIngressGate()

  // -- capability query -------------------------------------------------------

  @ReactMethod
  fun getAvailability(promise: Promise) {
    val supported =
        reactApplicationContext.packageManager.hasSystemFeature(
            PackageManager.FEATURE_BLUETOOTH_LE)
    val adapter = bluetoothAdapter()
    val adapterOn = adapter?.isEnabled == true
    val advertiseSupported =
        adapterOn && adapter?.isMultipleAdvertisementSupported == true
    val json =
        JSONObject()
            .put("supported", supported)
            .put("advertiseSupported", advertiseSupported)
            .put("adapterOn", adapterOn)
            .toString()
    promise.resolve(json)
  }

  @ReactMethod
  fun getStatus(promise: Promise) {
    promise.resolve(status)
  }

  // -- engage / disengage -----------------------------------------------------

  @ReactMethod
  fun engage(advertiseIdHex: String?, flags: Int, promise: Promise) {
    if (status != "off") {
      promise.resolve(null) // idempotent: already engaging/engaged
      return
    }
    advPayload = buildPayload(advertiseIdHex, flags)
    val missing = missingPermission()
    if (missing != null) {
      promise.reject("permission", "missing runtime permission: $missing")
      return
    }
    val adapter = bluetoothAdapter()
    if (adapter == null || !adapter.isEnabled) {
      promise.reject("bt_off", "Bluetooth is off or unavailable")
      return
    }
    val adv = adapter.bluetoothLeAdvertiser
    if (adv == null) {
      promise.reject("no_advertiser", "BLE advertising unavailable on this device")
      return
    }
    val scan = adapter.bluetoothLeScanner
    if (scan == null) {
      promise.reject("no_scanner", "BLE scanner unavailable")
      return
    }
    advertiser = adv
    scanner = scan
    setStatus("starting")

    val settled = AtomicBoolean(false)
    handler.post {
      try {
        openGattServerLocked() // #142: host the mesh characteristic for centrals
        startScanLocked(scan)
        startAdvertiseLocked(
            adv,
            onOk = {
              setStatus("on")
              handler.postDelayed(pruneRunnable, PRUNE_INTERVAL_MS)
              if (settled.compareAndSet(false, true)) promise.resolve(null)
            },
            onFail = { msg ->
              stopAllLocked()
              setStatus("off")
              if (settled.compareAndSet(false, true)) promise.reject("advertise_failed", msg)
            },
        )
      } catch (t: Throwable) {
        stopAllLocked()
        setStatus("off")
        if (settled.compareAndSet(false, true)) {
          promise.reject("engage_failed", t.message ?: "unknown error")
        }
      }
    }
  }

  @ReactMethod
  fun disengage(promise: Promise) {
    handler.post {
      stopAllLocked()
      closeGattLocked()
      synchronized(peers) { peers.clear() }
      lastEmittedCount = -1
      lastEmittedIds = emptySet()
      setStatus("off")
      promise.resolve(null)
    }
  }

  /**
   * #214: swap the advertised rotating id (+flags) without a full restart — called
   * by JS on epoch rollover or when the identity toggle changes. No-op when off.
   */
  @ReactMethod
  fun updateAdvertiseId(advertiseIdHex: String?, flags: Int, promise: Promise) {
    advPayload = buildPayload(advertiseIdHex, flags)
    handler.post {
      val adv = advertiser
      val cb = advertiseCallback
      if (status == "on" && adv != null && cb != null) {
        try {
          stopAdvertOnly(adv, cb)
          startAdvertiseLocked(adv, onOk = {}, onFail = {})
        } catch (t: Throwable) {
          Log.w(TAG, "re-advertise failed: ${t.message}")
        }
      }
      promise.resolve(null)
    }
  }

  /** payload = idBytes(6) + flags(1); id all-zero when advertising anonymously. */
  private fun buildPayload(idHex: String?, flags: Int): ByteArray {
    val out = ByteArray(ID_LEN + 1)
    if (idHex != null && idHex.length >= ID_LEN * 2) {
      for (i in 0 until ID_LEN) {
        out[i] = idHex.substring(i * 2, i * 2 + 2).toInt(16).toByte()
      }
    }
    out[ID_LEN] = flags.toByte()
    return out
  }

  // -- BLE plumbing (all on the handler thread) -------------------------------

  @SuppressLint("MissingPermission") // permission verified in engage() via missingPermission()
  private fun startAdvertiseLocked(
      adv: BluetoothLeAdvertiser,
      onOk: () -> Unit,
      onFail: (String) -> Unit,
  ) {
    val settings =
        AdvertiseSettings.Builder()
            .setAdvertiseMode(AdvertiseSettings.ADVERTISE_MODE_BALANCED)
            .setTxPowerLevel(AdvertiseSettings.ADVERTISE_TX_POWER_MEDIUM)
            .setConnectable(true) // #142: centrals connect to our GATT server to exchange packets
            .setTimeout(0)
            .build()
    // #214: advertise SERVICE DATA (UUID + idBytes(6) + flags(1)) — carries the
    // rotating identity + flags AND self-identifies as a Logos-mesh node, in one
    // legacy 31-byte PDU (16B UUID + 7B data + overhead). Device name omitted.
    val data =
        AdvertiseData.Builder()
            .setIncludeDeviceName(false)
            .setIncludeTxPowerLevel(false)
            .addServiceData(SERVICE_PARCEL, advPayload)
            .build()
    val cb =
        object : AdvertiseCallback() {
          override fun onStartSuccess(settingsInEffect: AdvertiseSettings?) {
            Log.i(TAG, "advertising started")
            onOk()
          }
          override fun onStartFailure(errorCode: Int) {
            Log.w(TAG, "advertising failed: $errorCode")
            onFail("advertise error code $errorCode")
          }
        }
    advertiseCallback = cb
    adv.startAdvertising(settings, data, cb)
  }

  @SuppressLint("MissingPermission") // permission verified in engage() via missingPermission()
  private fun startScanLocked(scan: BluetoothLeScanner) {
    // #214: match on our SERVICE DATA (any payload) so we read the identity bytes.
    val filters =
        listOf(ScanFilter.Builder().setServiceData(SERVICE_PARCEL, ByteArray(0)).build())
    val settings =
        ScanSettings.Builder()
            .setScanMode(ScanSettings.SCAN_MODE_LOW_POWER)
            .setReportDelay(0)
            .build()
    val cb =
        object : ScanCallback() {
          override fun onScanResult(callbackType: Int, result: ScanResult?) {
            handleResult(result)
          }
          override fun onBatchScanResults(results: MutableList<ScanResult>?) {
            results?.forEach { handleResult(it) }
          }
          override fun onScanFailed(errorCode: Int) {
            Log.w(TAG, "scan failed: $errorCode")
          }
        }
    scanCallback = cb
    scan.startScan(filters, settings, cb)
  }

  /** Extract the heard id from a result's service data ('' when anonymous). */
  private fun handleResult(result: ScanResult?) {
    val address = result?.device?.address ?: return
    val data = result.scanRecord?.getServiceData(SERVICE_PARCEL)
    var idHex = ""
    if (data != null && data.size >= ID_LEN) {
      val sb = StringBuilder(ID_LEN * 2)
      var anyNonZero = false
      for (i in 0 until ID_LEN) {
        val b = data[i].toInt() and 0xFF
        if (b != 0) anyNonZero = true
        sb.append("%02x".format(b))
      }
      if (anyNonZero) idHex = sb.toString()
    }
    notePeer(address, idHex)
    // #142/#239: open a GATT link (as central) so packets can flow — but at most
    // one link per identity, capped in total (see maybeConnect).
    result.device?.let { maybeConnect(it, idHex) }
  }

  @SuppressLint("MissingPermission")
  private fun stopAdvertOnly(adv: BluetoothLeAdvertiser, cb: AdvertiseCallback) {
    try {
      adv.stopAdvertising(cb)
    } catch (t: Throwable) {
      Log.w(TAG, "stopAdvertOnly: ${t.message}")
    }
  }

  @SuppressLint("MissingPermission")
  private fun stopAllLocked() {
    try {
      advertiseCallback?.let { advertiser?.stopAdvertising(it) }
    } catch (t: Throwable) {
      Log.w(TAG, "stopAdvertising: ${t.message}")
    }
    try {
      scanCallback?.let { scanner?.stopScan(it) }
    } catch (t: Throwable) {
      Log.w(TAG, "stopScan: ${t.message}")
    }
    advertiseCallback = null
    scanCallback = null
    handler.removeCallbacks(pruneRunnable)
  }

  private fun notePeer(address: String, idHex: String) {
    val changed: Boolean
    synchronized(peers) {
      val prev = peers[address]
      // "changed" when a new device, or its heard id changed (rotation/resolve).
      changed = prev == null || prev.second != idHex
      peers[address] = Pair(SystemClock.elapsedRealtime(), idHex)
    }
    if (changed) emitPeers()
  }

  private val pruneRunnable =
      object : Runnable {
        override fun run() {
          val now = SystemClock.elapsedRealtime()
          var changed = false
          synchronized(peers) {
            val it = peers.entries.iterator()
            while (it.hasNext()) {
              if (now - it.next().value.first > PEER_TTL_MS) {
                it.remove()
                changed = true
              }
            }
          }
          if (changed) emitPeers()
          if (status == "on") handler.postDelayed(this, PRUNE_INTERVAL_MS)
        }
      }

  // -- GATT dual-role transport (#142) ----------------------------------------

  @SuppressLint("MissingPermission")
  private fun openGattServerLocked() {
    if (gattServer != null) return
    val mgr =
        reactApplicationContext.getSystemService(Context.BLUETOOTH_SERVICE) as? BluetoothManager
            ?: return
    val server = mgr.openGattServer(reactApplicationContext, gattServerCallback) ?: return
    val ch =
        BluetoothGattCharacteristic(
            MESH_CHAR_UUID,
            BluetoothGattCharacteristic.PROPERTY_WRITE or
                BluetoothGattCharacteristic.PROPERTY_WRITE_NO_RESPONSE or
                BluetoothGattCharacteristic.PROPERTY_NOTIFY,
            BluetoothGattCharacteristic.PERMISSION_WRITE)
    ch.addDescriptor(
        BluetoothGattDescriptor(
            CCCD_UUID,
            BluetoothGattDescriptor.PERMISSION_READ or BluetoothGattDescriptor.PERMISSION_WRITE))
    val svc = BluetoothGattService(SERVICE_UUID, BluetoothGattService.SERVICE_TYPE_PRIMARY)
    svc.addCharacteristic(ch)
    server.addService(svc)
    gattServer = server
    meshChar = ch
    Log.i(TAG, "GATT server open")
  }

  private val gattServerCallback =
      object : BluetoothGattServerCallback() {
        override fun onConnectionStateChange(device: BluetoothDevice, status: Int, newState: Int) {
          if (newState == BluetoothProfile.STATE_CONNECTED) serverClients.add(device)
          else if (newState == BluetoothProfile.STATE_DISCONNECTED) serverClients.remove(device)
        }
        @SuppressLint("MissingPermission")
        override fun onCharacteristicWriteRequest(
            device: BluetoothDevice,
            requestId: Int,
            characteristic: BluetoothGattCharacteristic,
            preparedWrite: Boolean,
            responseNeeded: Boolean,
            offset: Int,
            value: ByteArray,
        ) {
          if (characteristic.uuid == MESH_CHAR_UUID) emitPacket(device.address, value)
          if (responseNeeded) {
            gattServer?.sendResponse(device, requestId, BluetoothGatt.GATT_SUCCESS, 0, null)
          }
        }
        @SuppressLint("MissingPermission")
        override fun onDescriptorWriteRequest(
            device: BluetoothDevice,
            requestId: Int,
            descriptor: BluetoothGattDescriptor,
            preparedWrite: Boolean,
            responseNeeded: Boolean,
            offset: Int,
            value: ByteArray,
        ) {
          if (responseNeeded) {
            gattServer?.sendResponse(device, requestId, BluetoothGatt.GATT_SUCCESS, 0, null)
          }
        }
      }

  @SuppressLint("MissingPermission")
  private fun maybeConnect(device: BluetoothDevice, idHex: String) {
    val addr = device.address
    if (clientConns.containsKey(addr) || connecting.contains(addr)) return
    // #239: one link per IDENTITY — MAC rotation makes a single phone appear under
    // many addresses; without this we'd open a fresh GATT link for each.
    if (idHex.isNotEmpty() && linkedIds.contains(idHex)) return
    // If they already connected to OUR server, don't dial back (avoids double links).
    synchronized(serverClients) {
      if (serverClients.any { it.address == addr }) return
    }
    // #239: hard cap — never let a scan burst open an unbounded number of links.
    if (clientConns.size + connecting.size >= MAX_LINKS) return
    connecting.add(addr)
    if (idHex.isNotEmpty()) idByAddr[addr] = idHex
    device.connectGatt(
        reactApplicationContext, false, gattClientCallback, BluetoothDevice.TRANSPORT_LE)
  }

  private val gattClientCallback =
      object : BluetoothGattCallback() {
        @SuppressLint("MissingPermission")
        override fun onConnectionStateChange(gatt: BluetoothGatt, status: Int, newState: Int) {
          val addr = gatt.device.address
          if (newState == BluetoothProfile.STATE_CONNECTED) {
            gatt.requestMtu(247) // discover after the MTU settles
          } else if (newState == BluetoothProfile.STATE_DISCONNECTED) {
            clientConns.remove(addr)
            connecting.remove(addr)
            idByAddr.remove(addr)?.let { linkedIds.remove(it) } // #239
            try { gatt.close() } catch (_: Throwable) {}
          }
        }
        @SuppressLint("MissingPermission")
        override fun onMtuChanged(gatt: BluetoothGatt, mtu: Int, status: Int) {
          gatt.discoverServices()
        }
        @SuppressLint("MissingPermission")
        override fun onServicesDiscovered(gatt: BluetoothGatt, status: Int) {
          val ch = gatt.getService(SERVICE_UUID)?.getCharacteristic(MESH_CHAR_UUID)
          if (ch == null) {
            // #239: no mesh characteristic — not one of us. Close the link so it
            // doesn't count against the cap / linger natively.
            connecting.remove(gatt.device.address)
            idByAddr.remove(gatt.device.address)
            try { gatt.close() } catch (_: Throwable) {}
            return
          }
          gatt.setCharacteristicNotification(ch, true)
          ch.getDescriptor(CCCD_UUID)?.let { d ->
            @Suppress("DEPRECATION")
            run {
              d.value = BluetoothGattDescriptor.ENABLE_NOTIFICATION_VALUE
              gatt.writeDescriptor(d)
            }
          }
          clientConns[gatt.device.address] = gatt
          connecting.remove(gatt.device.address)
          idByAddr[gatt.device.address]?.let { linkedIds.add(it) } // #239: one link/identity
          Log.i(TAG, "GATT client linked to ${gatt.device.address}")
        }
        @Suppress("DEPRECATION")
        override fun onCharacteristicChanged(
            gatt: BluetoothGatt,
            characteristic: BluetoothGattCharacteristic,
        ) {
          if (characteristic.uuid == MESH_CHAR_UUID)
              emitPacket(gatt.device.address, characteristic.value ?: return)
        }
      }

  /**
   * #142: broadcast a packet to every GATT link — write to peripherals we're a
   * central of, and notify centrals connected to our server. Dedup on receipt
   * (JS bleFlood) handles a peer reachable over both directions.
   */
  @ReactMethod
  @SuppressLint("MissingPermission")
  fun sendMeshPacket(packet: String, promise: Promise) {
    handler.post {
      val bytes = packet.toByteArray(Charsets.UTF_8)
      var sent = 0
      for (gatt in clientConns.values) {
        val ch = gatt.getService(SERVICE_UUID)?.getCharacteristic(MESH_CHAR_UUID)
        if (ch != null) {
          @Suppress("DEPRECATION")
          run {
            ch.value = bytes
            ch.writeType = BluetoothGattCharacteristic.WRITE_TYPE_DEFAULT
            if (gatt.writeCharacteristic(ch)) sent++
          }
        }
      }
      val ch = meshChar
      val server = gattServer
      if (ch != null && server != null) {
        synchronized(serverClients) {
          for (d in serverClients) {
            @Suppress("DEPRECATION")
            run {
              ch.value = bytes
              if (server.notifyCharacteristicChanged(d, ch, false)) sent++
            }
          }
        }
      }
      promise.resolve(sent)
    }
  }

  private fun emitPacket(source: String, value: ByteArray) {
    // #364: gate unauthenticated ingress before it reaches JS — drop oversized, flooded, or
    // replayed frames. (JS bleFlood still dedups end-to-end for multi-path delivery.)
    val verdict = ingressGate.admit(source, value, System.currentTimeMillis())
    if (verdict != BleIngressGate.Verdict.ACCEPT) {
      Log.d(TAG, "ble ingress dropped ($verdict) ${value.size}B from $source")
      return
    }
    val params = Arguments.createMap().apply {
      putString("eventType", "packet")
      putString("data", String(value, Charsets.UTF_8))
    }
    emitToJs(params)
  }

  @SuppressLint("MissingPermission")
  private fun closeGattLocked() {
    for (gatt in clientConns.values) {
      try { gatt.close() } catch (_: Throwable) {}
    }
    clientConns.clear()
    connecting.clear()
    serverClients.clear()
    linkedIds.clear() // #239
    idByAddr.clear()
    try { gattServer?.close() } catch (_: Throwable) {}
    gattServer = null
    meshChar = null
  }

  // -- helpers ----------------------------------------------------------------

  private fun setStatus(next: String) {
    status = next
    val params = Arguments.createMap().apply {
      putString("eventType", "status")
      putString("status", next)
    }
    emitToJs(params)
  }

  private fun emitPeers() {
    val count: Int
    val ids: Set<String>
    synchronized(peers) {
      // #238: count DISTINCT peers, not raw BLE addresses. Android rotates the BLE
      // MAC for privacy, so one physical phone shows up under many `peers` keys
      // within the TTL — `peers.size` overcounts (25+ for 2-3 phones). Dedup by the
      // advertised identity when known (collapses a phone's rotated MACs into one);
      // fall back to the address only for genuinely anonymous advertisers.
      val distinct = HashSet<String>()
      for ((addr, v) in peers) {
        distinct.add(if (v.second.isNotEmpty()) "id:" + v.second else "anon:" + addr)
      }
      count = distinct.size
      ids = peers.values.mapNotNull { it.second.ifEmpty { null } }.toSet()
    }
    if (count == lastEmittedCount && ids == lastEmittedIds) return
    lastEmittedCount = count
    lastEmittedIds = ids
    val idArr = Arguments.createArray()
    ids.forEach { idArr.pushString(it) }
    val params = Arguments.createMap().apply {
      putString("eventType", "peers")
      putInt("count", count)
      // #214: distinct non-anonymous ids currently heard — JS resolves to contacts.
      putArray("ids", idArr)
    }
    emitToJs(params)
  }

  private fun emitToJs(params: WritableMap) {
    val ctx = reactApplicationContext
    if (!ctx.hasActiveReactInstance()) {
      Log.w(TAG, "JS not alive; event dropped")
      return
    }
    ctx.getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
        .emit(JS_EVENT, params)
  }

  private fun missingPermission(): String? {
    val ctx = reactApplicationContext
    fun granted(p: String) =
        ContextCompat.checkSelfPermission(ctx, p) == PackageManager.PERMISSION_GRANTED
    return if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
      when {
        !granted(Manifest.permission.BLUETOOTH_ADVERTISE) -> "BLUETOOTH_ADVERTISE"
        !granted(Manifest.permission.BLUETOOTH_SCAN) -> "BLUETOOTH_SCAN"
        !granted(Manifest.permission.BLUETOOTH_CONNECT) -> "BLUETOOTH_CONNECT"
        else -> null
      }
    } else {
      // Pre-12: a BLE scan yields nothing without a location permission; advertising
      // is covered by the legacy BLUETOOTH_ADMIN manifest grant.
      if (!granted(Manifest.permission.ACCESS_FINE_LOCATION)) "ACCESS_FINE_LOCATION" else null
    }
  }

  private fun bluetoothAdapter(): BluetoothAdapter? {
    val mgr =
        reactApplicationContext.getSystemService(Context.BLUETOOTH_SERVICE) as? BluetoothManager
    return mgr?.adapter
  }

  override fun onCatalystInstanceDestroy() {
    super.onCatalystInstanceDestroy()
    handler.post { stopAllLocked() }
    handlerThread.quitSafely()
  }
}
