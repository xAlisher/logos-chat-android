package com.logoschat

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class VideoAspectFitTest {
  @Test
  fun landscapeVideoFitsPortraitViewWithoutStretching() {
    val fit = videoAspectFit(1080, 2400, 1920, 1080)

    assertEquals(1f, fit.scaleX, 0.0001f)
    assertTrue(fit.scaleY < 1f)
    assertEquals(1920f / 1080f, (1080f * fit.scaleX) / (2400f * fit.scaleY), 0.0001f)
  }

  @Test
  fun portraitVideoFitsLandscapeViewWithoutStretching() {
    val fit = videoAspectFit(2400, 1080, 1080, 1920)

    assertTrue(fit.scaleX < 1f)
    assertEquals(1f, fit.scaleY, 0.0001f)
    assertEquals(1080f / 1920f, (2400f * fit.scaleX) / (1080f * fit.scaleY), 0.0001f)
  }

  @Test
  fun invalidDimensionsLeaveTextureUntransformed() {
    assertEquals(VideoAspectFit(1f, 1f), videoAspectFit(0, 1080, 1920, 1080))
    assertEquals(VideoAspectFit(1f, 1f), videoAspectFit(1080, 2400, 0, 1080))
  }
}
