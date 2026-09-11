import type { ChooseOption } from '@/lib/dialog';

export type AvatarPhotoAction = 'camera' | 'library' | 'remove';

export function avatarPhotoActions(
  labels: {
    readonly takeNewPhoto: string;
    readonly chooseFromLibrary: string;
    readonly removePhoto: string;
  },
  hasStoredPhoto: boolean,
): ChooseOption[] {
  return [
    { id: 'camera', label: labels.takeNewPhoto, icon: 'camera-outline' },
    { id: 'library', label: labels.chooseFromLibrary, icon: 'images-outline' },
    ...(hasStoredPhoto
      ? [
          {
            id: 'remove',
            label: labels.removePhoto,
            icon: 'trash-outline',
            tone: 'danger' as const,
          },
        ]
      : []),
  ];
}
