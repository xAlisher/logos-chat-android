// #267: app-level edge-swipe-back.
//
// native-stack has no swipe gesture on Android, and 3-button navigation has no OS
// edge-swipe at all — so the app draws its own with the built-in PanResponder (zero
// extra native deps). A short rightward drag that STARTS at the left edge pops the
// current screen. Everything else — taps, buttons, vertical scroll, horizontal
// content away from the edge — is left untouched: we only claim the responder for a
// left-edge, mostly-horizontal drag, and use the non-capture hook so children (e.g.
// a ScrollView) get first refusal.
import React, {useRef} from 'react';
import {PanResponder, StyleSheet, View} from 'react-native';
import {useNavigation} from '@react-navigation/native';

const EDGE_ZONE = 40; // start within this many px of the left edge
const CLAIM_DX = 14; // horizontal travel before we take the gesture
const TRIGGER_DX = 64; // travel required to actually go back
const H_BIAS = 1.5; // must be this much more horizontal than vertical

export function SwipeBackGesture({children}: {children: React.ReactNode}) {
  const navigation = useNavigation();
  const pan = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: (_e, g) =>
        g.x0 <= EDGE_ZONE && g.dx > CLAIM_DX && g.dx > Math.abs(g.dy) * H_BIAS,
      onPanResponderRelease: (_e, g) => {
        if (g.dx > TRIGGER_DX && g.dx > Math.abs(g.dy) * H_BIAS) {
          const nav = navigation as unknown as {
            canGoBack?: () => boolean;
            goBack?: () => void;
          };
          if (nav.canGoBack?.()) nav.goBack?.();
        }
      },
    }),
  ).current;
  return (
    <View style={styles.fill} collapsable={false} {...pan.panHandlers}>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({fill: {flex: 1}});
