package com.logoschat

import android.Manifest
import android.annotation.SuppressLint
import android.bluetooth.BluetoothAdapter
import android.bluetooth.BluetoothDevice
import android.bluetooth.BluetoothGatt
import android.bluetooth.BluetoothGattCallback
import android.bluetooth.BluetoothGattCharacteristic
import android.bluetooth.BluetoothGattDescriptor
import android.bluetooth.BluetoothManager
import android.bluetooth.BluetoothProfile
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
import android.util.Log
import androidx.core.content.ContextCompat
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.WritableMap
import com.facebook.react.modules.core.DeviceEventManagerModule
import java.util.ArrayDeque
import java.util.UUID
import java.util.concurrent.atomic.AtomicBoolean

/**
 * MeshCore BLE companion — Phase 0 (issue #166).
 *
 * An Android BLE client for a paired MeshCore LoRa radio, spoken over the BLE
 * **Nordic-UART Service (NUS)**. This module lives entirely beside the Logos node
 * (see docs/mesh-transport.md "mirror, don't tunnel") — there is NO Rust / FFI /
 * bridge involvement here; it is pure Kotlin BLE + JS + UI.
 *
 * Phase 0 does only the radio *link*: scan → connect → MTU 512 → enable TX
 * notifications → CMD_APP_START → parse SELF_INFO (pubkey + advert name), plus
 * set-advert-name and send-self-advert. Channels, DMs and the group-mirror bridge
 * are Phases 1-2 and are intentionally absent.
 *
 * Event model mirrors [LogosChatModule]/[EventCallbackManager]: all events reach JS
 * on a single DeviceEventEmitter channel ("MeshCoreEvent"), each carrying an
 * `eventType`. Status changes → {eventType:"status", status}. Inbound protocol
 * frames → {eventType:"frame", resp, hex}.
 *
 * Threading: Android delivers GATT/scan callbacks on binder threads. We marshal
 * EVERY piece of connection + command-queue state onto one dedicated
 * HandlerThread ("meshcore-ble") so the queue and the GATT object are only ever
 * touched from a single thread (same discipline as EventCallbackManager's events
 * thread). Public @ReactMethods just post onto that handler.
 *
 * TODO(manifest): Phase 0 needs BLE runtime permissions that are NOT yet in
 *   AndroidManifest.xml (another agent owns app wiring; not edited here):
 *     - API 31+ (Android 12+): BLUETOOTH_SCAN (add `neverForLocation` if we never
 *       derive location) + BLUETOOTH_CONNECT.
 *     - API <=30: BLUETOOTH, BLUETOOTH_ADMIN, and ACCESS_FINE_LOCATION (a BLE scan
 *       returns no results without a granted location permission pre-12).
 *   Runtime *requesting* of these belongs in the JS/UI layer; this module only
 *   checks that they are granted and rejects clearly if not.
 */
class MeshCoreModule(reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext) {

  companion object {
    private const val TAG = "meshcore-ble"
    private const val JS_EVENT = "MeshCoreEvent"

    // -- BLE Nordic-UART Service (companion protocol transport) --------------
    private val NUS_SERVICE: UUID = UUID.fromString("6E400001-B5A3-F393-E0A9-E50E24DCCA9E")
    // RX = app → radio (we WRITE frames here).
    private val NUS_RX_WRITE: UUID = UUID.fromString("6E400002-B5A3-F393-E0A9-E50E24DCCA9E")
    // TX = radio → app (we enable NOTIFY and receive frames here).
    private val NUS_TX_NOTIFY: UUID = UUID.fromString("6E400003-B5A3-F393-E0A9-E50E24DCCA9E")
    // Standard Client Characteristic Configuration Descriptor.
    private val CCCD: UUID = UUID.fromString("00002902-0000-1000-8000-00805f9b34fb")

    private const val REQUEST_MTU = 512

    // -- Phase-0 companion command bytes (frame = [cmd byte][args…]) ----------
    private const val CMD_APP_START: Byte = 1
    private const val CMD_SEND_SELF_ADVERT: Byte = 7
    private const val CMD_SET_ADVERT_NAME: Byte = 8

    // Defined for completeness (docs/mesh-transport.md "MeshCore facts"); not yet
    // wired to a public method in Phase 0.
    @Suppress("unused") private const val CMD_DEVICE_QUERY: Byte = 22

    // -- Response codes -------------------------------------------------------
    // Reply to CMD_APP_START: carries the node's 32-byte Ed25519 pubkey + advert name.
    private const val RESP_CODE_SELF_INFO: Byte = 5

    private const val COMMAND_TIMEOUT_MS = 5_000L

    // Status strings (match the JS `MeshStatus` union).
    private const val STATUS_DISCONNECTED = "disconnected"
    private const val STATUS_CONNECTING = "connecting"
    private const val STATUS_CONNECTED = "connected"

    private const val PUBKEY_LEN = 32
  }

