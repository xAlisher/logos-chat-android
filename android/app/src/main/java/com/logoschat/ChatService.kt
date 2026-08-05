package com.logoschat

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.Handler
import android.os.HandlerThread
import android.os.IBinder
import android.util.Log
import androidx.core.app.NotificationCompat

/**
 * Foreground service (type dataSync, START_STICKY) — keeps the process (and so
 * the embedded node + persist-before-forward pipeline) alive while the app is
 * backgrounded / screen-off / swiped away. Ported from booth-android
 * BroadcastService (docs/architecture.md §2.1).
 *
 * Periodic status refresh runs on a native ScheduledExecutor INSIDE the service
 * — JS timers throttle in background and getNativeModule is NULL under
 * Bridgeless (booth's BoothBroadcastModule lesson), so nothing here may route
 * through RN.
 */
class ChatService : Service() {

  override fun onBind(intent: Intent?): IBinder? = null

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    createChannel()
    // startForeground MUST post immediately — build directly (records the baseline snapshot
    // so later identical updates are suppressed). No periodic poll: updates are change-driven.
    val notif = buildNotification(this)
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
      startForeground(NOTIF_ID, notif, ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC)
    } else {
      startForeground(NOTIF_ID, notif)
    }
    running = true
    fgStartedElapsed = android.os.SystemClock.elapsedRealtime() // #381: track dataSync duration
    timedOut = false // a fresh (foreground) start clears any prior timeout
    // START_STICKY redelivery after process death: JS is gone — restart the
    // node natively from the stored config (fresh epoch by design).
    NodeRuntime.autoRestartIfWanted()
    Log.i(TAG, "ChatService foregrounded (dataSync, sticky)")
    return START_STICKY
  }

  override fun onDestroy() {
    running = false
    notifHandler.removeCallbacks(refreshRunnable)
    notifState.reset()
    Log.i(TAG, "ChatService destroyed")
    super.onDestroy()
  }

  // #381: Android 15+ (API 35) caps a dataSync FGS at ~6h/day. When the OS times it out it calls
  // onTimeout — we MUST stop the foreground service promptly (data is already durable via the
  // persist-before-forward pipeline) and tell the user how to resume, and NEVER retry a
  // now-forbidden background FGS start. Both overloads (API 34 shortService / API 35 typed)
  // funnel into the same handler. stopSelf() also defeats the START_STICKY restart loop.
  override fun onTimeout(startId: Int) = handleFgsTimeout()

  override fun onTimeout(startId: Int, fgsType: Int) = handleFgsTimeout()

  private fun handleFgsTimeout() {
    val activeMs =
        if (fgStartedElapsed > 0L) android.os.SystemClock.elapsedRealtime() - fgStartedElapsed else 0L
    Log.w(TAG, "dataSync FGS timed out after ${activeMs}ms — stopping foreground + notifying user")
    timedOut = true
    running = false
    postPausedNotice(this, activeMs)
    stopForeground(STOP_FOREGROUND_REMOVE)
    stopSelf() // explicit stop → no START_STICKY re-delivery (never loop a forbidden FGS start)
  }

  companion object {
    private const val TAG = "logos-chat-service"
    private const val CHANNEL_NODE = "logoschat_node"
    const val NOTIF_ID = 7
    // #381: a separate, default-importance channel + id for the "background paused" alert, so it
    // actually surfaces (the ongoing node notification is IMPORTANCE_LOW and silent).
    private const val CHANNEL_ALERTS = "logoschat_alerts"
    private const val NOTIF_ALERT_ID = 8

    @Volatile private var running = false

    // #381: when the dataSync FGS started (elapsedRealtime), and whether the OS timed it out.
    @Volatile private var fgStartedElapsed = 0L
    @Volatile private var timedOut = false

    /** #381: whether the FGS was last stopped by an OS timeout (recovery = user opens the app).
     *  Consumed by [FgsRecovery] from LogosChatModule.onHostResume; cleared by a fresh start. */
    fun wasTimedOut(): Boolean = timedOut

    /** Whether the foreground service is currently up (guards the #381 recovery restart). */
    fun isRunning(): Boolean = running

    /** #381: drop the "background paused" alert once the FGS is back. */
    fun clearPausedNotice(context: Context) {
      try {
        val nm = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        nm.cancel(NOTIF_ALERT_ID)
      } catch (t: Throwable) {
        Log.w(TAG, "paused-notice clear failed: ${t.message}")
      }
    }

    /** #381: post the actionable "background paused" notice after an FGS timeout. */
    private fun postPausedNotice(context: Context, activeMs: Long) {
      try {
        val nm = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
          nm.createNotificationChannel(
              NotificationChannel(
                  CHANNEL_ALERTS, "Delivery alerts", NotificationManager.IMPORTANCE_DEFAULT)
                  .apply { description = "Alerts when background message delivery pauses" })
        }
        val tap =
            PendingIntent.getActivity(
                context,
                1,
                Intent(context, MainActivity::class.java).apply {
                  addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP)
                },
                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
        val n =
            NotificationCompat.Builder(context, CHANNEL_ALERTS)
                .setContentTitle("Peers — background delivery paused")
                .setContentText(fgsPausedNotice(activeMs))
                .setSmallIcon(R.drawable.ic_stat_lambda)
                .setAutoCancel(true)
                .setContentIntent(tap)
                .setPriority(NotificationCompat.PRIORITY_DEFAULT)
                .build()
        nm.notify(NOTIF_ALERT_ID, n)
      } catch (t: Throwable) {
        Log.w(TAG, "paused-notice failed: ${t.message}")
      }
    }

    // #382: change-driven (not polled) notification refresh. A dedicated thread runs a
    // debounced repost that coalesces bursts; [notifState] suppresses unchanged content so a
    // quiet session issues zero periodic SQLite counts and zero redundant notify() calls.
    private const val DEBOUNCE_MS = 800L
    private val notifThread = HandlerThread("logoschat-notif").apply { start() }
    private val notifHandler = Handler(notifThread.looper)
    private val notifState = NotifState()
    private val refreshRunnable = Runnable { appContext?.let { updateNotification(it) } }

    fun start(context: Context) {
      val i = Intent(context, ChatService::class.java)
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
        context.startForegroundService(i)
      } else {
        context.startService(i)
      }
    }

    fun stop(context: Context) {
      context.stopService(Intent(context, ChatService::class.java))
    }

    /**
     * #382: change-driven refresh — call on any node/message mutation (any thread). Coalesces
     * bursts via a bounded debounce and posts only if the content actually changed. Replaces
     * the old 30-second fixed poll.
     */
    fun refreshNotification() {
      if (!running) return
      notifHandler.removeCallbacks(refreshRunnable)
      notifHandler.postDelayed(refreshRunnable, DEBOUNCE_MS)
    }

    @Volatile var appContext: Context? = null

    private fun createChannelIn(context: Context) {
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
        val nm = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        nm.createNotificationChannel(
            NotificationChannel(CHANNEL_NODE, "Node", NotificationManager.IMPORTANCE_LOW).apply {
              setShowBadge(false)
              description = "Persistent node state while the chat node runs"
            })
      }
    }

    /** #382: a change-driven update — query once, and skip the notify() if unchanged. */
    private fun updateNotification(context: Context) {
      try {
        val snap = snapshot()
        if (!notifState.shouldPost(snap)) return // unchanged → no redundant repost
        val nm = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        nm.notify(NOTIF_ID, buildNotificationFrom(context, snap))
      } catch (t: Throwable) {
        Log.w(TAG, "notification update failed: ${t.message}")
      }
    }

    /** Current notification content — the ONLY place that runs the SQLite counts (#382). */
    private fun snapshot(): NotifSnapshot {
      val (convos, msgs) =
          try {
            ChatRepo.requireDb().counts()
          } catch (_: Throwable) {
            Pair(0, 0)
          }
      return NotifSnapshot(NodeRuntime.status, convos, msgs)
    }

    /** startForeground's initial post — unconditional, but records the baseline snapshot so
     *  subsequent identical [updateNotification]s are suppressed. */
    private fun buildNotification(context: Context): Notification {
      val snap = snapshot()
      notifState.shouldPost(snap) // record baseline (return ignored — we always post here)
      return buildNotificationFrom(context, snap)
    }

    private fun buildNotificationFrom(context: Context, snap: NotifSnapshot): Notification {
      createChannelIn(context)
      val status = snap.status
      val convos = snap.convos
      val msgs = snap.msgs
      val tap =
          PendingIntent.getActivity(
              context,
              0,
              Intent(context, MainActivity::class.java).apply {
                addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP)
              },
              PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
      return NotificationCompat.Builder(context, CHANNEL_NODE)
          .setContentTitle("> λ chat — node $status")
          .setContentText("$convos conversations · $msgs messages")
          .setSmallIcon(R.drawable.ic_stat_lambda) // λ in the status bar = node running
          .setColor(0xFF10B981.toInt()) // theme accent (docs/theme.md)
          .setOngoing(true)
          .setContentIntent(tap)
          .setPriority(NotificationCompat.PRIORITY_LOW)
          .build()
    }
  }

  private fun createChannel() {
    appContext = applicationContext
    createChannelIn(this)
  }
}
