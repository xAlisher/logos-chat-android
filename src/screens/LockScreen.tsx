// LockScreen (#232) — the cold-launch PIN gate. Shown by App.tsx BEFORE the
// navigator whenever a main PIN is set and the session isn't unlocked. Delegates
// the decision to the pure gate state machine (evaluateGateAttempt): a correct
// PIN unlocks; the duress/wipe PIN silently wipes + re-identifies and then
// unlocks (indistinguishable from a normal unlock to an onlooker); 3 wrong
// attempts reveal the "Create new identity" wipe affordance.
import React, {useEffect, useMemo, useState} from 'react';
import {ActivityIndicator, StyleSheet, Text, View} from 'react-native';
import {SafeAreaView} from 'react-native-safe-area-context';
import {colors, type, spacing, radii} from '../theme';
import {Logo} from '../components/Logo';
import {HexAvatar} from '../components/HexAvatar';
import {PinPad} from '../components/PinPad';
import {ActionButton} from '../components/ActionButton';
import {useSecurityStore} from '../stores/securityStore';
import {useChatStore} from '../stores/chatStore';
import {useAvatarStore} from '../stores/avatarStore';
import {useNodeStore} from '../stores/nodeStore';
import {
  PIN_LENGTH,
  MAX_PIN_ATTEMPTS,
  evaluateGateAttempt,
  initialGateState,
  type GateState,
} from '../security/pinSecurity';

export function LockScreen() {
  const mainVerifier = useSecurityStore(s => s.mainVerifier);
  const duressVerifier = useSecurityStore(s => s.duressVerifier);
  const unlock = useSecurityStore(s => s.unlock);
  const wipeAndReset = useSecurityStore(s => s.wipeAndReset);
  // Show WHOSE identity is being unlocked (#232 follow-up): the node starts at
  // cold launch independent of the PIN gate, so the address is available here.
  const myAddress = useNodeStore(s => s.myAddress);

  const [pin, setPin] = useState('');
  const [gate, setGate] = useState<GateState>(initialGateState());
  const [error, setError] = useState(false);
  const [busy, setBusy] = useState(false);

  const inputs = useMemo(
    () => ({main: mainVerifier, duress: duressVerifier}),
    [mainVerifier, duressVerifier],
  );

  // Wipe + re-identify, then drop the gate. Shared by the duress path and the
  // explicit "Create new identity" button after lockout.
  const doWipe = async () => {
    setBusy(true);
    try {
      await wipeAndReset();
      await useChatStore.getState().refreshConversations();
      unlock();
    } catch {
      setBusy(false);
      setError(true);
    }
  };

  // Evaluate once the 6th digit lands.
  useEffect(() => {
    if (pin.length < PIN_LENGTH || busy) return;
    const {outcome, state} = evaluateGateAttempt(gate, pin, inputs);
    if (outcome === 'unlock') {
      unlock();
      return;
    }
    if (outcome === 'duress') {
      // #489: drop the gate FIRST so the screen behaves exactly like a normal
      // unlock — no "Preparing…" spinner, no delay cue — then wipe behind the
      // already-dismissed gate. Do NOT surface busy/error here: a spinner or an
      // error dialog on this path is a visible tell that betrays the duress
      // unlock. A kill mid-wipe leaves a partial wipe, acceptable for a
      // destructive op. (The explicit "Create new identity" button still uses
      // doWipe, which shows progress — that path is not covert.)
      // #490: clear the in-memory chat + avatar state and SUPPRESS refreshes BEFORE
      // dropping the gate — so even if a frame paints the uncovered list it renders
      // empty, never the previous identity's conversations (the gate uncovers a list
      // already mounted from the in-memory chatStore). The suppress guard stops a
      // mid-wipe node_status event from repopulating it. Resume + refresh once the
      // wipe finishes (fresh, empty identity). Still covert: no spinner, no error.
      useChatStore.getState().suppressRefresh();
      useChatStore.getState().reset();
      useAvatarStore.getState().reset();
      unlock();
      void (async () => {
        try {
          await wipeAndReset();
        } catch {
          // swallow — surfacing an error here would reveal the duress path
        } finally {
          useChatStore.getState().resumeRefresh();
          void useChatStore.getState().refreshConversations();
        }
      })();
      return;
    }
    // wrong | lockout — flash the dots red, clear, keep the attempt count.
    setGate(state);
    setError(true);
    setTimeout(() => {
      setError(false);
      setPin('');
    }, 500);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pin]);

  const remaining = MAX_PIN_ATTEMPTS - gate.attempts;

  return (
    <SafeAreaView style={styles.root}>
      <View style={styles.hero}>
        {myAddress ? (
          <HexAvatar seed={myAddress} kind="contact" size={56} />
        ) : (
          <Logo size={48} color={colors.accent} strokeWidth={2} />
        )}
        <Text style={styles.title}>Enter PIN</Text>
        <Text style={styles.subtitle}>
          {gate.lockedOut
            ? 'Too many attempts.'
            : gate.attempts > 0
            ? `Incorrect PIN — ${remaining} ${
                remaining === 1 ? 'try' : 'tries'
              } left`
            : 'Unlock to continue'}
        </Text>
      </View>

      {busy ? (
        <View style={styles.busy}>
          <ActivityIndicator color={colors.accent} />
          <Text style={styles.subtitle}>Preparing…</Text>
        </View>
      ) : gate.lockedOut ? (
        <View style={styles.lockout}>
          <View style={styles.warnCard}>
            <Text style={styles.warnTitle}>Create a new identity?</Text>
            <Text style={styles.warnBody}>
              You've entered the wrong PIN {MAX_PIN_ATTEMPTS} times. You can start
              over with a new identity — this permanently deletes all chats,
              groups, and mesh pairings on this device. This cannot be undone.
            </Text>
          </View>
          <ActionButton
            label="Create new identity"
            onPress={doWipe}
            style={styles.dangerBtn}
            testID="lock-wipe"
          />
        </View>
      ) : (
        <PinPad
          value={pin}
          onChange={setPin}
          error={error}
          testID="lock-pinpad"
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: {
    // Opaque absolute-fill overlay above the navigator (#232) — nothing behind
    // it is visible or interactive until the correct PIN is entered.
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    zIndex: 100,
    elevation: 100,
    backgroundColor: colors.canvas,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xl,
    padding: spacing.lg,
  },
  hero: {alignItems: 'center', gap: spacing.sm},
  title: {...type.brand, color: colors.text, fontSize: 22},
  subtitle: {...type.label, color: colors.textDim, textAlign: 'center'},
  busy: {alignItems: 'center', gap: spacing.md},
  lockout: {gap: spacing.lg, width: '100%', maxWidth: 360},
  warnCard: {
    backgroundColor: colors.panel,
    borderColor: colors.errorBorder,
    borderWidth: 1,
    borderRadius: radii.card,
    padding: spacing.lg,
    gap: spacing.sm,
  },
  warnTitle: {...type.title, color: colors.unread},
  warnBody: {...type.label, color: colors.textDim, lineHeight: 18},
  dangerBtn: {backgroundColor: colors.unread},
});
