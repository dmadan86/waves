import { useRef, useState } from 'react';
import { Image } from 'expo-image';
import { FlatList, useWindowDimensions, View, type ListRenderItemInfo } from 'react-native';

import { ZoomableImage } from '@/components/ZoomableImage';
import type { Annotations } from '@/lib/annotations';

/** One gallery page: its resolved URL (null while resolving) and any markup. */
export interface GalleryPage {
  url: string | null;
  /**
   * A tiny stored stand-in for the image, shown while the real bytes are being
   * signed for and fetched. Decoration; null for a receipt kept before there
   * was such a thing.
   */
  preview?: string | null;
  annotations?: Annotations;
}

/**
 * A full-screen, swipeable gallery: one {@link ZoomableImage} per page, paged
 * horizontally. Swiping between pages and pinch-zoom on a page share the same
 * screen, so the two must not fight — while any page is zoomed past fit the
 * pager stops scrolling, and panning moves the enlarged image instead. Back at
 * fit, the swipe returns.
 *
 * The URLs are resolved by the caller (each backend signs its own), so this only
 * draws them; a still-resolving page shows nothing rather than a broken frame.
 */
export function ZoomableGallery({
  pages,
  index,
  onIndexChange,
}: {
  /** One page per image, in order. A page's null url is still resolving. */
  pages: readonly GalleryPage[];
  index: number;
  onIndexChange: (index: number) => void;
}): React.JSX.Element {
  const { width } = useWindowDimensions();
  const [zoomState, setZoomState] = useState<{ url: string | null; zoomed: boolean }>({
    url: null,
    zoomed: false,
  });
  const listRef = useRef<FlatList<GalleryPage>>(null);
  const activeUrl = pages[index]?.url ?? null;
  const zoomed = zoomState.url === activeUrl && zoomState.zoomed;

  const renderItem = ({ item }: ListRenderItemInfo<GalleryPage>) => (
    <View style={{ width, flex: 1, justifyContent: 'center' }}>
      {item.url ? (
        <ZoomableImage
          uri={item.url}
          preview={item.preview}
          onZoomChange={(next) => setZoomState({ url: item.url, zoomed: next })}
          annotations={item.annotations}
        />
      ) : item.preview ? (
        // Nothing to zoom yet — the URL is still being minted — but a blurred
        // wash of the bill beats a black screen, and it is the same picture the
        // real image will fade in over.
        <Image
          source={null}
          placeholder={{ uri: item.preview }}
          placeholderContentFit="contain"
          style={{ width, height: '100%' }}
          contentFit="contain"
        />
      ) : null}
    </View>
  );

  return (
    <FlatList
      ref={listRef}
      data={pages as GalleryPage[]}
      keyExtractor={(_, i) => String(i)}
      renderItem={renderItem}
      horizontal
      pagingEnabled
      // The one rule that keeps swipe and zoom from fighting: no page-to-page
      // scroll while a page is magnified.
      scrollEnabled={!zoomed}
      showsHorizontalScrollIndicator={false}
      initialScrollIndex={index}
      getItemLayout={(_, i) => ({ length: width, offset: width * i, index: i })}
      onMomentumScrollEnd={(event) => {
        const next = Math.round(event.nativeEvent.contentOffset.x / width);
        if (next !== index) onIndexChange(next);
      }}
    />
  );
}
