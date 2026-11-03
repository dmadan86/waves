'use client';

/** Photos on one company entry: signed thumbnails, add (online upload + attach RPC) and remove. */
import { useEffect, useState } from 'react';

import { ImageViewer } from '@/components/ImageViewer';
import { putImage } from '@/lib/upload';
import { supabase, waves } from '@/lib/waves';
import { removeCompanyPhoto, useCompanyPhotos } from './entryActions';
import { entryStrings as s } from './entryStrings';

export const MAX_COMPANY_PHOTOS = 10;

/** Upload one file and attach it; the entry must already exist on the server. */
export async function attachEntryPhoto(
  groupId: string,
  entryId: string,
  file: File,
): Promise<void> {
  const attachmentId = crypto.randomUUID();
  const path = `${entryId}/${attachmentId}/${crypto.randomUUID()}.jpg`;
  const storagePath = await putImage({
    bucket: 'company-entry-images',
    path,
    body: file,
    contentType: file.type || 'image/jpeg',
    groupId,
    subjectId: entryId,
  });
  const { error } = await supabase.rpc('waves_attach_company_entry_image', {
    p_entry_id: entryId,
    p_storage_path: storagePath,
    p_attachment_id: attachmentId,
    p_preview: null,
  });
  if (error) {
    console.error('attach company entry image failed', error);
    throw new Error(error.message);
  }
}

export function CompanyEntryPhotos({
  groupId,
  entryId,
  canAdd,
  canRemove,
}: {
  groupId: string;
  entryId: string;
  canAdd: boolean;
  canRemove: (uploaderMemberId: string | null) => boolean;
}) {
  const photos = useCompanyPhotos(entryId);
  const [urls, setUrls] = useState<ReadonlyMap<string, string | null>>(new Map());
  const [viewing, setViewing] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const wanted = photos.map((p) => p.storagePath).join('|');
  useEffect(() => {
    let active = true;
    for (const path of wanted ? wanted.split('|') : []) {
      void waves.restrictedImageUrl('company-entry-images', entryId, path).then((url) => {
        if (active) setUrls((prev) => new Map(prev).set(path, url));
      });
    }
    return () => {
      active = false;
    };
  }, [entryId, wanted]);

  if (photos.length === 0 && !canAdd) return null;

  const add = async (files: FileList | null): Promise<void> => {
    if (!files?.length) return;
    setBusy(true);
    setError(null);
    try {
      const room = MAX_COMPANY_PHOTOS - photos.length;
      for (const file of Array.from(files).slice(0, room)) {
        if (!file.type.startsWith('image/') || file.size > 15 * 1024 * 1024)
          throw new Error(s.photoFailed);
        await attachEntryPhoto(groupId, entryId, file);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : s.photoFailed);
    } finally {
      setBusy(false);
    }
  };

  const remove = async (id: string): Promise<void> => {
    setError(null);
    try {
      await removeCompanyPhoto(id);
    } catch (e) {
      setError(e instanceof Error ? e.message : s.couldNotSave);
    }
  };

  const viewed = viewing ? urls.get(viewing) : null;
  return (
    <div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
        {photos.map((photo) => {
          const url = urls.get(photo.storagePath);
          return (
            <div key={photo.id}>
              <button
                type="button"
                className="btn soft"
                disabled={!url}
                onClick={() => setViewing(photo.storagePath)}
              >
                {url ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={url}
                    alt={s.photos}
                    width={64}
                    height={64}
                    style={{ objectFit: 'cover' }}
                  />
                ) : (
                  s.photos
                )}
              </button>
              {canRemove(photo.uploaderMemberId) ? (
                <button type="button" className="btn soft" onClick={() => void remove(photo.id)}>
                  {s.removePhoto}
                </button>
              ) : null}
            </div>
          );
        })}
      </div>
      {canAdd && photos.length < MAX_COMPANY_PHOTOS ? (
        <label className="btn soft">
          {busy ? s.saving : s.addPhotos}
          <input
            type="file"
            accept="image/*"
            multiple
            hidden
            disabled={busy}
            onChange={(e) => {
              void add(e.target.files);
              e.target.value = '';
            }}
          />
        </label>
      ) : null}
      {error ? <p role="alert">{error}</p> : null}
      {viewed && viewing ? (
        <ImageViewer url={viewed} alt={s.photos} onClose={() => setViewing(null)} />
      ) : null}
    </div>
  );
}
