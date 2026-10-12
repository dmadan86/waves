import { View } from 'react-native';
import QRCodeStyled from 'react-native-qrcode-styled';
import { Rect } from 'react-native-svg';

import { useTheme } from '@waves/ui';

const BRACKET_GAP = 8;

/**
 * The invite QR on its own white plate with the brand's corner brackets round
 * it. One component for the screen and the shared image, so the code that is
 * scanned off the picture is exactly the one on the screen.
 */
export function InviteQr({ link, size }: { link: string; size: number }) {
  const theme = useTheme();
  return (
    // The code sits on its own white plate whatever the theme is doing: a QR on
    // a dark ground does not scan. The brackets are the brand's frame round it;
    // they sit outside the plate, in the wrapper's padding, so they never cover
    // a module.
    <View style={{ alignSelf: 'center', padding: BRACKET_GAP }}>
      <View style={{ backgroundColor: '#ffffff', borderRadius: theme.radius.sm }}>
        <QRCodeStyled
          data={link}
          size={size}
          padding={8}
          style={{ backgroundColor: '#ffffff' }}
          // The RN `backgroundColor` style is not rasterised by
          // `toDataURL`, so a captured/shared PNG would come out with a
          // transparent ground — the dark pieces then vanish on a dark
          // chat bubble (WhatsApp). Paint the white quiet zone as an SVG
          // layer behind the code instead, so it is part of the export.
          renderBackground={() => <Rect x={-40} y={-40} width={330} height={330} fill="#ffffff" />}
          color="#0A0A1A"
          errorCorrectionLevel="H"
          pieceBorderRadius="50%"
          pieceScale={0.92}
          outerEyesOptions={{ borderRadius: '28%', color: '#0A0A1A' }}
          innerEyesOptions={{ borderRadius: '35%', color: '#0A0A1A' }}
          logo={{
            href: require('../../../assets/images/icon.png') as number,
            scale: 0.85,
            padding: 4,
            hidePieces: true,
          }}
        />
      </View>
      <Bracket corner="top-start" color={theme.color.brand} />
      <Bracket corner="top-end" color={theme.color.brand} />
      <Bracket corner="bottom-start" color={theme.color.brand} />
      <Bracket corner="bottom-end" color={theme.color.brand} />
    </View>
  );
}

/**
 * One corner of the frame round the QR. Border start/end rather than left/right,
 * so the pair mirrors in Arabic (the frame is symmetric, but the habit holds).
 */
function Bracket({
  corner,
  color,
}: {
  corner: 'top-start' | 'top-end' | 'bottom-start' | 'bottom-end';
  color: string;
}) {
  const top = corner.startsWith('top');
  const start = corner.endsWith('start');
  return (
    <View
      pointerEvents="none"
      style={{
        position: 'absolute',
        ...(top ? { top: 0 } : { bottom: 0 }),
        ...(start ? { start: 0 } : { end: 0 }),
        width: 22,
        height: 22,
        borderColor: color,
        ...(top ? { borderTopWidth: 3 } : { borderBottomWidth: 3 }),
        ...(start ? { borderStartWidth: 3 } : { borderEndWidth: 3 }),
        ...(top && start ? { borderTopStartRadius: 10 } : null),
        ...(top && !start ? { borderTopEndRadius: 10 } : null),
        ...(!top && start ? { borderBottomStartRadius: 10 } : null),
        ...(!top && !start ? { borderBottomEndRadius: 10 } : null),
      }}
    />
  );
}
