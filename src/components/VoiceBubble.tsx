// VoiceBubble (#205) — renders a voice note: a play/stop button, a compact
// waveform (the amplitude samples captured at record time), and mm:ss duration.
// Playback goes through the native AudioRecorder module; a single
// 'AudioRecorderEvent' 'playbackEnded' resets the button.
import React, {useEffect, useMemo, useState} from 'react';
import {
  Pressable,
  View,
  Text,
  StyleSheet,
  DeviceEventEmitter,
  useWindowDimensions,
} from 'react-native';
import {colors, type} from '../theme';
import AudioRecorder from '../native/Audio';
import {formatDuration, type VoiceMeta} from '../native/voiceMsg';

// #256 — waveform bar geometry. Each rendered bar occupies BAR_W + BAR_GAP px,
// so the max number of bars is derived from the capped wave width below.
const BAR_W = 2;
const BAR_GAP = 2;
// Fraction of screen the whole bubble may span, and space reserved (px) for the
// play button + gaps + duration label so those two stay visible at the cap.
const MAX_BUBBLE_FRACTION = 0.72;
const RESERVED_PX = 96;
const MIN_WAVE_PX = 96;

// #256 — collapse an arbitrarily long amplitude array down to `maxBars` buckets by
// averaging, so a long recording fills (not overflows) the capped width. Short
// notes (fewer samples than the cap) are returned untouched → compact bubble.
function downsample(samples: number[], maxBars: number): number[] {
  if (maxBars <= 0) return [];
  if (samples.length <= maxBars) return samples;
  const out: number[] = [];
  const bucket = samples.length / maxBars;
  for (let i = 0; i < maxBars; i++) {
    const start = Math.floor(i * bucket);
    const end = Math.max(start + 1, Math.floor((i + 1) * bucket));
    let sum = 0;
    let n = 0;
    for (let j = start; j < end && j < samples.length; j++) {
      sum += samples[j];
      n++;
    }
    out.push(n > 0 ? sum / n : 0);
  }
  return out;
}

export function VoiceBubble({
  path,
  meta,
  tint,
}: {
  path: string;
  meta: VoiceMeta;
  /** Foreground colour (own bubble uses onAccent, peer uses text). */
  tint: string;
}) {
  const [playing, setPlaying] = useState(false);

  useEffect(() => {
    const sub = DeviceEventEmitter.addListener('AudioRecorderEvent', (e: any) => {
      if (e?.eventType === 'playbackEnded') setPlaying(false);
    });
    return () => sub.remove();
  }, []);

  const toggle = async () => {
    try {
      if (playing) {
        await AudioRecorder.stopPlaying();
        setPlaying(false);
      } else {
        setPlaying(true);
        await AudioRecorder.playFile(path);
      }
    } catch {
      setPlaying(false);
    }
  };

  // #256 — cap the bubble/waveform width to a fraction of the current screen so a
  // long recording never pushes the bubble off-screen; downsample bars to fill it.
  const {width: screenW} = useWindowDimensions();
  const maxWaveW = Math.max(
    MIN_WAVE_PX,
    Math.round(screenW * MAX_BUBBLE_FRACTION) - RESERVED_PX,
  );
  const maxBars = Math.max(1, Math.floor(maxWaveW / (BAR_W + BAR_GAP)));

  const bars = useMemo(() => {
    const src = meta.waveform.length > 0 ? meta.waveform : [8, 16, 24, 12, 20, 10];
    return downsample(src, maxBars);
  }, [meta.waveform, maxBars]);

  return (
    <View style={styles.row}>
      <Pressable onPress={toggle} hitSlop={8} testID="voice-play">
        <Text style={[styles.icon, {color: tint}]}>{playing ? '■' : '▶'}</Text>
      </Pressable>
      <View style={[styles.wave, {maxWidth: maxWaveW}]}>
        {bars.map((v, i) => (
          <View
            key={i}
            style={{
              width: BAR_W,
              height: Math.max(3, Math.round((Math.min(100, v) / 100) * 22)),
              borderRadius: 1,
              backgroundColor: tint,
              opacity: 0.85,
            }}
          />
        ))}
      </View>
      <Text style={[styles.dur, {color: tint}]}>{formatDuration(meta.durationMs)}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  // #256 — no flex-grow / no fixed minWidth on the row: the bubble now sizes to its
  // content (compact for short notes) and is bounded by the wave's maxWidth cap.
  row: {flexDirection: 'row', alignItems: 'center', gap: 8, flexShrink: 1},
  icon: {...type.title, width: 20, textAlign: 'center'},
  // #256 — `overflow:hidden` + a per-render maxWidth guarantee the waveform can
  // never spill past the cap even if the bar math rounds up.
  wave: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: BAR_GAP,
    flexShrink: 1,
    height: 24,
    overflow: 'hidden',
  },
  dur: {...type.caption, flexShrink: 0},
});
