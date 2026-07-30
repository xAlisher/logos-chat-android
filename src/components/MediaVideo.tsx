// #300 — inline muted/looping video-gif player (native TextureView+MediaPlayer).
import {requireNativeComponent, type ViewStyle} from 'react-native';

interface MediaVideoProps {
  /** absolute path to a local (decrypted) video file. */
  path: string;
  style?: ViewStyle;
}

// Native name matches MediaVideoViewManager.getName().
export const MediaVideo = requireNativeComponent<MediaVideoProps>('MediaVideo');
