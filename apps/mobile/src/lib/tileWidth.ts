/** Width of one of `columns` equal tiles in a row of `containerWidth` with `gap` between them. */
export function tileWidth(containerWidth: number, gap: number, columns: number): number {
  return (containerWidth - gap * (columns - 1)) / columns;
}
