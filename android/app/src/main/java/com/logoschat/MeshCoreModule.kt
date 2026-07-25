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

    // -- Phase-1 CHANNEL command bytes (MyMesh.cpp #defines, verified) ---------
    // MyMesh.cpp:8  CMD_SEND_CHANNEL_TXT_MSG  3
    private const val CMD_SEND_CHANNEL_TXT_MSG: Byte = 3
    // MyMesh.cpp:15 CMD_SYNC_NEXT_MESSAGE     10
    private const val CMD_SYNC_NEXT_MESSAGE: Byte = 10
    // MyMesh.cpp:36 CMD_GET_CHANNEL           31 (0x1F)
    private const val CMD_GET_CHANNEL: Byte = 31
    // MyMesh.cpp:37 CMD_SET_CHANNEL           32 (0x20)
    private const val CMD_SET_CHANNEL: Byte = 32

    // Defined for completeness (docs/mesh-transport.md "MeshCore facts"); not yet
    // wired to a public method in Phase 0.
    @Suppress("unused") private const val CMD_DEVICE_QUERY: Byte = 22

    // -- Response codes (MyMesh.cpp RESP_CODE_* / PUSH_CODE_* #defines) --------
    // Reply to CMD_APP_START: carries the node's 32-byte Ed25519 pubkey + advert name.
    private const val RESP_CODE_SELF_INFO: Byte = 5

    // MyMesh.cpp:71 RESP_CODE_OK 0  — reply to CMD_SET_CHANNEL and CMD_SEND_CHANNEL_TXT_MSG
    // (firmware calls writeOKFrame() for both; see MyMesh.cpp:1132 / :1708).
    private const val RESP_CODE_OK: Int = 0
    // MyMesh.cpp:72 RESP_CODE_ERR 1  — [0x01][err_code]; ends an in-flight command early.
    private const val RESP_CODE_ERR: Int = 1
    // MyMesh.cpp:77 RESP_CODE_SENT 6  — accepted as an alt success for channel-text (doc variant).
    private const val RESP_CODE_SENT: Int = 6
    // MyMesh.cpp:79/87/88 message-recv frames returned by CMD_SYNC_NEXT_MESSAGE.
    private const val RESP_CODE_CONTACT_MSG_RECV: Int = 7
    private const val RESP_CODE_CHANNEL_MSG_RECV: Int = 8 // 0x08 (app_target_ver < 3)
    private const val RESP_CODE_NO_MORE_MESSAGES: Int = 10
    private const val RESP_CODE_CONTACT_MSG_RECV_V3: Int = 16
    private const val RESP_CODE_CHANNEL_MSG_RECV_V3: Int = 17 // 0x11 (app_target_ver >= 3)
    // MyMesh.cpp:89 RESP_CODE_CHANNEL_INFO 18 (0x12) — reply to CMD_GET_CHANNEL.
    private const val RESP_CODE_CHANNEL_INFO: Int = 18
    // MyMesh.cpp:98 RESP_CODE_CHANNEL_DATA_RECV 27 (0x1B) — inbound datagram (drained, not surfaced here).
    private const val RESP_CODE_CHANNEL_DATA_RECV: Int = 27
    // MyMesh.cpp:115 PUSH_CODE_MSG_WAITING 0x83 — async "messages queued" tickle → auto sync-drain.
    private const val PUSH_CODE_MSG_WAITING: Byte = 0x83.toByte()

    // Responses that can conclude a CMD_SYNC_NEXT_MESSAGE (any one frame per SYNC).
    private val SYNC_RESP_CODES =
        setOf(
            RESP_CODE_NO_MORE_MESSAGES,
            RESP_CODE_CHANNEL_MSG_RECV,
            RESP_CODE_CHANNEL_MSG_RECV_V3,
            RESP_CODE_CONTACT_MSG_RECV,
            RESP_CODE_CONTACT_MSG_RECV_V3,
            RESP_CODE_CHANNEL_DATA_RECV,
        )

    // Channel field widths (MyMesh.cpp:1688-1693 / :1700-1705).
    private const val TXT_TYPE_PLAIN: Byte = 0 // MyMesh.cpp TXT_TYPE_PLAIN
    private const val CHANNEL_NAME_LEN = 32
    private const val CHANNEL_SECRET_LEN = 16 // 128-bit; 32-byte secret is unsupported (MyMesh.cpp:1698)
    // Safety cap on the getChannels slot walk. MAX_GROUP_CHANNELS is build-specific
    // (1..40 across variants), so we walk until the firmware returns ERR_CODE_NOT_FOUND
    // for an out-of-range idx; this bound just prevents a runaway if that never comes.
    private const val MAX_CHANNEL_SLOTS = 64

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
   * One in-flight protocol frame at a time.
   *
   * A command that expects a protocol response (`expectedResps != null`) stays
   * in-flight until a matching TX notification arrives, the firmware answers
   * `RESP_CODE_ERR`, or the 5 s timeout fires. A fire-and-forget write
   * (`expectedResps == null`) completes as soon as the BLE write is acknowledged.
   *
   * Outcome is delivered exactly once — either [onResponse] (with the matched
   * frame, or `null` for a fire-and-forget write-ack) or [onFailure]. The
   * callback may enqueue follow-up commands (used by the getChannels slot-walk
   * and the sync drain loop), which the queue serialises behind the single
   * in-flight slot.
   */
  private class Command(
      val frame: ByteArray,
      /** Resp codes (0-255) that complete this command; null = fire-and-forget. */
      val expectedResps: Set<Int>?,
      val onResponse: (ByteArray?) -> Unit,
      val onFailure: (code: String, message: String) -> Unit,
  )

  private val queue = ArrayDeque<Command>()
  private var inFlight: Command? = null
  private val timeoutRunnable = Runnable { onCommandTimeout() }

  /** True while a sync drain loop is active (confined to [handler]'s thread). */
  private var syncing = false

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
      //   so, switch expectedResps from null (write-ack) to that code so we surface
      //   real firmware acceptance rather than just BLE delivery.
      val settle = SettleOnce(promise)
      enqueue(
          Command(
              frame = frame,
              expectedResps = null,
              onResponse = { settle.resolve(null) },
              onFailure = { code, message -> settle.reject(code, message) },
          ))
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
      val settle = SettleOnce(promise)
      enqueue(
          Command(
              frame = byteArrayOf(CMD_SEND_SELF_ADVERT),
              expectedResps = null,
              onResponse = { settle.resolve(null) },
              onFailure = { code, message -> settle.reject(code, message) },
          ))
    }
  }

  /**
   * Enumerate the radio's channel slots and resolve with a JSON array of the
   * OCCUPIED ones: `[{"idx":n,"name":str,"secretHex":<32 hex>}]`.
   *
   * Walks slot indices from 0 upward with CMD_GET_CHANNEL. The firmware's
   * getChannel() returns RESP_CODE_CHANNEL_INFO for every in-range slot (empty
   * slots included — name empty + all-zero secret), and RESP_CODE_ERR
   * (ERR_CODE_NOT_FOUND) once the index is past MAX_GROUP_CHANNELS. We collect
   * occupied slots and stop at the first ERR (or timeout / cap).
   */
  @ReactMethod
  fun getChannels(promise: Promise) {
    handler.post {
      if (status != STATUS_CONNECTED) {
        promise.reject("not_connected", "no radio connected")
        return@post
      }
      val settle = SettleOnce(promise)
      val results = org.json.JSONArray()
      requestChannelSlot(0, results, settle)
    }
  }

  /**
   * Create or overwrite a channel slot. `secretHex` = 32 hex chars → the 16-byte
   * (128-bit) channel secret. Frame (MyMesh.cpp:1700-1705):
   *   [0x20][idx][name: 32 bytes UTF-8 null-padded][secret: 16 bytes] (50 bytes total).
   * Resolves on RESP_CODE_OK (firmware saveChannels()+writeOKFrame, MyMesh.cpp:1708).
   */
  @ReactMethod
  fun setChannel(idx: Int, name: String, secretHex: String, promise: Promise) {
    handler.post {
      if (status != STATUS_CONNECTED) {
        promise.reject("not_connected", "no radio connected")
        return@post
      }
      val secret = hexToBytes(secretHex)
      if (secret == null || secret.size != CHANNEL_SECRET_LEN) {
        promise.reject("bad_secret", "secretHex must be 32 hex chars (16 bytes)")
        return@post
      }
      val frame = ByteArray(2 + CHANNEL_NAME_LEN + CHANNEL_SECRET_LEN)
      frame[0] = CMD_SET_CHANNEL
      frame[1] = idx.toByte()
      val nameBytes = name.toByteArray(Charsets.UTF_8)
      // Truncate over-long names to the 32-byte field; the tail stays null-padded.
      val nlen = minOf(nameBytes.size, CHANNEL_NAME_LEN)
      System.arraycopy(nameBytes, 0, frame, 2, nlen)
      System.arraycopy(secret, 0, frame, 2 + CHANNEL_NAME_LEN, CHANNEL_SECRET_LEN)
      val settle = SettleOnce(promise)
      enqueue(
          Command(
              frame = frame,
              expectedResps = setOf(RESP_CODE_OK),
              onResponse = { settle.resolve(null) },
              onFailure = { code, message -> settle.reject(code, message) },
          ))
    }
  }

  /**
   * Send a plain-text message to a channel slot. Frame (MyMesh.cpp:1117-1124):
   *   [0x03][txt_type=0][chan_idx][timestamp: 4 LE seconds][UTF-8 text].
   *
   * verify: firmware answers writeOKFrame (RESP_CODE_OK) on success
   * (MyMesh.cpp:1132), NOT RESP_CODE_SENT as companion_protocol.md §5 claims — we
   * accept EITHER so both the source and the doc variant resolve.
   */
  @ReactMethod
  fun sendChannelText(idx: Int, text: String, promise: Promise) {
    handler.post {
      if (status != STATUS_CONNECTED) {
        promise.reject("not_connected", "no radio connected")
        return@post
      }
      val textBytes = text.toByteArray(Charsets.UTF_8)
      val frame = ByteArray(3 + 4 + textBytes.size)
      frame[0] = CMD_SEND_CHANNEL_TXT_MSG
      frame[1] = TXT_TYPE_PLAIN
      frame[2] = idx.toByte()
      val ts = (System.currentTimeMillis() / 1000L).toInt()
      frame[3] = (ts and 0xFF).toByte()
      frame[4] = ((ts ushr 8) and 0xFF).toByte()
      frame[5] = ((ts ushr 16) and 0xFF).toByte()
      frame[6] = ((ts ushr 24) and 0xFF).toByte()
      System.arraycopy(textBytes, 0, frame, 7, textBytes.size)
      val settle = SettleOnce(promise)
      enqueue(
          Command(
              frame = frame,
              expectedResps = setOf(RESP_CODE_OK, RESP_CODE_SENT),
              onResponse = { settle.resolve(null) },
              onFailure = { code, message -> settle.reject(code, message) },
          ))
    }
  }

  /**
   * Drain all messages queued on the radio: loop CMD_SYNC_NEXT_MESSAGE until
   * RESP_CODE_NO_MORE_MESSAGES, emitting a `channelMessage` event for each channel
   * message frame. Resolves once the drain completes.
   */
  @ReactMethod
  fun syncMessages(promise: Promise) {
    handler.post {
      if (status != STATUS_CONNECTED) {
        promise.reject("not_connected", "no radio connected")
        return@post
      }
      startSyncDrain(SettleOnce(promise))
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
            expectedResps = setOf(RESP_CODE_SELF_INFO.toInt() and 0xFF),
            onResponse = { frame -> settle.resolve(parseSelfInfo(frame!!)) },
            onFailure = { code, message -> settle.reject(code, message) },
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
      next.onFailure("not_connected", "no radio connected")
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
      completeInFlight { cmd.onFailure("write_failed", "BLE write failed ($statusCode)") }
      return
    }
    // Fire-and-forget commands complete on the write-ack; response-expecting
    // commands stay in-flight until a matching TX notification arrives.
    if (cmd.expectedResps == null) {
      completeInFlight { cmd.onResponse(null) }
    }
  }

  private fun onFrameReceived(frame: ByteArray) {
    if (frame.isEmpty()) return
    val resp = frame[0]
    val code = resp.toInt() and 0xFF
    // Always surface the inbound frame to JS (async pushes have no in-flight match).
    emitFrame(resp, frame)

    val cmd = inFlight
    if (cmd != null && cmd.expectedResps != null) {
      if (cmd.expectedResps.contains(code)) {
        completeInFlight {
          try {
            cmd.onResponse(frame)
          } catch (t: Throwable) {
            cmd.onFailure("parse_failed", "could not parse response: ${t.message}")
          }
        }
        return
      }
      // A firmware error ends the in-flight command early rather than hanging to
      // timeout (unless the command explicitly expects RESP_CODE_ERR).
      if (code == RESP_CODE_ERR) {
        val errCode = if (frame.size >= 2) frame[1].toInt() and 0xFF else -1
        completeInFlight { cmd.onFailure("firmware_error", "firmware error code $errCode") }
        return
      }
    }

    // Unsolicited async push: messages are queued on the radio → kick a sync drain.
    if (resp == PUSH_CODE_MSG_WAITING) {
      startSyncDrain(null)
    }
  }

  private fun onCommandTimeout() {
    val cmd = inFlight ?: return
    Log.w(TAG, "command timed out (cmd=${cmd.frame.firstOrNull()})")
    completeInFlight { cmd.onFailure("timeout", "no response within ${COMMAND_TIMEOUT_MS}ms") }
  }

  /**
   * Clear the in-flight slot and its timeout, deliver the outcome, then start the
   * next queued command. [deliver] runs with no command in-flight, so it may
   * enqueue follow-ups (slot-walk / sync drain) that the queue serialises.
   */
  private fun completeInFlight(deliver: () -> Unit) {
    handler.removeCallbacks(timeoutRunnable)
    inFlight = null
    deliver()
    drain()
  }

  // ==========================================================================
  //  Channel slot walk (getChannels) + message sync drain
  // ==========================================================================

  /**
   * One step of the getChannels walk: request slot [idx], and on the reply either
   * collect an occupied channel and recurse to [idx]+1, or (on ERR/timeout/cap)
   * resolve [settle] with the accumulated JSON array.
   */
  private fun requestChannelSlot(idx: Int, results: org.json.JSONArray, settle: SettleOnce) {
    if (idx >= MAX_CHANNEL_SLOTS) {
      settle.resolve(results.toString())
      return
    }
    enqueue(
        Command(
            frame = byteArrayOf(CMD_GET_CHANNEL, idx.toByte()),
            expectedResps = setOf(RESP_CODE_CHANNEL_INFO),
            onResponse = { frame ->
              val ch = frame?.let { parseChannelInfo(it) }
              if (ch != null) results.put(ch)
              requestChannelSlot(idx + 1, results, settle)
            },
            // ERR_CODE_NOT_FOUND (idx past MAX_GROUP_CHANNELS) or timeout = end of slots.
            onFailure = { _, _ -> settle.resolve(results.toString()) },
        ))
  }

  /**
   * Parse a RESP_CODE_CHANNEL_INFO frame (MyMesh.cpp:1688-1693):
   *   [0]=0x12 [1]=idx [2..33]=name(32, null-padded) [34..49]=secret(16).
   * Returns a JSON object for an OCCUPIED slot, or null for an empty slot
   * (empty name AND all-zero secret) / a malformed frame.
   */
  private fun parseChannelInfo(frame: ByteArray): org.json.JSONObject? {
    if (frame.size < 2 + CHANNEL_NAME_LEN + CHANNEL_SECRET_LEN) return null
    val idx = frame[1].toInt() and 0xFF
    val nameField = frame.copyOfRange(2, 2 + CHANNEL_NAME_LEN)
    val nul = nameField.indexOf(0.toByte())
    val nameEnd = if (nul < 0) nameField.size else nul
    val name = String(nameField, 0, nameEnd, Charsets.UTF_8)
    val secret = frame.copyOfRange(2 + CHANNEL_NAME_LEN, 2 + CHANNEL_NAME_LEN + CHANNEL_SECRET_LEN)
    val occupied = name.isNotEmpty() || secret.any { it.toInt() != 0 }
    if (!occupied) return null
    return org.json.JSONObject().apply {
      put("idx", idx)
      put("name", name)
      put("secretHex", secret.toHex())
    }
  }

  /**
   * Begin (or, if one is already running, coalesce into) a sync drain. [settle] is
   * resolved when the drain reaches RESP_CODE_NO_MORE_MESSAGES (or stops on a
   * timeout/error); pass null for the push-triggered auto-drain.
   */
  private fun startSyncDrain(settle: SettleOnce?) {
    if (status != STATUS_CONNECTED) {
      settle?.reject("not_connected", "no radio connected")
      return
    }
    // A running drain already pulls every queued message, so a second request just
    // rides on it (resolve immediately rather than stacking a parallel loop).
    if (syncing) {
      settle?.resolve(null)
      return
    }
    syncing = true
    syncStep(settle)
  }

  /** One CMD_SYNC_NEXT_MESSAGE step; recurses until the queue drains. */
  private fun syncStep(settle: SettleOnce?) {
    enqueue(
        Command(
            frame = byteArrayOf(CMD_SYNC_NEXT_MESSAGE),
            expectedResps = SYNC_RESP_CODES,
            onResponse = { frame ->
              val code = frame?.firstOrNull()?.toInt()?.and(0xFF) ?: RESP_CODE_NO_MORE_MESSAGES
              if (code == RESP_CODE_NO_MORE_MESSAGES) {
                syncing = false
                settle?.resolve(null)
              } else {
                if (code == RESP_CODE_CHANNEL_MSG_RECV || code == RESP_CODE_CHANNEL_MSG_RECV_V3) {
                  emitChannelMessage(frame!!)
                }
                // Contact messages / channel datagrams are drained but not surfaced here.
                syncStep(settle)
              }
            },
            onFailure = { _, _ ->
              // Timeout or firmware error mid-drain: stop cleanly.
              syncing = false
              settle?.resolve(null)
            },
        ))
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

  /**
   * Parse a channel-message frame and emit a `channelMessage` event.
   *
   * Layouts (MyMesh.cpp:542-566):
   *   v<3 (0x08): [0]=0x08 [1]=chan_idx [2]=path_len [3]=txt_type [4..7]=ts(4 LE) [8..]=text
   *   v3  (0x11): [0]=0x11 [1]=snr [2..3]=reserved [4]=chan_idx [5]=path_len [6]=txt_type
   *               [7..10]=ts(4 LE) [11..]=text
   * The plaintext is `"<sender name>: <text>"` (payloads.md §Group text message) —
   * split on the first ": " into fromName/text.
   */
  private fun emitChannelMessage(frame: ByteArray) {
    val v3 = (frame[0].toInt() and 0xFF) == RESP_CODE_CHANNEL_MSG_RECV_V3
    // Skip: resp code (+ snr + 2 reserved for v3), then channel_idx, path_len, txt_type.
    val base = if (v3) 4 else 1
    val tsOff = base + 3
    if (frame.size < tsOff + 4) return
    val channelIdx = frame[base].toInt() and 0xFF
    val ts =
        ((frame[tsOff].toInt() and 0xFF).toLong()) or
            ((frame[tsOff + 1].toInt() and 0xFF).toLong() shl 8) or
            ((frame[tsOff + 2].toInt() and 0xFF).toLong() shl 16) or
            ((frame[tsOff + 3].toInt() and 0xFF).toLong() shl 24)
    val textStart = tsOff + 4
    val raw =
        if (frame.size > textStart)
            String(frame, textStart, frame.size - textStart, Charsets.UTF_8)
        else ""
    val sep = raw.indexOf(": ")
    val fromName = if (sep >= 0) raw.substring(0, sep) else ""
    val text = if (sep >= 0) raw.substring(sep + 2) else raw
    val params =
        Arguments.createMap().apply {
          putString("eventType", "channelMessage")
          putInt("channelIdx", channelIdx)
          putString("fromName", fromName)
          putString("text", text)
          // ts is seconds → ms. Kept as Double (JS number) to survive the RN bridge.
          putDouble("at", ts * 1000.0)
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
    syncing = false
    // Reject any still-pending commands so JS promises don't hang.
    inFlight?.onFailure?.invoke("disconnected", "radio disconnected")
    inFlight = null
    while (true) {
      val c = queue.poll() ?: break
      c.onFailure("disconnected", "radio disconnected")
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

  /** Decode an even-length hex string to bytes, or null if malformed. */
  private fun hexToBytes(hex: String): ByteArray? {
    if (hex.length % 2 != 0) return null
    val out = ByteArray(hex.length / 2)
    for (i in out.indices) {
      val hi = Character.digit(hex[i * 2], 16)
      val lo = Character.digit(hex[i * 2 + 1], 16)
      if (hi < 0 || lo < 0) return null
      out[i] = ((hi shl 4) or lo).toByte()
    }
    return out
  }
}
