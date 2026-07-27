package com.logoschat

import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Paint
import android.graphics.RectF

/**
 * #247: a Kotlin port of the app's HexAvatar identicon engine
 * (src/components/HexAvatar.tsx) so a pinned home-screen shortcut can render the
 * user's OWN identity sigil — pixel-identical to the in-app avatars and the
 * launcher icon (both seeded from the same address, 'contact'/orange).
 *
 * xmur3 -> mulberry32 -> 5x5 left-mirrored grid, Logos-orange ramp on #0A0A0A.
 * The RNG call ORDER matches the JS exactly (skip-roll then fill-roll per cell).
 */
object Identicon {
  private val LOGOS_RAMP = intArrayOf(
      0xFFB8420E.toInt(), 0xFFFF5000.toInt(), 0xFFFF7A33.toInt(),
      0xFFFFB27A.toInt(), 0xFFFFE4D0.toInt())
  private const val GROUND = 0xFF0A0A0A.toInt()
  private const val N = 5

  /** mulberry32 seeded via an xmur3 hash — returns () -> Double in [0,1).
   *  Kotlin Int is 32-bit and `*` wraps like Math.imul; `ushr` == JS `>>>`. */
  private fun rng(seed: String): () -> Double {
    var h = 1779033703 xor seed.length
    for (ch in seed) {
      h = (h xor ch.code) * 0xCC9E2D51.toInt()
      h = (h shl 13) or (h ushr 19)
    }
    var a = (h xor (h ushr 13)) * 0xC2B2AE35.toInt()
    a = a xor (a ushr 16)
    return {
      a += 0x6D2B79F5
      var t = (a xor (a ushr 15)) * (1 or a)
      t = (t + ((t xor (t ushr 7)) * (61 or t))) xor t
      ((t xor (t ushr 14)).toLong() and 0xFFFFFFFFL).toDouble() / 4294967296.0
    }
  }

  /**
   * Render the 'contact' (orange) identicon for [address] as a square [size]px
   * bitmap. [fill] insets the 5x5 grid within the ground; [rounded] rounds the
   * ground (standalone) — pass false for an adaptive-icon bitmap so the launcher
   * mask shapes the full square ground itself.
   */
  fun render(address: String, size: Int, fill: Float = 0.66f, rounded: Boolean = false): Bitmap {
    val bmp = Bitmap.createBitmap(size, size, Bitmap.Config.ARGB_8888)
    val c = Canvas(bmp)
    val ground = Paint(Paint.ANTI_ALIAS_FLAG).apply { color = GROUND }
    if (rounded) {
      val r = size * 0.22f
      c.drawRoundRect(RectF(0f, 0f, size.toFloat(), size.toFloat()), r, r, ground)
    } else {
      c.drawRect(0f, 0f, size.toFloat(), size.toFloat(), ground)
    }
    val rnd = rng("c:$address")
    val grid = size * fill
    val off = (size - grid) / 2f
    val cell = grid / N
    val cellPaint = Paint(Paint.ANTI_ALIAS_FLAG)
    for (x in 0 until 3) {
      for (y in 0 until N) {
        if (rnd() > 0.5) continue // empty cell -> ground shows
        val idx = Math.floor(rnd() * LOGOS_RAMP.size).toInt().coerceIn(0, LOGOS_RAMP.size - 1)
        cellPaint.color = LOGOS_RAMP[idx]
        val xs = if (x == 2) intArrayOf(2) else intArrayOf(x, N - 1 - x)
        for (xx in xs) {
          val left = off + xx * cell
          val top = off + y * cell
          // +0.5 overlap so anti-aliasing never leaves a seam between cells.
          c.drawRect(left, top, left + cell + 0.5f, top + cell + 0.5f, cellPaint)
        }
      }
    }
    return bmp
  }
}
