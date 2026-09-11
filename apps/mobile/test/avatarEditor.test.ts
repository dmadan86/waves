import { describe, expect, it } from 'vitest';

import { avatarPhotoActions } from '@/lib/avatarActions';

const labels = {
  takeNewPhoto: 'Take a photo',
  chooseFromLibrary: 'Choose from library',
  removePhoto: 'Remove photo',
};

describe('avatarPhotoActions', () => {
  it('offers camera and library when a person is setting their first photo', () => {
    // The first avatar tap is often for a face taken right now. Silently opening
    // the library leaves the user, rider, traveller or financer to back out and
    // hunt for the camera door that the sheet says should exist.
    expect(avatarPhotoActions(labels, false)).toEqual([
      { id: 'camera', label: 'Take a photo', icon: 'camera-outline' },
      { id: 'library', label: 'Choose from library', icon: 'images-outline' },
    ]);
  });

  it('adds the destructive remove row only when there is a stored photo to remove', () => {
    expect(avatarPhotoActions(labels, true)).toEqual([
      { id: 'camera', label: 'Take a photo', icon: 'camera-outline' },
      { id: 'library', label: 'Choose from library', icon: 'images-outline' },
      {
        id: 'remove',
        label: 'Remove photo',
        icon: 'trash-outline',
        tone: 'danger',
      },
    ]);
  });
});
