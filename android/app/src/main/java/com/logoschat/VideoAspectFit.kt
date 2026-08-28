package com.logoschat

data class VideoAspectFit(val scaleX: Float, val scaleY: Float)

fun videoAspectFit(
  viewWidth: Int,
  viewHeight: Int,
  videoWidth: Int,
  videoHeight: Int,
): VideoAspectFit {
  if (viewWidth <= 0 || viewHeight <= 0 || videoWidth <= 0 || videoHeight <= 0) {
    return VideoAspectFit(1f, 1f)
  }
  val scale = minOf(
    viewWidth.toFloat() / videoWidth.toFloat(),
    viewHeight.toFloat() / videoHeight.toFloat(),
  )
  return VideoAspectFit(
    scaleX = videoWidth.toFloat() * scale / viewWidth.toFloat(),
    scaleY = videoHeight.toFloat() * scale / viewHeight.toFloat(),
  )
}
