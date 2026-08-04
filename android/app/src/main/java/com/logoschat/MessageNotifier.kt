package com.logoschat

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.os.Build
import android.util.Log
import androidx.core.app.NotificationCompat

/**
 * Inbound-message notifications (#26).
 *
 * Posted from the events HandlerThread AFTER the message is persisted
 * (persist-before-forward, docs/architecture.md §2.1), so a notification never
 * promises a message the DB doesn't already hold. One notification per
 * conversation (id = convoPk) so a chatty peer collapses into one entry;
 * tapping carries the convoPk into MainActivity, which JS reads via
 * `consumeLaunchConvo()` and opens the thread.
 *
 * Suppressed when that thread is already on screen — ChatRepo.activeConvoPk is
 * the same signal used to suppress the unread bump.
 */
object MessageNotifier {
  private const val TAG = "logos-chat-bridge"
  private const val CHANNEL_MESSAGES = "messages"
  /** Keep clear of ChatService's ongoing node notification (id 1). */
  private const val ID_BASE = 1000

  const val EXTRA_CONVO_PK = "com.logoschat.extra.CONVO_PK"

  /**
   * #359: KV flag — show message content + sender in notifications. Default OFF
   * (private by default). Written from JS (settingsStore) via LogosChat.setSetting;
   * read here through the same native ChatDb the rest of the bridge uses.
   */
  const val KV_NOTIF_SHOW_CONTENT = "notifShowContent"

  private fun idFor(convoPk: Long): Int = ID_BASE + (convoPk % 100_000L).toInt()

  private fun ensureChannel(context: Context) {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
    val nm = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
    if (nm.getNotificationChannel(CHANNEL_MESSAGES) != null) return
    nm.createNotificationChannel(
        NotificationChannel(CHANNEL_MESSAGES, "Messages", NotificationManager.IMPORTANCE_DEFAULT)
            .apply { description = "New chat messages" })
  }

  /**
   * @param title conversation display name, or null for a still-unnamed
   *   (pending, manually attributed — #24) inbound conversation.
   *
   * #359: PRIVATE BY DEFAULT. The message text + sender name are shown only when
   * the user opts in via "Show message content in notifications"
   * ([KV_NOTIF_SHOW_CONTENT], default OFF). Regardless of that setting the
   * notification is VISIBILITY_PRIVATE with a generic public version, so a locked
   * device never surfaces content or contact names on the lock screen.
   */
  fun notifyMessage(context: Context, convoPk: Long, title: String?, text: String) {
    try {
      ensureChannel(context)
      // #359: opt-in content, default OFF; read through the same native ChatDb kv the
      // rest of the bridge uses (JS writes it via settingsStore/LogosChat.setSetting).
      val showContent =
          try {
            ChatRepo.requireDb().kvGet(KV_NOTIF_SHOW_CONTENT) == "true"
          } catch (_: Throwable) {
            false // fail private
          }
      val isGroup =
          try {
            ChatRepo.requireDb().isGroup(convoPk)
          } catch (_: Throwable) {
            false
          }
      val generic = if (isGroup) "New message in a group" else "New message"
      val appName =
          try {
            context.getString(R.string.app_name)
          } catch (_: Throwable) {
            "Peers"
          }
      val tap =
          PendingIntent.getActivity(
              context,
              idFor(convoPk),
              Intent(context, MainActivity::class.java).apply {
                addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_NEW_TASK)
                putExtra(EXTRA_CONVO_PK, convoPk)
              },
              PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
      fun baseBuilder() =
          NotificationCompat.Builder(context, CHANNEL_MESSAGES)
              .setSmallIcon(R.drawable.ic_stat_chat)
              .setColor(0xFF10B981.toInt()) // theme accent (docs/theme.md)
              .setCategory(NotificationCompat.CATEGORY_MESSAGE)
              .setPriority(NotificationCompat.PRIORITY_DEFAULT)
              .setAutoCancel(true)
      // Lock-screen substitute: ALWAYS generic — no content, no sender.
      val publicVersion =
          baseBuilder().setContentTitle(appName).setContentText(generic).build()
      val builder =
          baseBuilder()
              .setContentIntent(tap)
              .setVisibility(NotificationCompat.VISIBILITY_PRIVATE)
              .setPublicVersion(publicVersion)
      if (showContent) {
        builder
            .setContentTitle(title ?: "New conversation")
            .setContentText(text)
            .setStyle(NotificationCompat.BigTextStyle().bigText(text))
      } else {
        builder.setContentTitle(appName).setContentText(generic)
      }
      val n: Notification = builder.build()
      (context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager)
          .notify(idFor(convoPk), n)
    } catch (t: Throwable) {
      // Never let a notification failure (e.g. POST_NOTIFICATIONS denied) break
      // the event pipeline — the message is already persisted.
      Log.w(TAG, "notifyMessage failed: ${t.message}")
    }
  }

  private const val CHANNEL_NODE_ALERT = "node_alerts"
  private const val ID_NODE_DOWN = 900

  /**
   * Node died unexpectedly (#78) — NOT a user-initiated stop. e.g. the process
   * was killed in the background and the auto-restart failed, or chat_new/start
   * errored. Tapping reopens the app, which auto-starts the node (#57).
   */
  fun notifyNodeDown(context: Context, reason: String?) {
    try {
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
        val nm = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        if (nm.getNotificationChannel(CHANNEL_NODE_ALERT) == null) {
          nm.createNotificationChannel(
              NotificationChannel(CHANNEL_NODE_ALERT, "Node alerts", NotificationManager.IMPORTANCE_DEFAULT)
                  .apply { description = "Node stopped unexpectedly" })
        }
      }
      val tap =
          PendingIntent.getActivity(
              context,
              ID_NODE_DOWN,
              Intent(context, MainActivity::class.java).apply {
                addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_NEW_TASK)
              },
              PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
      val n =
          NotificationCompat.Builder(context, CHANNEL_NODE_ALERT)
              .setContentTitle("Node stopped")
              .setContentText("Messages may be missed. Tap to reconnect.")
              .setSmallIcon(R.drawable.ic_stat_lambda)
              .setColor(0xFFEF4444.toInt())
              .setCategory(NotificationCompat.CATEGORY_ERROR)
              .setPriority(NotificationCompat.PRIORITY_DEFAULT)
              .setAutoCancel(true)
              .setContentIntent(tap)
              .build()
      (context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager)
          .notify(ID_NODE_DOWN, n)
      if (reason != null) Log.w(TAG, "node down: $reason")
    } catch (t: Throwable) {
      Log.w(TAG, "notifyNodeDown failed: ${t.message}")
    }
  }

  /** Clear the node-down alert (e.g. once the node is running again). */
  fun clearNodeDown(context: Context) {
    try {
      (context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager)
          .cancel(ID_NODE_DOWN)
    } catch (_: Throwable) {}
  }

  /** Called when the thread is opened/read — clears its notification. */
  fun cancelFor(context: Context, convoPk: Long) {
    try {
      (context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager)
          .cancel(idFor(convoPk))
    } catch (t: Throwable) {
      Log.w(TAG, "cancelFor failed: ${t.message}")
    }
  }
}