  override fun getName() = "MeshCore"

  // All connection state below is confined to [handler]'s thread.
  private val handlerThread = HandlerThread("meshcore-ble").apply { start() }
  private val handler = Handler(handlerThread.looper)

  @Volatile private var status: String = STATUS_DISCONNECTED

  private var gatt: BluetoothGatt? = null
  private var rxChar: BluetoothGattCharacteristic? = null
  private var txChar: BluetoothGattCharacteristic? = null
  private var scanner: BluetoothLeScanner? = null
  private var scanCallback: ScanCallback? = null

  /** The scanAndConnect promise, held until CMD_APP_START's SELF_INFO resolves it
   *  (or an early failure rejects it). Guarded so it settles exactly once. */
  private var connectPromise: SettleOnce? = null

  // -- command queue ---------------------------------------------------------

  /**
   * One in-flight protocol frame at a time. A command that expects a protocol
   * response (`expectedResp != null`) stays in-flight until a matching TX
   * notification arrives (or the 5 s timeout fires); a fire-and-forget write
   * (`expectedResp == null`) settles as soon as the BLE write is acknowledged.
   */
  private class Command(
      val frame: ByteArray,
      val expectedResp: Byte?,
      val settle: SettleOnce,
      /** Maps the full response frame → the value to resolve with. */
      val parse: ((ByteArray) -> Any?)? = null,
  )

  private val queue = ArrayDeque<Command>()
  private var inFlight: Command? = null
  private val timeoutRunnable = Runnable { onCommandTimeout() }

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

  // ==========================================================================
  //  Public @ReactMethods
  // ==========================================================================

  /**
   * Scan for a MeshCore radio advertising the NUS service, connect, negotiate
   * MTU 512, enable TX notifications, then send CMD_APP_START and resolve with the
   * parsed self-info JSON: `{"pubkeyHex":<64 hex>,"name":<string>}`.
   *
   * Rejects on: missing BLE permission, BT off, no adapter, scan timeout, or a
   * connection/discovery failure before SELF_INFO.
   */
  @ReactMethod
  fun scanAndConnect(promise: Promise) {
    handler.post {
      if (status != STATUS_DISCONNECTED) {
        promise.reject("busy", "already $status")
        return@post
      }
      val perm = missingPermission()
      if (perm != null) {
        promise.reject("permission", "missing runtime permission: $perm (see manifest TODO)")
        return@post
      }
      val adapter = bluetoothAdapter()
      if (adapter == null || !adapter.isEnabled) {
        promise.reject("bt_off", "Bluetooth is off or unavailable")
        return@post
      }
      val leScanner = adapter.bluetoothLeScanner
      if (leScanner == null) {
        promise.reject("no_scanner", "BLE scanner unavailable")
        return@post
      }
      connectPromise = SettleOnce(promise)
      setStatus(STATUS_CONNECTING)
      startScan(leScanner)
    }
  }

  @ReactMethod
  fun disconnect(promise: Promise) {
    handler.post {
      teardown("disconnect requested")
      promise.resolve(null)
    }
  }

  /** 'disconnected' | 'connecting' | 'connected'. */
  @ReactMethod
  fun getStatus(promise: Promise) {
    promise.resolve(status)
  }

  /**
   * Set the radio's broadcast advert label (`node_name`, decoupled from the
   * keypair — see docs/mesh-transport.md "Confirmed model"). Frame: [8][UTF-8 name].
   * Resolves once the write is acknowledged.
   */
  @ReactMethod
  fun setAdvertName(name: String, promise: Promise) {
    handler.post {
      if (status != STATUS_CONNECTED) {
        promise.reject("not_connected", "no radio connected")
        return@post
      }
      val nameBytes = name.toByteArray(Charsets.UTF_8)
      val frame = ByteArray(1 + nameBytes.size)
      frame[0] = CMD_SET_ADVERT_NAME
      System.arraycopy(nameBytes, 0, frame, 1, nameBytes.size)
      // TODO(hardware): confirm CMD_SET_ADVERT_NAME replies with RESP_CODE_OK; if
      //   so, switch expectedResp from null (write-ack) to that code so we surface
      //   real firmware acceptance rather than just BLE delivery.
      enqueue(Command(frame, expectedResp = null, settle = SettleOnce(promise)))
    }
  }

