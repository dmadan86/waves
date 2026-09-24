/**
 * The onboarding tour's pager on the web, where there is no native pager: a
 * paged horizontal `ScrollView`, as the tour used everywhere before
 * `TourPager.tsx`.
 *
 * Pinned left-to-right on purpose, with the reversal done in `@/lib/carousel`:
 * what `contentOffset.x` means in a mirrored scroll view is not agreed on, and
 * react-native-web inherits whichever convention the browser uses for
 * `scrollLeft` in an RTL box.
 */

import { forwardRef, useImperativeHandle, useRef } from 'react';
import {
  ScrollView,
  useWindowDimensions,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from 'react-native';

import { pageForSlide, slideForPage } from '@/lib/carousel';

import type { TourPagerHandle, TourPagerProps } from './TourPager';

export type { TourPagerHandle, TourPagerProps };

export const TourPager = forwardRef<TourPagerHandle, TourPagerProps>(function TourPager(
  { children, rtl, onProgress, onSlideChange },
  ref,
) {
  const { width } = useWindowDimensions();
  const scroller = useRef<ScrollView>(null);
  const placed = useRef(false);
  const current = useRef(0);
  const count = children.length;

  useImperativeHandle(ref, () => ({
    goTo: (slide) =>
      scroller.current?.scrollTo({ x: pageForSlide(slide, count, rtl) * width, animated: true }),
  }));

  // The page under the thumb decides the slide, so a drag and a tap on the
  // arrow cannot disagree. Driven by position rather than momentum-end: a slow
  // drag released without a flick never produces momentum.
  const onScroll = (event: NativeSyntheticEvent<NativeScrollEvent>) => {
    const page = event.nativeEvent.contentOffset.x / width;
    onProgress(rtl ? count - 1 - page : page);
    const slide = slideForPage(Math.round(page), count, rtl);
    if (slide !== current.current) {
      current.current = slide;
      onSlideChange(slide);
    }
  };

  // Right to left the first card is the rightmost one, so the pager does not
  // start where it is scrolled to. Done on content size rather than on layout:
  // at layout time the cards have not been measured and scrolling to the last
  // of them is a no-op.
  const onContentSizeChange = () => {
    if (placed.current || !rtl) return;
    placed.current = true;
    scroller.current?.scrollTo({ x: pageForSlide(0, count, rtl) * width, animated: false });
  };

  return (
    <ScrollView
      ref={scroller}
      horizontal
      pagingEnabled
      showsHorizontalScrollIndicator={false}
      onScroll={onScroll}
      onContentSizeChange={onContentSizeChange}
      scrollEventThrottle={16}
      style={{ flex: 1, direction: 'ltr' }}
    >
      {rtl ? [...children].reverse() : children}
    </ScrollView>
  );
});
