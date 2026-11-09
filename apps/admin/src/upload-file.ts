import { isUploadFormat, mediaUploadMaxBytes } from '@weava/contracts';
import { adminApi } from '@weava/contracts/api';
import { adminQueries } from './query-cache.ts';
import { affectedQueries } from './query-effects.ts';
/** A File is sent directly; no whole-file browser hash, base64 copy or processing-job wait. */
export async function uploadFile(
  file: File,
  onProgress: (message: string) => void,
  options: { groupId?: string } = {},
) {
  if (file.size < 1 || file.size > mediaUploadMaxBytes)
    throw new Error('附件大小需要在 32 MB 以内。');
  if (!isUploadFormat(file.name)) throw new Error('不支持这个文件格式。');
  onProgress('上传 0%');
  const row = await new Promise<ReturnType<typeof adminApi.uploadMediaFile.response.parse>>(
    (resolve, reject) => {
      const request = new XMLHttpRequest();
      const query = new URLSearchParams({
        name: file.name,
        ...(options.groupId ? { groupId: options.groupId } : {}),
      });
      request.open('POST', `/api/admin/v1/media/file?${query}`);
      request.setRequestHeader('Content-Type', 'application/octet-stream');
      request.timeout = 120000;
      request.upload.onprogress = (event) =>
        onProgress(event.loaded >= file.size
          ? '正在保存原文件…'
          : `上传 ${Math.round((event.loaded / file.size) * 100)}%`);
      request.onerror = () => reject(new Error('上传连接中断，请重试。'));
      request.ontimeout = () => reject(new Error('上传超时，请重试。'));
      request.onload = () => {
        try {
          const value = JSON.parse(request.responseText);
          if (request.status >= 400) {
            if (request.status === 401) window.dispatchEvent(new Event('weava-session-expired'));
            reject(new Error(value.error ?? '上传失败。'));
          } else resolve(adminApi.uploadMediaFile.response.parse(value));
        } catch {
          reject(new Error('上传响应无效，请重试。'));
        }
      };
      request.send(file);
    },
  );
  adminQueries.invalidate(false, affectedQueries(['media', 'operations']));
  return row;
}
