// #254 — MeshCore node/radio configuration, parity with the MeshCore companion
// app. Read-before-edit: the radio params come from the SELF_INFO tail captured at
// connect (meshStore.radio); device info + battery are read on mount via
// getNodeConfig. All writes go through the verified companion verbs
// (docs/meshcore-config-protocol.md). Applying radio params over a live LoRa link
// can only be verified against a real radio (wetware).
import React, {useEffect, useState} from 'react';
import {
  ActivityIndicator,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  ToastAndroid,
  View,
} from 'react-native';
import {SafeAreaView} from 'react-native-safe-area-context';
import {colors, type, spacing, radii} from '../theme';
import {ErrorToast} from '../components/ErrorToast';
import {useMeshStore} from '../stores/meshStore';

// MeshCore-standard region presets (freq MHz, bw kHz, sf, cr). Starting points —
// they MUST match your peers' radio to mesh with them. Editable after selecting.
const PRESETS: {label: string; freqMHz: number; bwKHz: number; sf: number; cr: number}[] = [
  {label: 'EU 868', freqMHz: 869.525, bwKHz: 250, sf: 11, cr: 5},
  {label: 'US 915', freqMHz: 910.525, bwKHz: 250, sf: 11, cr: 5},
  {label: 'AU/NZ 915', freqMHz: 915.0, bwKHz: 250, sf: 11, cr: 5},
];

function Section({title, children}: {title: string; children: React.ReactNode}) {
  return (
    <View>
      <Text style={styles.section}>{title}</Text>
      <View style={styles.card}>{children}</View>
    </View>
  );
}

function Field({
  label,
  value,
  onChangeText,
  keyboardType = 'numeric',
  placeholder,
}: {
  label: string;
  value: string;
  onChangeText: (t: string) => void;
  keyboardType?: 'numeric' | 'default';
  placeholder?: string;
}) {
  return (
    <View style={styles.fieldRow}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <TextInput
        style={styles.input}
        value={value}
        onChangeText={onChangeText}
        keyboardType={keyboardType}
        placeholder={placeholder}
        placeholderTextColor={colors.textFaint}
      />
    </View>
  );
}

