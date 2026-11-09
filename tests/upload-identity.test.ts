// @vitest-environment happy-dom
import {afterEach,expect,it,vi} from 'vitest';
import {uploadFile} from '../apps/admin/src/upload-file.ts';
import {api,waitJob} from '../apps/admin/src/api.ts';
vi.mock('../apps/admin/src/api.ts',()=>({api:vi.fn(),waitJob:vi.fn()}));
afterEach(()=>{vi.unstubAllGlobals();vi.restoreAllMocks();sessionStorage.clear();});
function transport(status = 200) {
  const requests: any[] = [];
  class UploadRequest {
    upload: any = {}; status = status; responseText = ''; onload!: () => void;
    onerror!: () => void; ontimeout!: () => void; timeout = 0; path = ''; body: any;
    open(_method: string, path: string) { this.path = path; requests.push(this); }
    setRequestHeader() {}
    send(body: File) {
      this.body = body;
      this.upload.onprogress({ loaded: body.size });
      this.responseText = JSON.stringify(status >= 400 ? { error: '上传失败' } : {
        id: String(requests.length), revision: 1, updatedAt: '2026-11-09',
        value: { name: body.name, url: '/media/original.png', bytes: body.size, createdAt: '2026-11-09', derivatives: [], optimization: { status: 'pending' } },
      });
      queueMicrotask(() => this.onload());
    }
  }
  vi.stubGlobal('XMLHttpRequest', UploadRequest);
  return requests;
}
it('sends each selected file once without reading a browser hash or waiting for image optimization',async()=>{
  const requests = transport(), progress = vi.fn();
  for (const content of ['AAAA','BBBB']) {
    const file = new File([content], 'same.png', { lastModified: 1 });
    const read = vi.spyOn(file, 'arrayBuffer').mockRejectedValue(new Error('must not read before sending'));
    const result = await uploadFile(file, progress, { groupId: 'pictures' });
    expect(result.value.optimization?.status).toBe('pending'); expect(result.value.url).toBe('/media/original.png');
    expect(requests.at(-1).body).toBe(file); expect(read).not.toHaveBeenCalled();
    expect(requests.at(-1).path).toBe('/api/admin/v1/media/file?name=same.png&groupId=pictures');
  }
  expect(requests).toHaveLength(2); expect(api).not.toHaveBeenCalled(); expect(waitJob).not.toHaveBeenCalled();
  expect(progress).toHaveBeenCalledWith('正在保存原文件…'); expect(sessionStorage.length).toBe(0);
});
it('surfaces upload failures and rejects unsupported or oversized files before sending',async()=>{
  const requests = transport(400);
  await expect(uploadFile(new File(['data'],'image.png'),()=>{})).rejects.toThrow('上传失败');
  await expect(uploadFile(new File(['data'],'wrong.exe'),()=>{})).rejects.toThrow('不支持');
  await expect(uploadFile(new File([],'empty.png'),()=>{})).rejects.toThrow('32 MB');
  expect(requests).toHaveLength(1);
});
