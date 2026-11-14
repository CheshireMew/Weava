import { isUploadFormat,mediaUploadLimit } from '@weava/contracts';
import {api} from './api.ts';
import { adminApi } from '@weava/contracts/api';
import { adminQueries } from './query-cache.ts';
import { affectedQueries } from './query-effects.ts';
/** A File is sent directly; no whole-file browser hash, base64 copy or processing-job wait. */
export async function uploadFile(
  file: File,
  onProgress: (message: string) => void,
  options: { groupId?: string; signal?:AbortSignal } = {},
) {
  options.signal?.throwIfAborted();
  if (file.size < 1) throw new Error('附件为空，请选择有内容的文件。');
  if (!isUploadFormat(file.name)) throw new Error('不支持这个文件格式。');
  const maximum=mediaUploadLimit(file.name,await api('media/limits'));
  options.signal?.throwIfAborted();
  if(file.size>maximum)throw new Error('附件大小需要在 '+maximum/1048576+' MB 以内。');
  onProgress('上传 0%');
  const row = await new Promise<ReturnType<typeof adminApi.uploadMediaFile.response.parse>>(
    (resolve, reject) => {
      const request = new XMLHttpRequest();
      if(options.signal?.aborted){reject(new Error('上传已取消，请重新选择或重试。'));return;}
      const abort=()=>{request.abort();reject(new Error('上传已取消，请重新选择或重试。'));};
      options.signal?.addEventListener('abort',abort,{once:true});
      request.onloadend=()=>options.signal?.removeEventListener('abort',abort);
      request.onabort=()=>reject(new Error('上传已取消，请重新选择或重试。'));
      const query = new URLSearchParams({
        name: file.name,
        ...(options.groupId ? { groupId: options.groupId } : {}),
      });
      request.open('POST', `/api/admin/v1/media/file?${query}`);
      request.setRequestHeader('Content-Type', 'application/octet-stream');
      request.timeout = Math.min(3600000,Math.max(120000,Math.ceil(file.size/131072)*1000));
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
