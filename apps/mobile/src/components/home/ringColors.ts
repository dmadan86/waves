/** Ring colours: on the scenic photo a pale brand arc disappears, so use white on a dark track. */
export function ringColors(solid: boolean, theme: { color: { border: string; brand: string } }) {
  return solid
    ? { track: theme.color.border, arc: theme.color.brand }
    : { track: 'rgba(0,0,0,0.35)', arc: '#FFFFFF' };
}
