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
import android.os.IBinder
import android.util.Log
import androidx.core.app.NotificationCompat
import java.util.concurrent.Executors
import java.util.concurrent.ScheduledExecutorService
import java.util.concurrent.TimeUnit

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

  private var poller: ScheduledExecutorService? = null

  override fun onBind(intent: Intent?): IBinder? = null

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    createChannel()
    val notif = buildNotification(this)
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
      startForeground(NOTIF_ID, notif, ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC)
    } else {
      startForeground(NOTIF_ID, notif)
    }
    running = true
    // START_STICKY redelivery after process death: JS is gone — restart the
    // node natively from the stored config (fresh epoch by design).
    NodeRuntime.autoRestartIfWanted()
    if (poller == null) {
      poller =
          Executors.newSingleThreadScheduledExecutor { r ->
            Thread(r, "logoschat-service-poll").apply { isDaemon = true }
          }.also {
            it.scheduleWithFixedDelay({ updateNotification(this) }, 30, 30, TimeUnit.SECONDS)
            // Mix pool poll (#31): off the JS thread (background-throttle lesson),
            // on the native executor via NodeRuntime. No-op unless mix is on.
            it.scheduleWithFixedDelay({ NodeRuntime.pollMixStatus() }, 5, 8, TimeUnit.SECONDS)
          }
    }
    Log.i(TAG, "ChatService foregrounded (dataSync, sticky)")
    return START_STICKY
  }

  override fun onDestroy() {
    running = false
    poller?.shutdownNow()
    poller = null
    Log.i(TAG, "ChatService destroyed")
    super.onDestroy()
  }

  companion object {
    private const val TAG = "logos-chat-service"
    private const val CHANNEL_NODE = "logoschat_node"
    const val NOTIF_ID = 7

    @Volatile private var running = false

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

    /** Cheap push-style refresh on node status flips (any thread). */
    fun refreshNotification() {
      val app = appContext ?: return
      if (!running) return
      updateNotification(app)
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

    private fun updateNotification(context: Context) {
      try {
        val nm = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        nm.notify(NOTIF_ID, buildNotification(context))
      } catch (t: Throwable) {
        Log.w(TAG, "notification update failed: ${t.message}")
      }
    }

    private fun buildNotification(context: Context): Notification {
      createChannelIn(context)
      val status = NodeRuntime.status
      val (convos, msgs) =
          try {
            ChatRepo.requireDb().counts()
          } catch (_: Throwable) {
            Pair(0, 0)
          }
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
          .setContentText("epoch ${ChatRepo.currentEpochId} · $convos conversations · $msgs messages")
          .setSmallIcon(R.drawable.ic_stat_chat)
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
