// #308 — the in-chat "sending" bubble for a video being compressed then uploaded.
// Shows the poster frame with a circular progress ring on top and a phase label under it
// ("compressing" while the on-device transcode runs, then "sending" during upload). It's an
// outgoing, right-aligned bubble that vanishes when the real message lands.
import React from 'react';
import {Image, StyleSheet, Text, View} from 'react-native';
import Svg, {Circle} from 'react-native-svg';
import {colors, radii, spacing, type} from '../theme';
import type {MediaSend} from '../stores/chatStore';

const SIZE = 160;
const RING = 46;
const STROKE = 4;

function Ring({progress}: {progress: number}) {
  const r = RING / 2 - STROKE / 2;
  const c = 2 * Math.PI * r;
  const p = Math.max(0, Math.min(1, progress));
  return (
    <Svg width={RING} height={RING} style={styles.ring}>
      <Circle
        cx={RING / 2}
        cy={RING / 2}
        r={r}
        stroke="rgba(255,255,255,0.35)"
        strokeWidth={STROKE}
        fill="none"
      />
      <Circle
        cx={RING / 2}
        cy={RING / 2}
        r={r}
        stroke="#fff"
        strokeWidth={STROKE}
        fill="none"
        strokeLinecap="round"
        strokeDasharray={`${c} ${c}`}
        strokeDashoffset={c * (1 - p)}
        transform={`rotate(-90 ${RING / 2} ${RING / 2})`}
      />
    </Svg>
  );
}

export function MediaSendBubble({send}: {send: MediaSend}) {
  const label = send.phase === 'compressing' ? 'compressing' : 'sending';
  const pct = Math.round(send.progress * 100);
  return (
    <View style={styles.row}>
      <View style={styles.bubble}>
        <View style={styles.media}>
          {send.poster != null ? (
            <Image source={{uri: `file://${send.poster}`}} style={styles.poster} />
          ) : (
            <View style={[styles.poster, styles.posterFallback]} />
          )}
          <View style={styles.scrim}>
            <Ring progress={send.progress} />
            <Text style={styles.pct}>{pct}%</Text>
          </View>
        </View>
        <Text style={styles.label}>{label}…</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {flexDirection: 'row', justifyContent: 'flex-end', paddingHorizontal: spacing.md, paddingVertical: spacing.xs},
  bubble: {
    backgroundColor: colors.accent,
    borderRadius: radii.card,
    padding: 4,
  },
  media: {
    width: SIZE,
    height: SIZE,
    borderRadius: radii.card - 2,
    overflow: 'hidden',
  },
  poster: {width: SIZE, height: SIZE},
  posterFallback: {backgroundColor: 'rgba(0,0,0,0.35)'},
  scrim: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(0,0,0,0.35)',
  },
  ring: {position: 'absolute'},
  pct: {color: '#fff', fontSize: 12, fontWeight: '700'},
  label: {
    ...type.caption,
    color: colors.onAccent,
    textAlign: 'center',
    paddingVertical: 4,
  },
});
