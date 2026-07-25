// TransportPill (#146) — the header control showing the live state of both
// transports. Always renders the Logos mark, tinted by the node's tri-state; once
// MeshCore has been set up (settingsStore.meshConfigured) it also renders the
// MeshCore mark beside it, tinted by the radio's tri-state. Whichever transport is
// mid-connect breathes (opacity pulse, matching NodeStatusIcon). Tapping the pill
// opens the TransportsModal.
//
// Tri-state is a TRAFFIC LIGHT (red/yellow/green) — deliberately NOT the app's
// orange brand tint (nodeStatusColor), so "offline/connecting/online" reads at a
// glance without being confused for the accent.
import React, {useEffect, useRef, useState} from 'react';
import {Animated, Pressable, StyleSheet} from 'react-native';
import {Logo} from './Logo';
import {MeshLogo} from './MeshLogo';
import {TransportsModal} from './TransportsModal';
import {useNodeStore} from '../stores/nodeStore';
import {useMeshStore} from '../stores/meshStore';
import {useSettingsStore} from '../stores/settingsStore';
import type {NodeStatus} from '../native/LogosChat';
import type {MeshStatus} from '../native/MeshCore';

/** The three transport states the pill distinguishes. */
export type Tri = 'offline' | 'connecting' | 'online';

/** Tri-state → traffic-light color (user spec — NOT the orange brand accent). */
export const TRI_COLOR: Record<Tri, string> = {
  offline: '#EF4444', // red
  connecting: '#EAB308', // yellow (breathing)
  online: '#22C55E', // green
};

/** Map a Logos node status to the pill's tri-state. */
export function logosTri(status: NodeStatus): Tri {
  switch (status) {
    case 'running':
      return 'online';
    case 'initializing':
    case 'starting':
      return 'connecting';
    default: // stopped | error
      return 'offline';
  }
}

/** Map a MeshCore radio status to the pill's tri-state. */
export function meshTri(status: MeshStatus): Tri {
  switch (status) {
    case 'connected':
      return 'online';
    case 'connecting':
      return 'connecting';
    default: // disconnected
      return 'offline';
  }
}

const GLYPH = 22;

/** A single transport glyph, tinted by tri-state and breathing while connecting. */
function TransportGlyph({
  tri,
  kind,
}: {
  tri: Tri;
  kind: 'logos' | 'mesh';
}) {
  const breathing = tri === 'connecting';
  const opacity = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    if (breathing) {
      const loop = Animated.loop(
        Animated.sequence([
          Animated.timing(opacity, {toValue: 0.35, duration: 550, useNativeDriver: true}),
          Animated.timing(opacity, {toValue: 1.0, duration: 550, useNativeDriver: true}),
        ]),
      );
      loop.start();
      return () => loop.stop();
    }
    opacity.setValue(1);
    return undefined;
  }, [breathing, opacity]);

  const color = TRI_COLOR[tri];
  return (
    <Animated.View style={{opacity}}>
      {kind === 'logos' ? (
        <Logo size={GLYPH} color={color} strokeWidth={2} />
      ) : (
        <MeshLogo size={GLYPH} color={color} strokeWidth={2} />
      )}
    </Animated.View>
  );
}

export function TransportPill() {
  const nodeStatus = useNodeStore(s => s.status);
  const meshStatus = useMeshStore(s => s.status);
  const meshConfigured = useSettingsStore(s => s.meshConfigured);
  const [open, setOpen] = useState(false);

  return (
    <>
      <Pressable
        testID="transport-pill"
        hitSlop={10}
        onPress={() => setOpen(true)}
        style={styles.pill}>
        <TransportGlyph tri={logosTri(nodeStatus)} kind="logos" />
        {meshConfigured && (
          <TransportGlyph tri={meshTri(meshStatus)} kind="mesh" />
        )}
      </Pressable>
      <TransportsModal visible={open} onClose={() => setOpen(false)} />
    </>
  );
}

const styles = StyleSheet.create({
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: 6,
    minHeight: 34,
  },
});
