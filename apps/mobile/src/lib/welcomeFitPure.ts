// How the welcome screen's picture fits the room the header and the sign-in sheet leave.
const FRIENDS_ASPECT = 1200 / 614;
const MIN_STAGE = 120;

export function welcomeFit({
  stage,
  windowWidth,
  windowHeight,
}: {
  /** Measured height of the free middle area; 0 when the content overflows. */
  stage: number;
  windowWidth: number;
  windowHeight: number;
}) {
  const showFriends = stage >= MIN_STAGE;
  const friendsH = showFriends ? Math.min(windowWidth * 1.08 * (614 / 1200), stage - 8) : 0;
  return {
    friendsH,
    friendsW: friendsH * FRIENDS_ASPECT,
    headlineW: Math.min(windowWidth * 0.53, (windowHeight * 0.2) / 0.693),
    showFriends,
    needsScroll: stage <= 0,
  };
}
