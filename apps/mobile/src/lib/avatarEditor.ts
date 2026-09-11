/**
 * Changing your photo, as one behaviour two screens can both call.
 *
 * Settings shows the portrait and so does the account screen, and both are
 * places somebody expects to be able to tap it. Two copies of this would be two
 * sheets that drift — one offering the camera, the other not; one clearing the
 * stored file on remove, the other only the column. So it lives here once, and
 * the screens own nothing but the avatar they draw.
 *
 * `busy` is for the spinner over the portrait, and `status` is the one line of
 * bad news, which the caller places where its own layout wants it.
 */

import { useCallback, useState } from 'react';

import { removeAvatar, uploadAvatar } from '@/data/api';
import { useStrings } from '@/i18n';
import { useAuth } from '@/lib/auth';
import { useDialog } from '@/lib/dialog';
import { friendlyError } from '@/lib/errors';
import { avatarPhotoActions, type AvatarPhotoAction } from '@/lib/avatarActions';
import { pickAvatarPhoto, type PhotoSource } from '@/lib/image';

export interface AvatarEditor {
  /** Open the sheet that asks where the photo should come from. */
  readonly open: () => void;
  /** A picture is uploading or being removed. */
  readonly busy: boolean;
  /** What went wrong, in words, or null. */
  readonly status: string | null;
}

export function useAvatarEditor(): AvatarEditor {
  const { profile, updateProfile } = useAuth();
  const { t } = useStrings();
  const { choose } = useDialog();
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);

  const choosePhoto = useCallback(
    async (source: PhotoSource): Promise<void> => {
      if (!profile) return;
      const picked = await pickAvatarPhoto(source);
      if (!picked) return;

      setStatus(null);
      setBusy(true);
      try {
        const path = await uploadAvatar({
          profileId: profile.id,
          base64: picked.base64,
          mimeType: picked.mimeType,
        });
        await updateProfile({ avatar_url: path });
      } catch (caught) {
        setStatus(friendlyError(caught, t.couldNotSave, 'profile.uploadPhoto'));
      } finally {
        setBusy(false);
      }
    },
    [profile, updateProfile, t.couldNotSave],
  );

  const clearPhoto = useCallback(async (): Promise<void> => {
    if (!profile) return;
    setBusy(true);
    try {
      // The stored object goes too, not just the column pointing at it.
      await removeAvatar(profile.id, profile.avatar_url);
      await updateProfile({ avatar_url: null });
    } catch (caught) {
      setStatus(friendlyError(caught, t.couldNotSave, 'profile.removePhoto'));
    } finally {
      setBusy(false);
    }
  }, [profile, updateProfile, t.couldNotSave]);

  /**
   * The sheet: where the photo comes from, and how to take it away.
   *
   * The camera and the library are separate rows because a profile photo is
   * usually taken there and then, and one vague "choose a new one" makes
   * somebody open a picker to find out it was not the door they wanted. Each
   * row carries a glyph, which is what lets three short rows be told apart
   * without reading all three, and the row that takes something away carries a
   * red one — so it reads as destructive before the words do.
   */
  const open = useCallback((): void => {
    void (async () => {
      const picked = (await choose({
        title: t.account.yourPhoto,
        options: avatarPhotoActions(t.account, Boolean(profile?.avatar_url)),
      })) as AvatarPhotoAction | null;
      if (picked === 'camera') await choosePhoto('camera');
      else if (picked === 'library') await choosePhoto('library');
      else if (picked === 'remove') await clearPhoto();
    })();
  }, [profile?.avatar_url, choose, choosePhoto, clearPhoto, t.account]);

  return { open, busy, status };
}
