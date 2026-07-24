// Swipe-to-delete row (#71) — gesture-committed, no confirmation dialog.
// Drag left: a red ribbon grows behind the row. Past the arm threshold a haptic
// fires and the ribbon reads "release to delete". RELEASE while armed → delete.
// Drag back toward the edge (below threshold) → disarms; release → cancel.
// RN core Animated + PanResponder + Vibration (no gesture-handler dependency).
import React, {useRef, useState} from 'react';
import {
  Animated,
  PanResponder,
  Text,
  Vibration,
  View,
  StyleSheet,
  type LayoutChangeEvent,
} from 'react-native';
import {colors, type} from '../theme';

export function SwipeRow({
  children,
  onDelete,
}: {
  children: React.ReactNode;
  onDelete: () => void;
}) {
  const tx = useRef(new Animated.Value(0)).current;
  const width = useRef(320);
  const dx = useRef(0);
  const armed = useRef(false);
  const [armedUI, setArmedUI] = useState(false);

  // Arm once past ~40% of the row width (min 120px).
  const armThreshold = () => Math.min(width.current * 0.4, 120);

  const setArmed = (next: boolean) => {
    if (next === armed.current) return;
    armed.current = next;
    setArmedUI(next);
    Vibration.vibrate(next ? 18 : 8); // heavier tick on arm, light on disarm
  };

  const pan = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: (_e, g) =>
        g.dx < -12 && Math.abs(g.dx) > Math.abs(g.dy) * 1.5,
      onPanResponderMove: (_e, g) => {
        const next = Math.max(-width.current, Math.min(0, g.dx));
        dx.current = next;
        tx.setValue(next);
        setArmed(-next >= armThreshold());
      },
      onPanResponderRelease: () => {
        if (armed.current) {
          // Commit: slide the row out, then delete.
          Animated.timing(tx, {
            toValue: -width.current,
            duration: 140,
            useNativeDriver: true,
          }).start(() => onDelete());
        } else {
          Animated.spring(tx, {
            toValue: 0,
            useNativeDriver: true,
            bounciness: 0,
          }).start();
        }
        armed.current = false;
        setArmedUI(false);
      },
      onPanResponderTerminate: () => {
        Animated.spring(tx, {toValue: 0, useNativeDriver: true, bounciness: 0}).start();
        armed.current = false;
        setArmedUI(false);
      },
    }),
  ).current;

  const onLayout = (e: LayoutChangeEvent) => {
    width.current = e.nativeEvent.layout.width;
  };

  return (
    <View style={styles.wrap} onLayout={onLayout}>
      {/* Red ribbon behind the row; label flips to "release to delete" when armed. */}
      <View style={[styles.ribbon, armedUI && styles.ribbonArmed]}>
        <Text style={[styles.ribbonText, armedUI && styles.ribbonTextArmed]}>
          {armedUI ? 'release to delete' : 'delete'}
        </Text>
      </View>
      <Animated.View style={{transform: [{translateX: tx}]}} {...pan.panHandlers}>
        {children}
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {backgroundColor: colors.errorFill},
  ribbon: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: colors.errorFill,
    alignItems: 'flex-end',
    justifyContent: 'center',
    paddingRight: 20,
  },
  ribbonArmed: {backgroundColor: colors.errorBorder},
  ribbonText: {...type.label, color: colors.unread, fontWeight: '700'},
  ribbonTextArmed: {color: '#FFFFFF'},
});
