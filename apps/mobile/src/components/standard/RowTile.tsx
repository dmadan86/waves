import type { ReactNode } from 'react';
import { View } from 'react-native';

/** The 48dp rounded-square tinted tile that leads a row in a settings card. */
export function RowTile({ tint, children }: { tint: string; children: ReactNode }) {
  return (
    <View
      style={{
        width: 48,
        height: 48,
        borderRadius: 14,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: tint,
      }}
    >
      {children}
    </View>
  );
}