export function MeshConfigScreen() {
  const connected = useMeshStore(s => s.status === 'connected');
  const radio = useMeshStore(s => s.radio);
  const nodeConfig = useMeshStore(s => s.nodeConfig);
  const error = useMeshStore(s => s.error);
  const clearError = useMeshStore(s => s.clearError);
  const refreshNodeConfig = useMeshStore(s => s.refreshNodeConfig);
  const setRadioParams = useMeshStore(s => s.setRadioParams);
  const setTxPower = useMeshStore(s => s.setTxPower);
  const setAdvertLatLon = useMeshStore(s => s.setAdvertLatLon);
  const syncDeviceTime = useMeshStore(s => s.syncDeviceTime);
  const sendSelfAdvert = useMeshStore(s => s.sendSelfAdvert);
  const rebootRadio = useMeshStore(s => s.rebootRadio);

  // Editable copies, seeded from the live radio params (read-before-edit).
  const [freq, setFreq] = useState('');
  const [bw, setBw] = useState('');
  const [sf, setSf] = useState('');
  const [cr, setCr] = useState('');
  const [txp, setTxp] = useState('');
  const [lat, setLat] = useState('');
  const [lon, setLon] = useState('');
  const [flood, setFlood] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [confirmReboot, setConfirmReboot] = useState(false);

  useEffect(() => {
    if (connected) refreshNodeConfig();
  }, [connected, refreshNodeConfig]);

  // Reseed the editable fields whenever the live params change (connect / apply).
  useEffect(() => {
    if (radio) {
      if (radio.freqMHz != null) setFreq(String(radio.freqMHz));
      if (radio.bwKHz != null) setBw(String(radio.bwKHz));
      if (radio.sf != null) setSf(String(radio.sf));
      if (radio.cr != null) setCr(String(radio.cr));
      if (radio.txPowerDbm != null) setTxp(String(radio.txPowerDbm));
    }
  }, [radio]);

  const run = async (key: string, fn: () => Promise<boolean>, okMsg: string) => {
    setBusy(key);
    try {
      const ok = await fn();
      if (ok) ToastAndroid.show(okMsg, ToastAndroid.SHORT);
    } finally {
      setBusy(null);
    }
  };

  const applyPreset = (p: (typeof PRESETS)[number]) => {
    setFreq(String(p.freqMHz));
    setBw(String(p.bwKHz));
    setSf(String(p.sf));
    setCr(String(p.cr));
  };

  const applyRadio = () => {
    const f = parseFloat(freq);
    const b = parseFloat(bw);
    const s = parseInt(sf, 10);
    const c = parseInt(cr, 10);
    if (!isFinite(f) || !isFinite(b) || !isFinite(s) || !isFinite(c)) {
      useMeshStore.setState({error: 'Enter valid numbers for freq, bandwidth, SF, CR'});
      return;
    }
    run('radio', () => setRadioParams(f, b, s, c), 'Radio params applied');
  };

  const applyTxp = () => {
    const p = parseInt(txp, 10);
    if (!isFinite(p)) {
      useMeshStore.setState({error: 'Enter a valid TX power (dBm)'});
      return;
    }
    run('txp', () => setTxPower(p), 'TX power set');
  };

  const applyLatLon = () => {
    const la = parseFloat(lat);
    const lo = parseFloat(lon);
    if (!isFinite(la) || !isFinite(lo)) {
      useMeshStore.setState({error: 'Enter a valid latitude and longitude'});
      return;
    }
    run('latlon', () => setAdvertLatLon(la, lo), 'Advert location set');
  };

  if (!connected) {
    return (
      <SafeAreaView edges={['bottom']} style={styles.root}>
        <View style={styles.center}>
          <Text style={[type.body, {color: colors.textDim}]}>
            Connect a MeshCore radio first to configure it.
          </Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView edges={['bottom']} style={styles.root}>
      <ScrollView contentContainerStyle={styles.content}>
        <Section title="Device">
          <Row k="Firmware" v={nodeConfig?.firmwareVersion ?? '…'} />
          <Row k="Build" v={nodeConfig?.buildDate ?? '…'} />
          <Row k="Hardware" v={nodeConfig?.manufacturer ?? '…'} />
          <Row
            k="Battery"
            v={nodeConfig?.batteryMv != null ? `${(nodeConfig.batteryMv / 1000).toFixed(2)} V` : '…'}
          />
          <Row
            k="Storage"
            v={
              nodeConfig?.storageTotalKb != null
                ? `${nodeConfig.storageUsedKb ?? 0} / ${nodeConfig.storageTotalKb} KB`
                : '…'
            }
          />
          <Row k="PIN" v={nodeConfig?.blePin ? 'set' : 'none'} />
        </Section>

        <Section title="Radio">
          <Text style={styles.help}>
            Current: {radio?.freqMHz ?? '?'} MHz · {radio?.bwKHz ?? '?'} kHz · SF
            {radio?.sf ?? '?'} · CR{radio?.cr ?? '?'}. These must match your peers'
            radio to mesh with them.
          </Text>
          <View style={styles.presetRow}>
            {PRESETS.map(p => (
              <Pressable key={p.label} style={styles.preset} onPress={() => applyPreset(p)}>
                <Text style={styles.presetText}>{p.label}</Text>
              </Pressable>
            ))}
          </View>
          <Field label="Frequency (MHz)" value={freq} onChangeText={setFreq} />
          <Field label="Bandwidth (kHz)" value={bw} onChangeText={setBw} />
          <Field label="Spreading factor" value={sf} onChangeText={setSf} />
          <Field label="Coding rate" value={cr} onChangeText={setCr} />
          <PrimaryBtn label="Apply radio params" busy={busy === 'radio'} onPress={applyRadio} />
        </Section>

        <Section title="TX power">
          <Field
            label={`Power (dBm)${radio?.maxTxPowerDbm != null ? ` · max ${radio.maxTxPowerDbm}` : ''}`}
            value={txp}
            onChangeText={setTxp}
          />
          <PrimaryBtn label="Set TX power" busy={busy === 'txp'} onPress={applyTxp} />
        </Section>

        <Section title="Advert">
          <View style={styles.toggleRow}>
            <Text style={styles.fieldLabel}>Flood (multi-hop)</Text>
            <Switch
              value={flood}
              onValueChange={setFlood}
              trackColor={{false: colors.border, true: colors.accent}}
              thumbColor={colors.text}
            />
          </View>
          <PrimaryBtn
            label="Broadcast advert now"
            busy={busy === 'advert'}
            onPress={() => run('advert', () => sendSelfAdvert(flood), 'Advert broadcast')}
          />
          <View style={styles.sep} />
          <Field label="Latitude" value={lat} onChangeText={setLat} placeholder="e.g. 41.311" />
          <Field label="Longitude" value={lon} onChangeText={setLon} placeholder="e.g. 69.240" />
          <PrimaryBtn label="Set advert location" busy={busy === 'latlon'} onPress={applyLatLon} />
        </Section>

        <Section title="Maintenance">
          <PrimaryBtn
            label="Sync clock to phone"
            busy={busy === 'time'}
            onPress={() => run('time', syncDeviceTime, 'Clock synced')}
          />
          <View style={styles.sep} />
          <Pressable style={styles.dangerBtn} onPress={() => setConfirmReboot(true)}>
            <Text style={[type.title, {color: colors.unread}]}>Reboot radio</Text>
          </Pressable>
        </Section>
      </ScrollView>

      <Modal
        visible={confirmReboot}
        transparent
        animationType="fade"
        onRequestClose={() => setConfirmReboot(false)}>
        <View style={styles.backdrop}>
          <View style={styles.warnCard}>
            <Text style={styles.warnTitle}>Reboot the radio?</Text>
            <Text style={styles.warnBody}>
              The radio restarts and the Bluetooth link drops — you'll need to
              reconnect. Messages queued on the radio are preserved.
            </Text>
            <View style={styles.warnActions}>
              <Pressable style={styles.flex1} onPress={() => setConfirmReboot(false)}>
                <Text style={[type.title, {color: colors.text, textAlign: 'center'}]}>Cancel</Text>
              </Pressable>
              <Pressable
                style={[styles.flex1, styles.dangerBtn]}
                onPress={() => {
                  setConfirmReboot(false);
                  run('reboot', rebootRadio, 'Rebooting…');
                }}>
                <Text style={[type.title, {color: colors.unread, textAlign: 'center'}]}>
                  Reboot
                </Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>

      <ErrorToast message={error} onDismiss={clearError} />
    </SafeAreaView>
  );
}

function Row({k, v}: {k: string; v: string}) {
  return (
    <View style={styles.infoRow}>
      <Text style={styles.infoK}>{k}</Text>
      <Text style={styles.infoV} numberOfLines={1}>
        {v}
      </Text>
    </View>
  );
}

function PrimaryBtn({label, busy, onPress}: {label: string; busy: boolean; onPress: () => void}) {
  return (
    <Pressable style={[styles.btn, busy && styles.btnDisabled]} disabled={busy} onPress={onPress}>
      {busy ? (
        <ActivityIndicator color={colors.onAccent} />
      ) : (
        <Text style={[type.title, {color: colors.onAccent}]}>{label}</Text>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  root: {flex: 1, backgroundColor: colors.canvas},
  center: {flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.xl},
  content: {padding: spacing.lg, gap: spacing.md},
  section: {...type.label, color: colors.accent, marginTop: spacing.sm, marginBottom: spacing.xs},
  card: {
    backgroundColor: colors.panel,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radii.card,
    padding: spacing.lg,
    gap: spacing.md,
  },
  help: {...type.caption, color: colors.textDim, lineHeight: 18},
  infoRow: {flexDirection: 'row', justifyContent: 'space-between', gap: spacing.md},
  infoK: {...type.label, color: colors.textDim},
  infoV: {...type.label, color: colors.text, flexShrink: 1, textAlign: 'right'},
  fieldRow: {gap: spacing.xs},
  fieldLabel: {...type.caption, color: colors.textFaint, textTransform: 'uppercase'},
  input: {
    ...type.body,
    color: colors.text,
    backgroundColor: colors.pane,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radii.card,
    paddingHorizontal: spacing.md,
    minHeight: 44,
  },
  presetRow: {flexDirection: 'row', gap: spacing.sm, flexWrap: 'wrap'},
  preset: {
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radii.card,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
  },
  presetText: {...type.label, color: colors.text},
  toggleRow: {flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between'},
  btn: {
    backgroundColor: colors.accent,
    borderRadius: radii.card,
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  btnDisabled: {opacity: 0.5},
  dangerBtn: {
    borderColor: colors.errorBorder,
    borderWidth: 1,
    borderRadius: radii.card,
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sep: {height: 1, backgroundColor: colors.border},
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.7)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.lg,
  },
  warnCard: {
    backgroundColor: colors.canvas,
    borderColor: colors.errorBorder,
    borderWidth: 1,
    borderRadius: radii.card,
    padding: spacing.xl,
    gap: spacing.md,
    width: '100%',
    maxWidth: 380,
  },
  warnTitle: {...type.title, color: colors.unread},
  warnBody: {...type.label, color: colors.textDim, lineHeight: 18},
  warnActions: {flexDirection: 'row', gap: spacing.md, marginTop: spacing.sm, alignItems: 'center'},
  flex1: {flex: 1, minHeight: 44, alignItems: 'center', justifyContent: 'center'},
});
