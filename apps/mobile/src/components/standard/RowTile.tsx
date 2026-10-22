import type { ReactNode } from 'react';
import { View } from 'react-native';

/** The 44dp circular tinted tile that leads a row in a settings card. */
export function RowTile({ tint, children }: { tint: string; children: ReactNode }) {
  return (
    <View
      style={{
        width: 44,
        height: 44,
        borderRadius: 22,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: tint,
      }}
    >
      {children}
    </View>
  );
}