  /**
   * Broadcast a self-advert now (flood the mesh with our signed advert). Frame: [7].
   * Resolves once the write is acknowledged.
   */
  @ReactMethod
  fun sendSelfAdvert(promise: Promise) {
    handler.post {
      if (status != STATUS_CONNECTED) {
        promise.reject("not_connected", "no radio connected")
        return@post
      }
      // TODO(hardware): real firmware CMD_SEND_SELF_ADVERT may take a 1-byte flood
      //   flag (0=zero-hop, 1=flood). Confirm against companion_protocol.md; for now
      //   we send the bare command byte.
      enqueue(Command(byteArrayOf(CMD_SEND_SELF_ADVERT), expectedResp = null, settle = SettleOnce(promise)))
    }
  }

  // Required by the RN event-emitter contract; events flow via DeviceEventEmitter.
  @ReactMethod fun addListener(eventName: String) { /* no-op */ }

  @ReactMethod fun removeListeners(count: Double) { /* no-op */ }

  // ==========================================================================
  //  Scanning
  // ==========================================================================

  @SuppressLint("MissingPermission") // permission verified in scanAndConnect via missingPermission()
  private fun startScan(leScanner: BluetoothLeScanner) {
    scanner = leScanner
    val filters = listOf(ScanFilter.Builder().setServiceUuid(ParcelUuid(NUS_SERVICE)).build())
    val settings =
        ScanSettings.Builder().setScanMode(ScanSettings.SCAN_MODE_LOW_LATENCY).build()
    val cb =
        object : ScanCallback() {
          override fun onScanResult(callbackType: Int, result: ScanResult) {
            // Marshal onto our handler thread; take the first hit and connect.
            handler.post { onDeviceFound(result.device) }
          }

          override fun onScanFailed(errorCode: Int) {
            handler.post {
              Log.w(TAG, "scan failed: $errorCode")
              failConnect("scan_failed", "BLE scan failed ($errorCode)")
            }
          }
        }
    scanCallback = cb
    leScanner.startScan(filters, settings, cb)
    // Scan timeout: no radio in range.
    handler.postDelayed(scanTimeout, COMMAND_TIMEOUT_MS)
    Log.i(TAG, "scanning for NUS $NUS_SERVICE")
  }

  private val scanTimeout = Runnable {
    if (status == STATUS_CONNECTING && gatt == null) {
      failConnect("scan_timeout", "no MeshCore radio found")
    }
  }

  @SuppressLint("MissingPermission")
  private fun onDeviceFound(device: BluetoothDevice) {
    if (gatt != null) return // already connecting to one
    stopScan()
    handler.removeCallbacks(scanTimeout)
    Log.i(TAG, "found ${device.address}, connecting")
    gatt = device.connectGatt(reactApplicationContext, false, gattCallback, BluetoothDevice.TRANSPORT_LE)
  }

  @SuppressLint("MissingPermission")
  private fun stopScan() {
    val cb = scanCallback ?: return
    try {
      scanner?.stopScan(cb)
    } catch (t: Throwable) {
      Log.w(TAG, "stopScan: ${t.message}")
    }
    scanCallback = null
  }

  // ==========================================================================
  //  GATT callbacks — connect → discover → MTU → notify → APP_START
  // ==========================================================================

  private val gattCallback =
      object : BluetoothGattCallback() {
        override fun onConnectionStateChange(g: BluetoothGatt, statusCode: Int, newState: Int) {
          handler.post {
            when (newState) {
              BluetoothProfile.STATE_CONNECTED -> {
                Log.i(TAG, "GATT connected (status=$statusCode); discovering services")
                discoverServices(g)
              }
              BluetoothProfile.STATE_DISCONNECTED -> {
                Log.i(TAG, "GATT disconnected (status=$statusCode)")
                // If we never reached CONNECTED, fail the connect promise.
                failConnect("disconnected", "radio disconnected (status=$statusCode)")
                teardown("gatt disconnected")
              }
            }
          }
        }

