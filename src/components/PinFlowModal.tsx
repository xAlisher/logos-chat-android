// PinFlowModal (#232) — the Settings-side PIN flows over a shared PinPad:
//   • setMain   — Set (new → confirm) OR Update (old → new → confirm) the app PIN.
//   • setDuress — set/replace the duress/wipe PIN (new → confirm).
//   • removeMain— verify the current PIN, then clear the app lock.
// It talks straight to securityStore (which owns persistence + the pure crypto)
// and reports success/cancel back to the caller. Kept out of SettingsScreen so
// the screen stays declarative.
import React, {useEffect, useMemo, useState} from 'react';
import {Modal, Pressable, StyleSheet, Text, View} from 'react-native';
import {colors, type, spacing, radii} from '../theme';
import {PinPad} from './PinPad';
import {useSecurityStore} from '../stores/securityStore';
import {PIN_LENGTH} from '../security/pinSecurity';

export type PinFlowMode = 'setMain' | 'setDuress' | 'removeMain';

type Step = 'old' | 'new' | 'confirm' | 'current';

export function PinFlowModal({
  visible,
  mode,
  onClose,
}: {
  visible: boolean;
  mode: PinFlowMode;
  onClose: (changed: boolean) => void;
}) {
  const hasPin = useSecurityStore(s => s.hasPin);
  const setMainPin = useSecurityStore(s => s.setMainPin);
  const setDuressPin = useSecurityStore(s => s.setDuressPin);
  const removeMainPin = useSecurityStore(s => s.removeMainPin);

  const steps: Step[] = useMemo(() => {
    switch (mode) {
      case 'setMain':
        return hasPin ? ['old', 'new', 'confirm'] : ['new', 'confirm'];
      case 'setDuress':
        return ['new', 'confirm'];
      case 'removeMain':
        return ['current'];
    }
  }, [mode, hasPin]);

  const [idx, setIdx] = useState(0);
  const [pin, setPin] = useState('');
  const [oldPin, setOldPin] = useState<string | null>(null);
  const [newPin, setNewPin] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Reset the flow whenever it (re)opens.
  useEffect(() => {
    if (visible) {
      setIdx(0);
      setPin('');
      setOldPin(null);
      setNewPin('');
      setError(null);
      setBusy(false);
    }
  }, [visible, mode]);

  const step = steps[idx];

  const prompt = () => {
    switch (step) {
      case 'old':
        return 'Enter your current PIN';
      case 'current':
        return 'Enter your PIN to remove the lock';
      case 'new':
        return mode === 'setDuress'
          ? 'Set a wipe PIN (6 digits)'
          : 'Enter a new PIN (6 digits)';
      case 'confirm':
        return 'Confirm the new PIN';
    }
  };

  const title =
    mode === 'setDuress'
      ? 'Wipe PIN'
      : mode === 'removeMain'
      ? 'Remove PIN'
      : hasPin
      ? 'Change PIN'
      : 'Set PIN';

  const fail = (msg: string) => {
    setError(msg);
    setTimeout(() => {
      setError(null);
      setPin('');
    }, 700);
  };

  const submitMain = async (o: string | null, n: string) => {
    setBusy(true);
    const ok = await setMainPin(n, o);
    setBusy(false);
    if (ok) onClose(true);
    else {
      // Only reachable when the OLD pin failed (new pin is pre-validated as 6
      // digits by the pad). Restart from the old-PIN step.
      setIdx(0);
      setOldPin(null);
      setNewPin('');
      fail('Incorrect current PIN');
    }
  };

  const submitDuress = async (n: string) => {
    setBusy(true);
    const ok = await setDuressPin(n);
    setBusy(false);
    if (ok) onClose(true);
    else {
      setIdx(0);
      setNewPin('');
      fail('Choose a PIN different from your unlock PIN');
    }
  };

  const submitRemove = async (current: string) => {
    setBusy(true);
    const ok = await removeMainPin(current);
    setBusy(false);
    if (ok) onClose(true);
    else fail('Incorrect PIN');
  };

  // Advance when the 6th digit lands.
  useEffect(() => {
    if (pin.length < PIN_LENGTH || busy || error != null) return;
    const entered = pin;
    switch (step) {
      case 'current':
        submitRemove(entered);
        break;
      case 'old':
        setOldPin(entered);
        setPin('');
        setIdx(i => i + 1);
        break;
      case 'new':
        setNewPin(entered);
        setPin('');
        setIdx(i => i + 1);
        break;
      case 'confirm':
        if (entered !== newPin) {
          setIdx(steps.indexOf('new'));
          setNewPin('');
          fail("PINs don't match");
        } else if (mode === 'setDuress') {
          submitDuress(newPin);
        } else {
          submitMain(oldPin, newPin);
        }
        break;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pin]);

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={() => onClose(false)}>
      <View style={styles.backdrop}>
        <View style={styles.card} accessibilityViewIsModal>
          <Text style={styles.title}>{title}</Text>
          <Text style={styles.prompt}>{error ?? prompt()}</Text>
          <PinPad value={pin} onChange={setPin} error={error != null} disabled={busy} />
          <Pressable style={styles.cancel} onPress={() => onClose(false)} testID="pinflow-cancel">
            <Text style={styles.cancelText}>Cancel</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.7)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.lg,
  },
  card: {
    backgroundColor: colors.canvas,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radii.card,
    padding: spacing.xl,
    alignItems: 'center',
    gap: spacing.md,
    width: '100%',
    maxWidth: 380,
  },
  title: {...type.brand, color: colors.text, fontSize: 18},
  prompt: {...type.label, color: colors.textDim, textAlign: 'center', minHeight: 18},
  cancel: {padding: spacing.md, marginTop: spacing.sm},
  cancelText: {...type.label, color: colors.accent},
});
