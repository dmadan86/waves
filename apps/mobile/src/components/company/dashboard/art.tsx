/** Small vector empty-state illustrations in the house violet palette (no image weight). */

import Svg, { Circle, G, Line, Path, Rect, Text as SvgText } from 'react-native-svg';

const V1 = '#E4DEFB';
const V2 = '#C9BEF5';
const V3 = '#8B74E8';
const V4 = '#6C4FD8';
const INK = '#3B3A7A';

/** A receipt with a few sparks: "No payments yet". */
export function ReceiptArt({ size = 84 }: { size?: number }) {
  return (
    <Svg width={size} height={(size * 72) / 96} viewBox="0 0 96 72" accessibilityElementsHidden>
      <Path d="M14 40h14v22a8 8 0 0 1-8 8h-6a8 8 0 0 1-8-8v-6a8 8 0 0 1 8-8z" fill={V2} />
      <Rect x="22" y="12" width="52" height="52" rx="8" fill={V1} />
      <Rect x="32" y="26" width="32" height="5" rx="2.5" fill={V2} />
      <Rect x="32" y="38" width="32" height="5" rx="2.5" fill={V2} />
      <Rect x="32" y="50" width="20" height="5" rx="2.5" fill={V2} />
      <G stroke={V3} strokeWidth="2.5" strokeLinecap="round">
        <Line x1="76" y1="6" x2="78" y2="12" />
        <Line x1="84" y1="14" x2="90" y2="16" />
        <Line x1="84" y1="24" x2="90" y2="24" />
      </G>
    </Svg>
  );
}

/** A clipboard with bars, a rupee coin and a calculator: "No budgets yet". */
export function BudgetArt({ width = 190 }: { width?: number }) {
  return (
    <Svg
      width={width}
      height={(width * 130) / 190}
      viewBox="0 0 190 130"
      accessibilityElementsHidden
    >
      <Path
        d="M12 70c0-30 20-54 56-58 40-5 96 4 108 40 8 26-8 58-50 64-40 6-114 4-114-46z"
        fill={V1}
        opacity={0.6}
      />
      <Rect x="50" y="18" width="84" height="96" rx="9" fill={V2} />
      <Rect x="56" y="26" width="72" height="84" rx="6" fill="#F7F5FF" />
      <Rect x="78" y="10" width="28" height="14" rx="6" fill={V3} />
      <Circle cx="92" cy="17" r="3" fill="#F7F5FF" />
      <Rect x="86" y="62" width="9" height="22" rx="2" fill={V3} />
      <Rect x="99" y="52" width="9" height="32" rx="2" fill={V3} />
      <Rect x="112" y="40" width="9" height="44" rx="2" fill={V4} />
      <Rect x="64" y="88" width="56" height="4" rx="2" fill={V2} />
      <Rect x="64" y="98" width="40" height="4" rx="2" fill={V2} />
      <Path
        d="M30 70c-6-2-10 4-8 10 2 8 8 14 14 18-1-8 2-14 8-18-2-6-8-10-14-10z"
        fill={V3}
        opacity={0.8}
      />
      <Rect x="24" y="96" width="30" height="20" rx="4" fill={V2} />
      <Circle cx="48" cy="92" r="19" fill={V4} />
      <Circle cx="48" cy="92" r="14" fill="none" stroke="#B9A9F5" strokeWidth="1.5" />
      <SvgText x="48" y="99" fontSize="20" fontWeight="bold" fill="#fff" textAnchor="middle">
        ₹
      </SvgText>
      <G transform="rotate(8 135 95)">
        <Rect x="112" y="68" width="40" height="52" rx="6" fill={INK} />
        <Rect x="117" y="73" width="30" height="12" rx="2" fill="#B9B4F0" />
        {[0, 1, 2].flatMap((r) =>
          [0, 1, 2].map((c) => (
            <Rect
              key={`${r}${c}`}
              x={118 + c * 10}
              y={90 + r * 9}
              width="7"
              height="6"
              rx="1.5"
              fill="#E4DEFB"
            />
          )),
        )}
      </G>
    </Svg>
  );
}
