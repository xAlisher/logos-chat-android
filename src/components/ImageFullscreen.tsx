// #315: full-screen photo viewer with pinch-to-zoom + pan. Core RN only
// (PanResponder + Animated) — the app doesn't ship react-native-gesture-handler.
//
// IMPORTANT (researched): a RN <Modal> on Android is a SEPARATE native window that
// is NOT under the RN root view, so multi-touch (the 2nd pinch finger) is never
// delivered to a PanResponder inside it — logcat proved only touches=1 ever arrived.
// The documented fixes are react-native-gesture-handler + GestureHandlerRootView, or
// simply not using a Modal. We do the latter: an in-tree absolute overlay (under the
// root view) where PanResponder multi-touch works normally.
//
// Gestures: pinch (2 fingers) → scale [1,MAX]; drag (1 finger, zoomed) → pan;
// single tap (at fit) → dismiss; ✕ button always dismisses; hardware back dismisses.
import React, {useEffect, useRef} from 'react';
import {
  Animated,
  BackHandler,
  PanResponder,
  Pressable,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from 'react-native';

const MAX_SCALE = 4;
const TAP_SLOP = 8; // px of movement still counted as a tap

export function ImageFullscreen({
  path,
  onClose,
}: {
  path: string | null;
  onClose: () => void;
}) {
  const {width, height} = useWindowDimensions();

  const scale = useRef(new Animated.Value(1)).current;
  const translateX = useRef(new Animated.Value(0)).current;
  const translateY = useRef(new Animated.Value(0)).current;
  const live = useRef({scale: 1, x: 0, y: 0});
  const committed = useRef({scale: 1, x: 0, y: 0});

  const pinchStartDist = useRef(0);
  const maxTouches = useRef(0);
  const gestureMoved = useRef(false);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
  const clampTranslate = (x: number, y: number, s: number) => {
    const maxX = ((s - 1) * width) / 2;
    const maxY = ((s - 1) * height) / 2;
    return {x: clamp(x, -maxX, maxX), y: clamp(y, -maxY, maxY)};
  };
  const setLive = (s: number, x: number, y: number) => {
    live.current = {scale: s, x, y};
    scale.setValue(s);
    translateX.setValue(x);
    translateY.setValue(y);
  };
  const settle = (t: {scale: number; x: number; y: number}, animated = true) => {
    committed.current = t;
    live.current = t;
    if (animated) {
      Animated.parallel([
        Animated.spring(scale, {toValue: t.scale, useNativeDriver: true, bounciness: 0}),
        Animated.spring(translateX, {toValue: t.x, useNativeDriver: true, bounciness: 0}),
        Animated.spring(translateY, {toValue: t.y, useNativeDriver: true, bounciness: 0}),
      ]).start();
    } else {
      scale.setValue(t.scale);
      translateX.setValue(t.x);
      translateY.setValue(t.y);
    }
  };
  const distOf = (t: Array<{pageX: number; pageY: number}>) =>
    Math.hypot(t[0].pageX - t[1].pageX, t[0].pageY - t[1].pageY);

  // Reset to fit whenever a (new) photo opens; wire hardware back to close.
  useEffect(() => {
    if (path == null) return;
    settle({scale: 1, x: 0, y: 0}, false);
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      closeRef.current();
      return true;
    });
    return () => sub.remove();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path]);

  const pan = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onStartShouldSetPanResponderCapture: () => true,
      onMoveShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponderCapture: () => true,
      onPanResponderGrant: () => {
        gestureMoved.current = false;
        pinchStartDist.current = 0;
        maxTouches.current = 1;
      },
      onPanResponderStart: evt => {
        const t = evt.nativeEvent.touches;
        maxTouches.current = Math.max(maxTouches.current, t.length);
        if (t.length >= 2) {
          pinchStartDist.current = distOf(t);
          gestureMoved.current = true;
        }
      },
      onPanResponderMove: (evt, gs) => {
        const t = evt.nativeEvent.touches;
        maxTouches.current = Math.max(maxTouches.current, t.length);
        if (t.length >= 2) {
          if (pinchStartDist.current === 0) pinchStartDist.current = distOf(t);
          const next = clamp(
            committed.current.scale * (distOf(t) / pinchStartDist.current),
            1,
            MAX_SCALE,
          );
          const {x, y} = clampTranslate(committed.current.x, committed.current.y, next);
          setLive(next, x, y);
          gestureMoved.current = true;
        } else if (committed.current.scale > 1) {
          const {x, y} = clampTranslate(
            committed.current.x + gs.dx,
            committed.current.y + gs.dy,
            committed.current.scale,
          );
          setLive(committed.current.scale, x, y);
          if (Math.abs(gs.dx) > TAP_SLOP || Math.abs(gs.dy) > TAP_SLOP) gestureMoved.current = true;
        } else if (Math.abs(gs.dx) > TAP_SLOP || Math.abs(gs.dy) > TAP_SLOP) {
          gestureMoved.current = true;
        }
      },
      onPanResponderRelease: (_evt, gs) => {
        const wasPinch = maxTouches.current >= 2;
        const wasTap =
          !wasPinch &&
          !gestureMoved.current &&
          Math.abs(gs.dx) < TAP_SLOP &&
          Math.abs(gs.dy) < TAP_SLOP;
        if (wasTap && committed.current.scale <= 1) {
          closeRef.current();
          return;
        }
        const finalScale = clamp(live.current.scale, 1, MAX_SCALE);
        if (finalScale <= 1) {
          settle({scale: 1, x: 0, y: 0});
          return;
        }
        const {x, y} = clampTranslate(live.current.x, live.current.y, finalScale);
        settle({scale: finalScale, x, y});
      },
    }),
  ).current;

  if (path == null) return null;

  return (
    <View style={styles.overlay}>
      {/* Image behind; overlay catcher (later sibling) is on top and takes touches. */}
      <Animated.Image
        source={{uri: `file://${path}`}}
        resizeMode="contain"
        style={[StyleSheet.absoluteFill, {transform: [{translateX}, {translateY}, {scale}]}]}
      />
      <View style={StyleSheet.absoluteFill} {...pan.panHandlers} />
      <Pressable style={styles.close} onPress={onClose} hitSlop={12} testID="image-fs-close">
        <Text style={styles.closeText}>✕</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  overlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0,0,0,0.97)',
    zIndex: 1000,
    elevation: 1000, // Android: sit above sibling content
  },
  close: {
    position: 'absolute',
    top: 36,
    right: 16,
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(0,0,0,0.45)',
  },
  closeText: {color: '#fff', fontSize: 20, lineHeight: 22},
});
