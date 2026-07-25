// QrCard — docs/theme.md §4 "Intro bundle". Pure-JS qrcode-generator matrix rendered
// via react-native-svg as a single path; ALWAYS white background / black modules for
// scannability (colors.qrBg/qrFg), ~260dp with a proper quiet zone.
//
// Optional centered identicon badge (#118): pass badgeSeed/badgeKind to draw the
// contact/group identicon in the middle of the code — drawn INTO the same <Svg> as
// the modules (a white rounded backing + the identicon cells as vector rects) so there
// is no native-view compositing to fight. Error correction is bumped to 'H' (30%) when
// a badge is present so the modules the badge covers stay recoverable.
import React, {useMemo} from 'react';
import {View, StyleSheet} from 'react-native';
import Svg, {Path, Rect} from 'react-native-svg';
import qrcode from 'qrcode-generator';
import {colors, radii} from '../theme';
import {identiconCells, AVATAR_N} from './HexAvatar';

const QUIET_MODULES = 4; // spec quiet zone

export function QrCard({
  data,
  size = 260,
  badgeSeed,
  badgeKind = 'contact',
}: {
  data: string;
  size?: number;
  /** When set, draw this identicon in the center of the QR (#118). */
  badgeSeed?: string;
  badgeKind?: 'contact' | 'group';
}) {
  const badged = badgeSeed != null && badgeSeed.length > 0;
  const {path, total} = useMemo(() => {
    // Higher correction ('H' = 30%) when a badge occludes the center modules.
    const qr = qrcode(0, badged ? 'H' : 'M'); // type 0 = auto-fit
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
  }, [data, badged]);

  // Badge geometry, in QR module units (the Svg viewBox is `total` wide). The
  // badge is a DARK rounded tile (same ground as the list avatars) with a white
  // outer stroke, so the identicon reads identically to everywhere else (#118).
  const backing = total * 0.26; // outer (white stroke) side
  const b0 = (total - backing) / 2; // outer origin
  const stroke = backing * 0.08; // white stroke thickness
  const tile = backing - stroke; // dark tile side (stroke shows as the border)
  const t0 = (total - tile) / 2; // dark tile origin
  const inner = tile * 0.78; // identicon area inside the dark tile (padding)
  const cell = inner / AVATAR_N;
  const i0 = (total - inner) / 2; // identicon origin
  const cells = badged ? identiconCells(badgeSeed!, badgeKind) : [];

  return (
    <View style={[styles.card, {width: size, height: size}]}>
      <Svg width={size} height={size} viewBox={`0 0 ${total} ${total}`}>
        <Rect x={0} y={0} width={total} height={total} fill={colors.qrBg} />
        <Path d={path} fill={colors.qrFg} />
        {badged && (
          <>
            {/* White outer stroke — separates the tile from the modules. */}
            <Rect
              x={b0}
              y={b0}
              width={backing}
              height={backing}
              rx={backing * 0.24}
              ry={backing * 0.24}
              fill={colors.qrBg}
            />
            {/* Dark tile — same ground as the list avatars. */}
            <Rect
              x={t0}
              y={t0}
              width={tile}
              height={tile}
              rx={tile * 0.22}
              ry={tile * 0.22}
              fill={colors.canvas}
            />
            {cells.map(c => (
              <Rect
                key={`${c.x}-${c.y}`}
                x={i0 + c.x * cell}
                y={i0 + c.y * cell}
                width={cell + 0.02}
                height={cell + 0.02}
                fill={c.fill}
              />
            ))}
          </>
        )}
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
