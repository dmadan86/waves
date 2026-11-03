'use client';

/** Task photos (private bucket + the task-image RPCs), as the phone's attachCompanyPhoto with kind 'task'. */
import { putImage } from '@/lib/upload';
import { supabase } from '@/lib/waves';

export async function attachTaskPhoto(groupId: string, taskId: string, file: File): Promise<void> {
  const attachmentId = crypto.randomUUID();
  const ext = file.type === 'image/png' ? 'png' : file.type === 'image/webp' ? 'webp' : 'jpg';
  const path = `${taskId}/${attachmentId}/${crypto.randomUUID()}.${ext}`;
  await putImage({
    bucket: 'company-entry-images',
    path,
    body: file,
    contentType: file.type || 'image/jpeg',
    groupId,
    subjectId: taskId,
  });
  const { error } = await supabase.rpc('waves_attach_company_task_image', {
    p_task_id: taskId,
    p_storage_path: path,
    p_attachment_id: attachmentId,
    p_preview: null,
  });
  if (error) throw new Error(error.message);
}

export async function removeTaskPhoto(photoId: string): Promise<void> {
  const { error } = await supabase.rpc('waves_remove_company_task_image', {
    p_attachment_id: photoId,
  });
  if (error) throw new Error(error.message);
}
