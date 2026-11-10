import {expect,it,vi} from 'vitest';
import {gzipSync} from 'node:zlib';
import {readFileSync,readdirSync,existsSync} from 'node:fs';
import {join} from 'node:path';
vi.mock('maxmind',()=>({Reader:class{
 metadata:any;constructor(bytes:Buffer){const data=JSON.parse(bytes.toString());this.metadata={databaseType:data.type,buildEpoch:new Date(data.builtAt)};}
 get(){return {country:{iso_code:'CN'}};}
}}));
import {AnalyticsGeo} from '../packages/core/src/analytics-geo.ts';
import {analyticsHandlers} from '../apps/web/src/api/analytics.ts';
it('skips a current month, keeps identical data, supports 304 and bounds replacement files',async()=>{
 const root=join(process.env.WEAVA_TEST_OUTPUT??'D:/Tools/cache/weava/tests','geo-update-'+Date.now()),geo=new AnalyticsGeo(root);
 const month=new Date().toISOString().slice(0,7),source=(edition:number,type='GeoIP2-Country')=>Buffer.from(JSON.stringify({type,builtAt:month+'-01T00:00:00Z',edition}));
 const fetch=vi.fn().mockResolvedValueOnce(new Response(gzipSync(source(1))));vi.stubGlobal('fetch',fetch);
 try{
  await geo.update();expect(geo.status().available).toBe(true);await geo.update();expect(fetch).toHaveBeenCalledTimes(1);
  fetch.mockResolvedValueOnce(new Response(gzipSync(source(1))));
  const handlers=analyticsHandlers({analytics:{geo}} as any);
  expect((await handlers.updateGeo()).updating).toBe(true);
  await geo.update(true);expect(fetch).toHaveBeenCalledTimes(2);expect(existsSync(geo.file+'.previous')).toBe(false);
  fetch.mockResolvedValueOnce(new Response(null,{status:304}));await geo.update(true);expect(fetch.mock.calls.at(-1)![1].headers['If-Modified-Since']).toBeTruthy();expect(geo.status().updating).toBe(false);
  fetch.mockResolvedValueOnce(new Response(gzipSync(source(2))));await geo.update(true);
  fetch.mockResolvedValueOnce(new Response(gzipSync(source(3))));await geo.update(true);
  expect(readFileSync(geo.file+'.previous')).toEqual(source(2));expect(readFileSync(geo.file)).toEqual(source(3));
  expect(readdirSync(join(root,'analytics')).sort()).toEqual(['geoip-country.mmdb','geoip-country.mmdb.previous']);
  fetch.mockResolvedValueOnce(new Response(gzipSync(source(4,'GeoIP2-City'))));await expect(geo.update(true)).rejects.toThrow('国家地区数据库');expect(readFileSync(geo.file)).toEqual(source(3));
 }finally{geo.close();vi.unstubAllGlobals();}
});
