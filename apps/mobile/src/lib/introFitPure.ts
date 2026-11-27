// How an intro card's picture fits the room the wordmark, the text and the dots row leave.
const MIN_STAGE = 120;
const ART_MAX = 270;

export function introFit({ stage, windowWidth }: { stage: number; windowWidth: number }) {
  const showArt = stage >= MIN_STAGE;
  return {
    showArt,
    artSize: showArt ? Math.min(windowWidth - 80, ART_MAX, (stage - 8) / 0.86) : 0,
    // Stage 0 means the text itself overflows: the card scrolls as a last resort.
    needsScroll: stage <= 0,
  };
}

/** Rough free height for the picture: window minus chrome, controls row and the wrapped text. */
export function introStage({
  height,
  width,
  topInset,
  bottomInset,
  titleLen,
  bodyLen,
  fontScale = 1,
}: {
  height: number;
  width: number;
  topInset: number;
  bottomInset: number;
  titleLen: number;
  bodyLen: number;
  fontScale?: number;
}) {
  const short = height < 700;
  const textW = width - 64;
  const lines = (len: number, size: number) =>
    Math.max(1, Math.ceil((len * size * 0.55 * fontScale) / textW));
  const titleSize = short ? 24 : 28;
  const bodySize = short ? 14 : 15;
  const text =
    lines(titleLen, titleSize) * (short ? 29 : 34) * fontScale +
    8 +
    lines(bodyLen, bodySize) * (short ? 20 : 22) * fontScale;
  const wordmark = 24 * fontScale;
  const room = height - (topInset + 12) - wordmark - text - (bottomInset + 24 + 46 + 16);
  return Math.max(0, room);
}
