// VoiceBubble (#205) — renders a voice note: a play/stop button, a compact
// waveform (the amplitude samples captured at record time), and mm:ss duration.
// Playback goes through the native AudioRecorder module; a single
// 'AudioRecorderEvent' 'playbackEnded' resets the button.
import React, {useEffect, useState} from 'react';
import {Pressable, View, Text, StyleSheet, DeviceEventEmitter} from 'react-native';
import {colors, type} from '../theme';
import AudioRecorder from '../native/Audio';
import {formatDuration, type VoiceMeta} from '../native/voiceMsg';

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

  const bars = meta.waveform.length > 0 ? meta.waveform : [8, 16, 24, 12, 20, 10];

  return (
    <View style={styles.row}>
      <Pressable onPress={toggle} hitSlop={8} testID="voice-play">
        <Text style={[styles.icon, {color: tint}]}>{playing ? '■' : '▶'}</Text>
      </Pressable>
      <View style={styles.wave}>
        {bars.map((v, i) => (
          <View
            key={i}
            style={{
              width: 2,
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
  row: {flexDirection: 'row', alignItems: 'center', gap: 8, minWidth: 160},
  icon: {...type.title, width: 20, textAlign: 'center'},
  wave: {flexDirection: 'row', alignItems: 'center', gap: 2, flex: 1, height: 24},
  dur: {...type.caption},
});
