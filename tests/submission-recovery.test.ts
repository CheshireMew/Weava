// @vitest-environment happy-dom
import {afterEach,expect,it,vi} from 'vitest';
import {webcrypto} from 'node:crypto';
import {api,submitJob} from '../apps/admin/src/api.ts';
import {clearSubmissionKeys} from '../apps/admin/src/submission-keys.ts';
const mocks=vi.hoisted(()=>({request:vi.fn(),keys:[] as string[]}));
vi.mock('@weava/contracts/api-client',()=>({createAdminClient:(options:any)=>{
  mocks.keys.push(options.headers['Idempotency-Key']);return {request:mocks.request};
}}));
afterEach(()=>{clearSubmissionKeys();vi.unstubAllGlobals();mocks.keys=[];mocks.request.mockReset();});
it('reuses the submission identity after a lost response, then gives a deliberate new operation a new key',async()=>{
  vi.stubGlobal('crypto',webcrypto);
  mocks.request.mockRejectedValueOnce(Object.assign(new Error('lost'),{status:0})).mockResolvedValue({id:'job',status:'queued'});
  await expect(submitJob('publish',{ids:['a']})).rejects.toThrow('lost');
  expect(sessionStorage.getItem('weava-pending-submissions:v1')).toContain(mocks.keys[0]);
  await submitJob('publish',{ids:['a']}); await submitJob('publish',{ids:['a']});
  expect(mocks.keys[0]).toBe(mocks.keys[1]); expect(mocks.keys[2]).not.toBe(mocks.keys[1]);
  expect(JSON.parse(sessionStorage.getItem('weava-pending-submissions:v1')!)).toEqual([]);
});
it('does not reuse an uncertain operation identity for changed input or after signing out',async()=>{
  vi.stubGlobal('crypto',webcrypto);mocks.request.mockRejectedValue(Object.assign(new Error('offline'),{status:0}));
  for(const ids of [['a'],['b']])await expect(submitJob('publish',{ids})).rejects.toThrow();
  clearSubmissionKeys();await expect(submitJob('publish',{ids:['a']})).rejects.toThrow();
  expect(new Set(mocks.keys).size).toBe(3);
});
it.each(['publish','withdraw','schedule'])('also protects the direct %s action after a lost reply',async path=>{
  vi.stubGlobal('crypto',webcrypto);
  mocks.request.mockRejectedValueOnce(Object.assign(new Error('lost'),{status:0})).mockResolvedValue({id:'same-job',status:'queued'});
  await expect(api.request(path,{})).rejects.toThrow('lost');await api.request(path,{});
  expect(mocks.keys[1]).toBe(mocks.keys[0]);
});