        override fun onServicesDiscovered(g: BluetoothGatt, statusCode: Int) {
          handler.post {
            if (statusCode != BluetoothGatt.GATT_SUCCESS) {
              failConnect("discover_failed", "service discovery failed ($statusCode)")
              return@post
            }
            val service = g.getService(NUS_SERVICE)
            if (service == null) {
              failConnect("no_nus", "NUS service not found on device")
              return@post
            }
            rxChar = service.getCharacteristic(NUS_RX_WRITE)
            txChar = service.getCharacteristic(NUS_TX_NOTIFY)
            if (rxChar == null || txChar == null) {
              failConnect("no_chars", "NUS RX/TX characteristics missing")
              return@post
            }
            requestMtu(g)
          }
        }

        override fun onMtuChanged(g: BluetoothGatt, mtu: Int, statusCode: Int) {
          handler.post {
            Log.i(TAG, "MTU=$mtu (status=$statusCode)")
            // Proceed regardless: a failed MTU bump just means smaller frames, and
            // Phase-0 frames are tiny. Enable TX notifications next.
            enableTxNotifications(g)
          }
        }

        override fun onDescriptorWrite(
            g: BluetoothGatt,
            descriptor: BluetoothGattDescriptor,
            statusCode: Int,
        ) {
          handler.post {
            if (descriptor.uuid == CCCD) {
              if (statusCode != BluetoothGatt.GATT_SUCCESS) {
                failConnect("notify_failed", "could not enable TX notifications ($statusCode)")
                return@post
              }
              // Notifications live: the link is up. Kick off CMD_APP_START, whose
              // SELF_INFO reply resolves the scanAndConnect promise.
              setStatus(STATUS_CONNECTED)
              sendAppStart()
            }
          }
        }

        override fun onCharacteristicWrite(
            g: BluetoothGatt,
            characteristic: BluetoothGattCharacteristic,
            statusCode: Int,
        ) {
          handler.post { onWriteComplete(statusCode == BluetoothGatt.GATT_SUCCESS, statusCode) }
        }

        // Notification path — API 33+ delivers the value explicitly.
        override fun onCharacteristicChanged(
            g: BluetoothGatt,
            characteristic: BluetoothGattCharacteristic,
            value: ByteArray,
        ) {
          handler.post { onFrameReceived(value) }
        }

        // Deprecated pre-33 notification path — read the characteristic's value.
        @Deprecated("Deprecated in API 33")
        @Suppress("DEPRECATION")
        override fun onCharacteristicChanged(
            g: BluetoothGatt,
            characteristic: BluetoothGattCharacteristic,
        ) {
          val value = characteristic.value ?: return
          handler.post { onFrameReceived(value) }
        }
      }

  @SuppressLint("MissingPermission")
  private fun discoverServices(g: BluetoothGatt) {
    if (!g.discoverServices()) failConnect("discover_failed", "discoverServices() returned false")
  }

  @SuppressLint("MissingPermission")
  private fun requestMtu(g: BluetoothGatt) {
    if (!g.requestMtu(REQUEST_MTU)) {
      // MTU request could not even be issued — proceed with default MTU.
      Log.w(TAG, "requestMtu() returned false; continuing with default MTU")
      enableTxNotifications(g)
    }
  }

