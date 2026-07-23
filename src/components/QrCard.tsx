// QrCard — docs/theme.md §4 "Intro bundle". Pure-JS qrcode-generator matrix rendered
// via react-native-svg as a single path; ALWAYS white background / black modules for
// scannability (colors.qrBg/qrFg), ~260dp with a proper quiet zone.
import React, {useMemo} from 'react';
import {View, StyleSheet} from 'react-native';
import Svg, {Path, Rect} from 'react-native-svg';
import qrcode from 'qrcode-generator';
import {colors, radii} from '../theme';

const QUIET_MODULES = 4; // spec quiet zone

export function QrCard({data, size = 260}: {data: string; size?: number}) {
  const {path, total} = useMemo(() => {
    const qr = qrcode(0, 'M'); // type 0 = auto-fit; M correction
    qr.addData(data, 'Byte');
    qr.make();
    const n = qr.getModuleCount();
    let d = '';
    for (let r = 0; r < n; r++) {
      for (let c = 0; c < n; c++) {
        if (qr.isDark(r, c)) {
          d += `M${c + QUIET_MODULES} ${r + QUIET_MODULES}h1v1h-1z`;
        }
      }
    }
    return {path: d, total: n + QUIET_MODULES * 2};
  }, [data]);

  return (
    <View style={[styles.card, {width: size, height: size}]}>
      <Svg width={size} height={size} viewBox={`0 0 ${total} ${total}`}>
        <Rect x={0} y={0} width={total} height={total} fill={colors.qrBg} />
        <Path d={path} fill={colors.qrFg} />
      </Svg>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.qrBg, // ALWAYS white — scannability over theme
    borderRadius: radii.card,
    overflow: 'hidden',
  },
});
