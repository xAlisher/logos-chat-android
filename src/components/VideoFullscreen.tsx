// #300 — fullscreen video player: the decrypted clip with sound + JS-drawn controls
// (play/pause, tap-to-seek bar, elapsed/total time), letterboxed to preserve aspect ratio.
import React, {useEffect, useRef, useState} from 'react';
import {
  ActivityIndicator,
  GestureResponderEvent,
  Modal,
  PanResponder,
  Pressable,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from 'react-native';
import {MediaVideo, type MediaVideoHandle} from './MediaVideo';
import {
  VIDEO_POSITION_ACTIONS,
  adjustVideoPosition,
  formatClock as fmt,
  videoPositionAccessibilityValue,
} from '../media/videoA11y';

export function VideoFullscreen({
  path,
  aspectRatio,
  onClose,
}: {
  path: string | null;
  /** video width/height; used to fit within the screen without stretching. */
  aspectRatio: number;
  onClose: () => void;
}) {
  const {width: sw, height: sh} = useWindowDimensions();
  const videoRef = useRef<MediaVideoHandle>(null);
  const [paused, setPaused] = useState(false);
  const [duration, setDuration] = useState(0);
  const [current, setCurrent] = useState(0);
  const [barWidth, setBarWidth] = useState(0);
  // Show a loader until the clip actually starts playing (fetch/decrypt + decode latency).
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    setLoading(true);
  }, [path]);

  // Letterbox: largest w×h with the video's aspect ratio that fits the screen.
  const ar = aspectRatio > 0 ? aspectRatio : 1;
  let vw = sw;
  let vh = sw / ar;
  if (vh > sh) {
    vh = sh;
    vw = sh * ar;
  }

  const progress = duration > 0 ? Math.min(1, current / duration) : 0;

  const seekTo = (target: number) => {
    setCurrent(target);
    videoRef.current?.seek(target);
  };

  const onSeekBar = (e: GestureResponderEvent) => {
    if (duration <= 0 || barWidth <= 0) return;
    const frac = Math.max(0, Math.min(1, e.nativeEvent.locationX / barWidth));
    seekTo(frac * duration);
  };

  const close = () => {
    setPaused(false);
    setDuration(0);
    setCurrent(0);
    onClose();
  };

  // #304: keep the responder pointing at the latest close (onClose identity may change).
  const closeRef = useRef(close);
  closeRef.current = close;
  const pan = useRef(
    PanResponder.create({
      // Lives on a transparent overlay View covering the video (the controls render ON TOP,
      // so they claim their own taps first). We CLAIM the touch on start — inside a RN Modal
      // a slow real-finger drag is only captured by an actual responder claim (learned from
      // the InfoModal scroll fix, #182); returning false let the drag slip away. A plain tap
      // just releases with dy≈0 and springs back (no-op).
      onStartShouldSetPanResponder: () => true,
      onStartShouldSetPanResponderCapture: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderRelease: (_, g) => {
        // No drag-follow animation (it glitched) — a downward swipe just closes.
        if (g.dy > 120 && Math.abs(g.dy) > Math.abs(g.dx)) closeRef.current();
      },
    }),
  ).current;

  return (
    <Modal
      visible={path != null}
      animationType="fade"
      onRequestClose={close}
      statusBarTranslucent>
      <View style={styles.root}>
        <View pointerEvents="none" style={styles.videoWrap}>
          {path != null && (
            <MediaVideo
              ref={videoRef}
              path={path}
              muted={false}
              controls
              paused={paused}
              onLoad={setDuration}
              onProgress={(t, playing) => {
                setCurrent(t);
                // first real frame → drop the loader.
                if (loading && (playing || t > 0)) setLoading(false);
                // keep the button in sync if playback state drifts
                if (playing === paused) setPaused(!playing);
              }}
              style={{width: vw, height: vh}}
            />
          )}
        </View>

        {/* #304: transparent swipe-down-to-close catcher. A plain View reliably receives the
            gesture (unlike a handler on/under the native video). Rendered BEFORE the ✕ and
            controls so those sit on top and keep their taps. */}
        <View style={styles.swipeCatcher} {...pan.panHandlers} />

        {/* Loader until the first frame plays. */}
        {path != null && loading && (
          <View style={styles.loader} pointerEvents="none">
            <ActivityIndicator size="large" color="#fff" />
          </View>
        )}

        {/* Close */}
        <Pressable style={styles.close} onPress={close} hitSlop={16} accessibilityRole="button" accessibilityLabel="Close video" testID="video-close">
          <Text style={styles.closeText} importantForAccessibility="no">✕</Text>
        </Pressable>

        {/* Controls bar */}
        <View style={styles.controls}>
          <Pressable
            onPress={() => setPaused(p => !p)}
            hitSlop={12}
            accessibilityRole="button"
            accessibilityLabel={paused ? 'Play video' : 'Pause video'}
            testID="video-playpause"
            style={styles.playBtn}>
            <Text style={styles.playText} importantForAccessibility="no">{paused ? '►' : '❚❚'}</Text>
          </Pressable>
          <Text style={styles.time}>{fmt(current)}</Text>
          {/* #395: `adjustable` promises TalkBack increment/decrement — so it must actually
              handle those actions and report its value, not just take taps. */}
          <Pressable
            style={styles.track}
            onLayout={e => setBarWidth(e.nativeEvent.layout.width)}
            accessibilityRole="adjustable"
            accessibilityLabel="Video position"
            accessibilityValue={videoPositionAccessibilityValue(current, duration)}
            accessibilityActions={VIDEO_POSITION_ACTIONS}
            onAccessibilityAction={e => {
              const name = e.nativeEvent.actionName;
              if (name === 'increment' || name === 'decrement') {
                seekTo(adjustVideoPosition(current, duration, name));
              }
            }}
            testID="video-seek"
            onPress={onSeekBar}>
            <View style={styles.trackBg} />
            <View style={[styles.trackFill, {width: `${progress * 100}%`}]} />
            <View style={[styles.knob, {left: `${progress * 100}%`}]} />
          </Pressable>
          <Text style={styles.time}>{fmt(duration)}</Text>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: {flex: 1, backgroundColor: '#000', alignItems: 'center', justifyContent: 'center'},
  videoWrap: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },
  swipeCatcher: {position: 'absolute', top: 0, left: 0, right: 0, bottom: 0},
  close: {
    position: 'absolute',
    top: 40,
    right: 20,
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 20,
    backgroundColor: 'rgba(0,0,0,0.5)',
  },
  closeText: {color: '#fff', fontSize: 20, fontWeight: '600'},
  loader: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },
  controls: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 20,
    gap: 12,
    backgroundColor: 'rgba(0,0,0,0.45)',
  },
  playBtn: {width: 34, alignItems: 'center'},
  playText: {color: '#fff', fontSize: 18, fontWeight: '700'},
  time: {color: '#fff', fontSize: 12, minWidth: 34, textAlign: 'center'},
  track: {flex: 1, height: 28, justifyContent: 'center'},
  trackBg: {position: 'absolute', left: 0, right: 0, height: 3, borderRadius: 2, backgroundColor: 'rgba(255,255,255,0.35)'},
  trackFill: {position: 'absolute', left: 0, height: 3, borderRadius: 2, backgroundColor: '#fff'},
  knob: {
    position: 'absolute',
    width: 12,
    height: 12,
    borderRadius: 6,
    marginLeft: -6,
    backgroundColor: '#fff',
  },
});