  @SuppressLint("MissingPermission")
  private fun enableTxNotifications(g: BluetoothGatt) {
    val tx = txChar
    if (tx == null) {
      failConnect("no_chars", "TX characteristic missing")
      return
    }
    if (!g.setCharacteristicNotification(tx, true)) {
      failConnect("notify_failed", "setCharacteristicNotification() failed")
      return
    }
    val cccd = tx.getDescriptor(CCCD)
    if (cccd == null) {
      failConnect("no_cccd", "TX characteristic has no CCCD")
      return
    }
    val enable = BluetoothGattDescriptor.ENABLE_NOTIFICATION_VALUE
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
      g.writeDescriptor(cccd, enable)
    } else {
      @Suppress("DEPRECATION")
      run {
        cccd.value = enable
        g.writeDescriptor(cccd)
      }
    }
  }

  /** Internal: send CMD_APP_START, expecting RESP_CODE_SELF_INFO to resolve connect. */
  private fun sendAppStart() {
    val settle = connectPromise
    if (settle == null) {
      Log.w(TAG, "sendAppStart with no pending connect promise")
      return
    }
    // CMD_APP_START must be >= 8 bytes or the firmware ignores it (verified against
    // MyMesh.cpp: `cmd_frame[0]==CMD_APP_START && len >= 8`). Layout:
    //   [0x01][7 reserved bytes][UTF-8 app name]. Firmware replies RESP_CODE_SELF_INFO.
    val appStart =
        byteArrayOf(CMD_APP_START, 0, 0, 0, 0, 0, 0, 0) + "logos".toByteArray(Charsets.UTF_8)
    enqueue(
        Command(
            frame = appStart,
            expectedResp = RESP_CODE_SELF_INFO,
            settle = settle,
            parse = { frame -> parseSelfInfo(frame) },
        ))
    // The connect promise is now owned by the command; clear the field so a later
    // failure path can't double-settle it.
    connectPromise = null
  }

  // ==========================================================================
  //  Command queue mechanics
  // ==========================================================================

  private fun enqueue(cmd: Command) {
    queue.add(cmd)
    drain()
  }

  @SuppressLint("MissingPermission")
  private fun drain() {
    if (inFlight != null) return
    val next = queue.poll() ?: return
    val g = gatt
    val rx = rxChar
    if (g == null || rx == null) {
      next.settle.reject("not_connected", "no radio connected")
      drain()
      return
    }
    inFlight = next
    writeFrame(g, rx, next.frame)
    handler.postDelayed(timeoutRunnable, COMMAND_TIMEOUT_MS)
  }

  @SuppressLint("MissingPermission")
  private fun writeFrame(g: BluetoothGatt, rx: BluetoothGattCharacteristic, frame: ByteArray) {
    // Prefer write-with-response when the characteristic supports it; NUS RX is
    // sometimes write-without-response only.
    val writeType =
        if (rx.properties and BluetoothGattCharacteristic.PROPERTY_WRITE != 0)
            BluetoothGattCharacteristic.WRITE_TYPE_DEFAULT
        else BluetoothGattCharacteristic.WRITE_TYPE_NO_RESPONSE
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
      g.writeCharacteristic(rx, frame, writeType)
    } else {
      @Suppress("DEPRECATION")
      run {
        rx.writeType = writeType
        rx.value = frame
        g.writeCharacteristic(rx)
      }
    }
  }

  private fun onWriteComplete(ok: Boolean, statusCode: Int) {
    val cmd = inFlight ?: return
    if (!ok) {
      handler.removeCallbacks(timeoutRunnable)
      cmd.settle.reject("write_failed", "BLE write failed ($statusCode)")
      finishInFlight()
      return
    }
    // Fire-and-forget commands settle on the write-ack; response-expecting commands
    // stay in-flight until a matching TX notification arrives.
    if (cmd.expectedResp == null) {
      handler.removeCallbacks(timeoutRunnable)
      cmd.settle.resolve(null)
      finishInFlight()
    }
  }

  private fun onFrameReceived(frame: ByteArray) {
    if (frame.isEmpty()) return
    val resp = frame[0]
    // Always surface the inbound frame to JS (async pushes have no in-flight match).
    emitFrame(resp, frame)

    val cmd = inFlight
    if (cmd != null && cmd.expectedResp != null && cmd.expectedResp == resp) {
      handler.removeCallbacks(timeoutRunnable)
      try {
        val value = cmd.parse?.invoke(frame)
        cmd.settle.resolve(value)
      } catch (t: Throwable) {
        cmd.settle.reject("parse_failed", "could not parse response: ${t.message}")
      }
      finishInFlight()
    }
  }

  private fun onCommandTimeout() {
    val cmd = inFlight ?: return
    Log.w(TAG, "command timed out (cmd=${cmd.frame.firstOrNull()})")
    cmd.settle.reject("timeout", "no response within ${COMMAND_TIMEOUT_MS}ms")
    finishInFlight()
  }

  private fun finishInFlight() {
    inFlight = null
    drain()
  }

  // ==========================================================================
  //  Parsing
  // ==========================================================================

  /**
   * Parse a RESP_CODE_SELF_INFO frame → JSON `{"pubkeyHex":…,"name":…}`.
   *
   * TODO(hardware): the exact byte offsets of SELF_INFO fields are NOT fully pinned.
   *   Per docs/mesh-transport.md we parse DEFENSIVELY: after the leading resp-code
   *   byte, the pubkey is taken as the first 32 bytes and the advert name as the
   *   trailing UTF-8. Real firmware SELF_INFO also carries adv_type / tx_power /
   *   radio params AHEAD of the pubkey — confirm the true layout against
   *   companion_protocol.md when a radio is available and adjust the offsets.
   */
  private fun parseSelfInfo(frame: ByteArray): String {
    // Verified layout (MyMesh.cpp / companion_protocol.md PACKET_SELF_INFO):
    //   [0]=0x05 [1]=adv_type [2]=tx_power [3]=max_tx_power
    //   [4..35]=pubkey(32) [36..43]=lat/lon [44..47]=flags [48..55]=freq/bw
    //   [56]=sf [57]=cr [58..]=device name (UTF-8, variable, no terminator).
    val pubkeyOffset = 4
    val nameOffset = 58
    val pubkeyHex =
        if (frame.size >= pubkeyOffset + PUBKEY_LEN)
            frame.copyOfRange(pubkeyOffset, pubkeyOffset + PUBKEY_LEN).toHex()
        else ""
    val name =
        if (frame.size > nameOffset)
            String(frame.copyOfRange(nameOffset, frame.size), Charsets.UTF_8)
                .trim()
                .filter { it >= ' ' }
        else ""
    val obj = org.json.JSONObject()
    obj.put("pubkeyHex", pubkeyHex)
    obj.put("name", name)
    return obj.toString()
  }

  // ==========================================================================
  //  Status + event emission
  // ==========================================================================

  private fun setStatus(next: String) {
    if (status == next) return
    status = next
    val params =
        Arguments.createMap().apply {
          putString("eventType", "status")
          putString("status", next)
        }
    emitToJs(params)
  }

  private fun emitFrame(resp: Byte, frame: ByteArray) {
    val params =
        Arguments.createMap().apply {
          putString("eventType", "frame")
          putInt("resp", resp.toInt() and 0xFF)
          putString("hex", frame.toHex())
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

  // ==========================================================================
  //  Teardown + helpers
  // ==========================================================================

  private fun failConnect(code: String, message: String) {
    connectPromise?.reject(code, message)
    connectPromise = null
  }

  @SuppressLint("MissingPermission")
  private fun teardown(reason: String) {
    Log.i(TAG, "teardown: $reason")
    handler.removeCallbacks(timeoutRunnable)
    handler.removeCallbacks(scanTimeout)
    stopScan()
    // Reject any still-pending commands so JS promises don't hang.
    inFlight?.settle?.reject("disconnected", "radio disconnected")
    inFlight = null
    while (true) {
      val c = queue.poll() ?: break
      c.settle.reject("disconnected", "radio disconnected")
    }
    try {
      gatt?.disconnect()
      gatt?.close()
    } catch (t: Throwable) {
      Log.w(TAG, "gatt close: ${t.message}")
    }
    gatt = null
    rxChar = null
    txChar = null
    setStatus(STATUS_DISCONNECTED)
  }

  private fun bluetoothAdapter(): BluetoothAdapter? {
    val mgr =
        reactApplicationContext.getSystemService(Context.BLUETOOTH_SERVICE) as? BluetoothManager
    return mgr?.adapter
  }

  /** Returns the name of a missing runtime permission, or null if all are granted. */
  private fun missingPermission(): String? {
    val ctx = reactApplicationContext
    fun granted(p: String) =
        ContextCompat.checkSelfPermission(ctx, p) == PackageManager.PERMISSION_GRANTED
    return if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
      when {
        !granted(Manifest.permission.BLUETOOTH_SCAN) -> "BLUETOOTH_SCAN"
        !granted(Manifest.permission.BLUETOOTH_CONNECT) -> "BLUETOOTH_CONNECT"
        else -> null
      }
    } else {
      // Pre-12: a BLE scan yields nothing without a location permission.
      if (!granted(Manifest.permission.ACCESS_FINE_LOCATION)) "ACCESS_FINE_LOCATION" else null
    }
  }

  private fun ByteArray.toHex(): String {
    val sb = StringBuilder(size * 2)
    for (b in this) {
      val v = b.toInt() and 0xFF
      sb.append("0123456789abcdef"[v ushr 4])
      sb.append("0123456789abcdef"[v and 0x0F])
    }
    return sb.toString()
  }
}
