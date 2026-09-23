import { beforeEach, describe, expect, it, vi } from 'vitest';

import { avatarPhotoActions } from '@/lib/avatarActions';

import { flush, renderHook } from './support/fakeReact';

const h = vi.hoisted(() => ({
  profile: null as { id: string; avatar_url: string | null } | null,
  updateProfile: vi.fn(),
  choose: vi.fn(),
  pickAvatarPhoto: vi.fn(),
  uploadAvatar: vi.fn(),
  removeAvatar: vi.fn(),
  friendlyError: vi.fn(
    (_caught: unknown, fallback: string, where: string) => `${fallback}@${where}`,
  ),
}));

vi.mock('react', async () => (await import('./support/fakeReact')).reactModule());
vi.mock('@/data/api', () => ({ uploadAvatar: h.uploadAvatar, removeAvatar: h.removeAvatar }));
vi.mock('@/i18n', () => ({
  useStrings: () => ({
    t: {
      couldNotSave: 'Could not save',
      account: {
        yourPhoto: 'Your photo',
        takeNewPhoto: 'Take a photo',
        chooseFromLibrary: 'Choose from library',
        removePhoto: 'Remove photo',
      },
    },
  }),
}));
vi.mock('@/lib/auth', () => ({
  useAuth: () => ({ profile: h.profile, updateProfile: h.updateProfile }),
}));
vi.mock('@/lib/dialog', () => ({ useDialog: () => ({ choose: h.choose }) }));
vi.mock('@/lib/errors', () => ({ friendlyError: h.friendlyError }));
vi.mock('@/lib/image', () => ({ pickAvatarPhoto: h.pickAvatarPhoto }));

const { useAvatarEditor } = await import('@/lib/avatarEditor');

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

describe('useAvatarEditor', () => {
  const PICKED = { base64: 'QUJD', mimeType: 'image/webp', uri: 'file:///a.webp' };

  beforeEach(() => {
    h.profile = { id: 'p1', avatar_url: 'avatars/p1/old.jpg' };
    h.updateProfile.mockReset().mockResolvedValue(undefined);
    h.choose.mockReset();
    h.pickAvatarPhoto.mockReset().mockResolvedValue(PICKED);
    h.uploadAvatar.mockReset().mockResolvedValue('avatars/p1/new.webp');
    h.removeAvatar.mockReset().mockResolvedValue(undefined);
    h.friendlyError.mockClear();
  });

  async function openAndChoose(answer: string | null) {
    h.choose.mockResolvedValue(answer);
    const view = renderHook(() => useAvatarEditor());
    view.result.current.open();
    await flush();
    return view;
  }

  it('asks where the photo comes from, offering remove only when there is one', async () => {
    await openAndChoose(null);
    expect(h.choose).toHaveBeenCalledWith({
      title: 'Your photo',
      options: avatarPhotoActions(labels, true),
    });

    h.profile = { id: 'p1', avatar_url: null };
    await openAndChoose(null);
    expect(h.choose).toHaveBeenLastCalledWith({
      title: 'Your photo',
      options: avatarPhotoActions(labels, false),
    });
  });

  it.each(['camera', 'library'] as const)(
    'uploads a %s photo and points the profile at it',
    async (source) => {
      const view = await openAndChoose(source);

      expect(h.pickAvatarPhoto).toHaveBeenCalledWith(source);
      expect(h.uploadAvatar).toHaveBeenCalledWith({
        profileId: 'p1',
        base64: 'QUJD',
        mimeType: 'image/webp',
      });
      expect(h.updateProfile).toHaveBeenCalledWith({ avatar_url: 'avatars/p1/new.webp' });
      expect(view.result.current).toMatchObject({ busy: false, status: null });
    },
  );

  it('shows the spinner while the upload is in flight', async () => {
    let finish!: (path: string) => void;
    h.uploadAvatar.mockReturnValue(new Promise((resolve) => (finish = resolve)));
    const view = await openAndChoose('camera');
    expect(view.result.current.busy).toBe(true);

    finish('avatars/p1/new.webp');
    await flush();
    expect(view.result.current.busy).toBe(false);
  });

  it('does nothing when the person backs out of the picker', async () => {
    h.pickAvatarPhoto.mockResolvedValue(null);
    const view = await openAndChoose('library');
    expect(h.uploadAvatar).not.toHaveBeenCalled();
    expect(view.result.current.busy).toBe(false);
  });

  it('puts a failed upload into words and clears the spinner', async () => {
    h.uploadAvatar.mockRejectedValue(new Error('413'));
    const view = await openAndChoose('camera');

    expect(view.result.current).toEqual(
      expect.objectContaining({ busy: false, status: 'Could not save@profile.uploadPhoto' }),
    );
    expect(h.updateProfile).not.toHaveBeenCalled();
  });

  it('removes the stored file as well as the column', async () => {
    const view = await openAndChoose('remove');

    expect(h.removeAvatar).toHaveBeenCalledWith('p1', 'avatars/p1/old.jpg');
    expect(h.updateProfile).toHaveBeenCalledWith({ avatar_url: null });
    expect(view.result.current.busy).toBe(false);
  });

  it('reports a failed removal', async () => {
    h.removeAvatar.mockRejectedValue(new Error('offline'));
    const view = await openAndChoose('remove');

    expect(view.result.current.status).toBe('Could not save@profile.removePhoto');
    expect(h.updateProfile).not.toHaveBeenCalled();
  });

  it('does nothing without a profile, whichever row is tapped', async () => {
    h.profile = null;
    await openAndChoose('camera');
    await openAndChoose('remove');

    expect(h.pickAvatarPhoto).not.toHaveBeenCalled();
    expect(h.removeAvatar).not.toHaveBeenCalled();
  });
});
