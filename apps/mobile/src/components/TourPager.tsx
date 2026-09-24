/**
 * The onboarding tour's pager, native: `ViewPager2` on Android and the platform
 * pager on iOS, through react-native-pager-view.
 *
 * It used to be a paged horizontal `ScrollView`, which on Android is a fling
 * followed by a separate snap: a swipe slowed almost to a stop halfway across
 * and then sped up again, and the arrow's `scrollTo` ran its own, different
 * curve. A native pager moves a page in one motion, with the platform's own
 * timing, whether it was dragged or asked for.
 *
 * Right to left is the pager's own job here (`layoutDirection`): positions are
 * slide indices either way, so none of `@/lib/carousel`'s arithmetic applies.
 * The web build has no native pager and keeps the scroll view
 * (`TourPager.web.tsx`).
 */

import { forwardRef, useImperativeHandle, useRef, type ReactNode } from 'react';
import PagerView from 'react-native-pager-view';

export interface TourPagerHandle {
  /** Animate to a card. */
  goTo: (slide: number) => void;
}

export interface TourPagerProps {
  /** The cards, first slide first. */
  children: ReactNode[];
  rtl: boolean;
  /** Where the pager is, in slides, continuously: 1.5 is halfway from the second to the third. */
  onProgress: (slide: number) => void;
  /** The card that is now the current one. */
  onSlideChange: (slide: number) => void;
}

export const TourPager = forwardRef<TourPagerHandle, TourPagerProps>(function TourPager(
  { children, rtl, onProgress, onSlideChange },
  ref,
) {
  const pager = useRef<PagerView>(null);

  useImperativeHandle(ref, () => ({
    goTo: (slide) => pager.current?.setPage(slide),
  }));

  return (
    <PagerView
      ref={pager}
      style={{ flex: 1 }}
      initialPage={0}
      layoutDirection={rtl ? 'rtl' : 'ltr'}
      // No glow or stretch past the first or last card; there is nothing there.
      overScrollMode="never"
      onPageScroll={(event) => onProgress(event.nativeEvent.position + event.nativeEvent.offset)}
      onPageSelected={(event) => onSlideChange(event.nativeEvent.position)}
    >
      {children}
    </PagerView>
  );
});
