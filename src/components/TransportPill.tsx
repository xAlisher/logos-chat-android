// TransportPill (#146) — the header control showing the live state of every
// transport. Always renders the Logos mark, tinted by the node's tri-state; once
// MeshCore has been set up (settingsStore.meshConfigured) it also renders the
// MeshCore mark, and once BLE mesh has been engaged (settingsStore.bleConfigured)
// the Bluetooth mark, each tinted by its own tri-state. Whichever transport is
// mid-connect breathes (opacity pulse, matching NodeStatusIcon). Tapping the pill
// opens the TransportsModal.
//
// The tri-state model (Tri / TRI_COLOR / logosTri / meshTri / bleTri) lives in
// ./tri (pure, RN-free) and is re-exported here for existing call sites.
import React, {useEffect, useRef, useState} from 'react';
import {Animated, Pressable, StyleSheet} from 'react-native';
import {Logo} from './Logo';
import {MeshLogo} from './MeshLogo';
import {BleLogo} from './BleLogo';
import {ShieldLogo} from './ShieldLogo';
import {TransportsModal} from './TransportsModal';
import {useNodeStore} from '../stores/nodeStore';
import {useMeshStore} from '../stores/meshStore';
import {useBleStore} from '../stores/bleStore';
import {useSettingsStore} from '../stores/settingsStore';
import {type Tri, TRI_COLOR, triColorFor, logosTri, meshTri, bleTri} from './tri';

export {type Tri, TRI_COLOR, logosTri, meshTri, bleTri} from './tri';

const GLYPH = 22;

/** A single transport glyph, tinted by tri-state and breathing while connecting. */
function TransportGlyph({
  tri,
  kind,
}: {
  tri: Tri;
  kind: 'logos' | 'mesh' | 'ble' | 'tor';
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

  // Tor is a privacy layer over Logos, so it borrows the logos tri palette.
  const color = triColorFor(tri, kind === 'tor' ? 'logos' : kind);
  return (
    <Animated.View style={{opacity}}>
      {kind === 'logos' ? (
        <Logo size={GLYPH} color={color} strokeWidth={2} />
      ) : kind === 'mesh' ? (
        <MeshLogo size={GLYPH} color={color} strokeWidth={2} />
      ) : kind === 'ble' ? (
        <BleLogo size={GLYPH} color={color} strokeWidth={2} />
      ) : (
        <ShieldLogo size={GLYPH} color={color} strokeWidth={2} />
      )}
    </Animated.View>
  );
}

export function TransportPill() {
  const nodeStatus = useNodeStore(s => s.status);
  const meshStatus = useMeshStore(s => s.status);
  const bleStatus = useBleStore(s => s.status);
  const meshConfigured = useSettingsStore(s => s.meshConfigured);
  const bleConfigured = useSettingsStore(s => s.bleConfigured);
  const mediaOverTor = useSettingsStore(s => s.mediaOverTor); // #320: private-mode badge
  const torBusy = useSettingsStore(s => s.torBusy);
  const [open, setOpen] = useState(false);

  // #233: the Logos node is the PRIMARY transport — always shown, red/failed when
  // offline. Secondary transports (MeshCore, BLE) are only shown while they're
  // doing something (online or connecting); an offline secondary is hidden
  // entirely rather than sitting there gray (supersedes the gray treatment #227).
  const mesh = meshTri(meshStatus);
  const ble = bleTri(bleStatus);
  const showMesh = meshConfigured && mesh !== 'offline';
  const showBle = bleConfigured && ble !== 'offline';
  // #320: show a shield badge when private mode (Tor) is on or bootstrapping.
  const torTri: Tri = torBusy ? 'connecting' : mediaOverTor ? 'online' : 'offline';
  const showTor = torTri !== 'offline';

  return (
    <>
      <Pressable
        testID="transport-pill"
        hitSlop={10}
        onPress={() => setOpen(true)}
        accessibilityRole="button"
        accessibilityLabel="Transports"
        accessibilityHint="Opens transport and privacy-mode settings"
        style={styles.pill}>
        <TransportGlyph tri={logosTri(nodeStatus)} kind="logos" />
        {showMesh && <TransportGlyph tri={mesh} kind="mesh" />}
        {showBle && <TransportGlyph tri={ble} kind="ble" />}
        {showTor && <TransportGlyph tri={torTri} kind="tor" />}
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
