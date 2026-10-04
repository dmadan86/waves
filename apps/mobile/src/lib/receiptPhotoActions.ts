import type { ChooseOption } from '@/lib/dialog';

/**
 * The two doors the quick-expense sheet's camera button offers: the same shape
 * as {@link avatarPhotoActions} ({@link "./avatarActions"}), because a photo
 * sheet with a camera row and a library row below it is a pattern this app
 * already has, not one this feature should reinvent. Unlike the avatar sheet
 * there is no destructive third row — removing an attached receipt is the
 * chip's own "x", not a choice offered here.
 */
export function receiptPhotoActions(labels: {
  readonly takePhoto: string;
  readonly chooseFromLibrary: string;
}): ChooseOption[] {
  return [
    { id: 'camera', label: labels.takePhoto, icon: 'camera-outline' },
    { id: 'library', label: labels.chooseFromLibrary, icon: 'images-outline' },
  ];
}
