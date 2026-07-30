// #300 — native TextureView+MediaPlayer video player.
//   - Inline: muted, looping, auto-playing preview (just <MediaVideo path=... />).
//   - Fullscreen: pass controls + paused + onLoad/onProgress and drive seek() via ref;
//     VideoFullscreen draws the play/pause + seek bar on top.
import React, {forwardRef, useImperativeHandle, useRef} from 'react';
import {
  UIManager,
  findNodeHandle,
  requireNativeComponent,
  type NativeSyntheticEvent,
  type ViewStyle,
} from 'react-native';

interface NativeProps {
  path: string;
  muted?: boolean;
  controls?: boolean;
  paused?: boolean;
  onVideoLoad?: (e: NativeSyntheticEvent<{duration: number}>) => void;
  onVideoProgress?: (
    e: NativeSyntheticEvent<{currentTime: number; isPlaying: boolean}>,
  ) => void;
  style?: ViewStyle;
}

// Native name matches MediaVideoViewManager.getName().
const NativeMediaVideo = requireNativeComponent<NativeProps>('MediaVideo');

export interface MediaVideoHandle {
  /** Seek the underlying MediaPlayer to an absolute position (ms). */
  seek: (ms: number) => void;
}

export interface MediaVideoProps {
  /** absolute path to a local (decrypted) video file. */
  path: string;
  /** inline previews are muted; fullscreen passes muted={false}. */
  muted?: boolean;
  /** fullscreen: report progress so JS can draw controls. */
  controls?: boolean;
  /** fullscreen: play/pause state, driven by the JS controls. */
  paused?: boolean;
  onLoad?: (duration: number) => void;
  onProgress?: (currentTime: number, isPlaying: boolean) => void;
  style?: ViewStyle;
}

export const MediaVideo = forwardRef<MediaVideoHandle, MediaVideoProps>(function MediaVideo(
  {path, muted, controls, paused, onLoad, onProgress, style},
  ref,
) {
  const nativeRef = useRef(null);
  useImperativeHandle(ref, () => ({
    seek: (ms: number) => {
      const node = findNodeHandle(nativeRef.current);
      if (node != null) {
        UIManager.dispatchViewManagerCommand(node, 'seek', [Math.round(ms)]);
      }
    },
  }));
  return (
    <NativeMediaVideo
      ref={nativeRef}
      path={path}
      muted={muted}
      controls={controls}
      paused={paused}
      onVideoLoad={onLoad != null ? e => onLoad(e.nativeEvent.duration) : undefined}
      onVideoProgress={
        onProgress != null
          ? e => onProgress(e.nativeEvent.currentTime, e.nativeEvent.isPlaying)
          : undefined
      }
      style={style}
    />
  );
});
