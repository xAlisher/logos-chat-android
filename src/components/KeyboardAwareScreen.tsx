// Shared keyboard-aware screen wrapper (#50). Every input screen wraps its content
// in this so a bottom-anchored field + its primary button stay visible above the
// soft keyboard — the bug caught on NewConversation (opening-message field hidden
// behind the keyboard) and shared by ScanScreen (paste) / NewConversation.
//
// Dependency-free by design (no react-native-keyboard-controller → no extra native
// build). The manifest already sets android:windowSoftInputMode="adjustResize", so
// when the keyboard opens the window (and this ScrollView) shrinks; we add:
//   1. a ScrollView so the shrunken viewport can reach bottom content at all,
//   2. keyboardShouldPersistTaps="handled" so tapping the submit button while the
//      keyboard is up fires the press instead of just dismissing the keyboard,
//   3. an explicit scroll of the *currently focused* input into view (plus room for
//      the button beneath it) on keyboardDidShow — Android's native focus-scroll
//      only guarantees the input rect, not the action button under it.
import React, {useCallback, useRef} from 'react';
import {
  Keyboard,
  Platform,
  ScrollView,
  StyleSheet,
  TextInput,
} from 'react-native';
import type {StyleProp, ViewStyle} from 'react-native';

interface Props {
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
  contentContainerStyle?: StyleProp<ViewStyle>;
}

export function KeyboardAwareScreen({children, style, contentContainerStyle}: Props) {
  const scrollRef = useRef<ScrollView>(null);

  const revealFocusedInput = useCallback(() => {
    // On these screens the focused input and its primary action button are the
    // LAST content, so scrolling to the end reveals BOTH above the keyboard. The
    // manifest's adjustResize has already shrunk this ScrollView by the keyboard
    // height by the time keyboardDidShow settles, so scrollToEnd lands the bottom
    // card (field + "start conversation >>" / "use bundle" / "save contact") just
    // above the keyboard. Short content that already fits is a no-op.
    if (TextInput.State.currentlyFocusedInput?.() == null) {
      return;
    }
    scrollRef.current?.scrollToEnd({animated: true});
  }, []);

  React.useEffect(() => {
    // keyboardDidShow (not WillShow) — on Android only Did* fires with real metrics.
    // A short settle delay lets the adjustResize relayout complete first.
    const showSub = Keyboard.addListener('keyboardDidShow', () => {
      setTimeout(revealFocusedInput, 120);
    });
    return () => showSub.remove();
  }, [revealFocusedInput]);

  return (
    <ScrollView
      ref={scrollRef}
      style={[styles.root, style]}
      contentContainerStyle={[styles.content, contentContainerStyle]}
      keyboardShouldPersistTaps="handled"
      keyboardDismissMode={Platform.OS === 'ios' ? 'interactive' : 'none'}
      showsVerticalScrollIndicator={false}>
      {children}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  root: {flex: 1},
  content: {flexGrow: 1},
});
