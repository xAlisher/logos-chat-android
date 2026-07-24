package com.logoschat

import android.app.Activity
import android.content.Context
import android.content.Intent
import android.os.Bundle
import android.os.Process

/**
 * ProcessPhoenix-style clean app restart (#59).
 *
 * Dual-binary (#51) must restart the whole process to swap the loaded liblogoschat
 * variant (two `.so`s share a soname — only one loads per process). The v0.1.1
 * restart used an inexact AlarmManager relaunch + process kill; on Samsung the
 * activity never came back to the foreground (only the START_STICKY FGS returned
 * headless → the app vanished).
 *
 * This activity runs in a SEPARATE process (`android:process=":phoenix"`), so
 * killing the MAIN app process does not kill it. Canonical ProcessPhoenix order:
 * start MainActivity fresh (NEW_TASK|CLEAR_TASK) → kill the old main pid → exit
 * this phoenix process. The system spins up a fresh main process for the relaunched
 * activity (which loads the newly-persisted variant), and the app reliably returns
 * to the FOREGROUND on every OEM.
 */
class PhoenixActivity : Activity() {

  override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(savedInstanceState)
    @Suppress("DEPRECATION")
    val next = intent.getParcelableExtra<Intent>(EXTRA_NEXT_INTENT)
    if (next != null) {
      next.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TASK)
      startActivity(next)
    }
    val mainPid = intent.getIntExtra(EXTRA_MAIN_PID, -1)
    if (mainPid != -1) Process.killProcess(mainPid)
    finish()
    // Tear down THIS (phoenix) process too, so it doesn't linger after the relaunch.
    Runtime.getRuntime().exit(0)
  }

  companion object {
    const val PROCESS_SUFFIX = ":phoenix"
    private const val EXTRA_MAIN_PID = "com.logoschat.phoenix.MAIN_PID"
    private const val EXTRA_NEXT_INTENT = "com.logoschat.phoenix.NEXT_INTENT"

    /**
     * Restart the whole app from the MAIN process. Launches [PhoenixActivity] in the
     * `:phoenix` process, carrying the launcher Intent + this process's pid. Returns
     * immediately; the caller must stop doing work — its process is about to die.
     */
    fun restart(context: Context) {
      val ctx = context.applicationContext
      val next =
          ctx.packageManager.getLaunchIntentForPackage(ctx.packageName)?.apply {
            addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TASK)
          }
      val phoenix =
          Intent(ctx, PhoenixActivity::class.java).apply {
            addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            putExtra(EXTRA_MAIN_PID, Process.myPid())
            putExtra(EXTRA_NEXT_INTENT, next)
          }
      ctx.startActivity(phoenix)
    }
  }
}
