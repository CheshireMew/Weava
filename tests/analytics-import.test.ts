import { describe, it, expect } from 'vitest';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { Analytics, Site } from '@weava/core';
import { entrySchema } from '@weava/contracts';

const root = 'D:/Tools/cache/weava/tests/analytics-import-' + Date.now();
describe('historical article views', () => {
  it('adds native views to one historical baseline without inventing daily events or private rankings', () => {
    const site = new Site(join(root, 'combined'));
    const analytics = new Analytics(site.root);
    try {
      site.saveType({ id:'post',label:'文章',fields:[],pathPrefix:'/posts/',template:'article' },null);
      for (const [id,path,visibility] of [['a','/中文/','public'],['b','/second/','public'],['secret','/secret/','private']] as const)
        site.saveEntry(entrySchema.parse({ id,kind:'content',title:id,path,visibility,status:'published' }),null);
      site.publish();
      const snapshot = { sourceId:'wordpress:views',capturedAt:'2026-10-28T00:00:00Z',entries:[
        { entryId:'a',path:'/中文/',views:100 }, { entryId:'b',path:'/second/',views:50 }, { entryId:'secret',path:'/secret/',views:999 },
      ] };
      expect(analytics.importViewTotals(snapshot).changed).toBe(3);
      expect(analytics.importViewTotals(snapshot).changed).toBe(0);
      const event = { id:'real-page-view-123',kind:'view',ts:new Date().toISOString(),path:encodeURI('/中文/'),visitor:'visitor',session:'session' };
      const allowed = new Set(['/中文/','/second/']);
      expect(analytics.collect(event,'Chrome',allowed).accepted).toBe(1);
      expect(analytics.collect(event,'Chrome',allowed).accepted).toBe(0);
      const counts = analytics.viewTotals(site.visibleRelease()!.entries);
      expect(counts.get('a')).toBe(101);
      expect(counts.get('b')).toBe(50);
      expect(counts.has('secret')).toBe(false);
      const report = analytics.report(new URLSearchParams());
      expect(report.views).toBe(1);
      expect(report.visitors).toBe(1);
      expect(report.daily).toHaveLength(1);
      expect(report.historicalViews).toBe(1149);
      expect(report.lifetimeViews).toBe(1150);
      expect(report.lifetimePages.find((p)=>p.path==='/中文/')!.views).toBe(101);
    } finally { analytics.close();site.close(); }
  });
  it('rejects overlapping sources, stale snapshots and invalid totals atomically', () => {
    const path = join(root,'conflicts');mkdirSync(path,{recursive:true});
    const analytics = new Analytics(path);
    try {
      analytics.importViewTotals({ sourceId:'primary',capturedAt:'2026-10-28T01:00:00Z',entries:[{entryId:'one',path:'/one/',views:10}] });
      expect(()=>analytics.importViewTotals({ sourceId:'another',capturedAt:'2026-10-28T02:00:00Z',entries:[{entryId:'new',path:'/new/',views:100},{entryId:'one',path:'/one/',views:10}] })).toThrow(/重复叠加/);
      expect(analytics.raw.prepare('SELECT COUNT(*) count FROM historical_views').get()).toEqual({count:1});
      expect(()=>analytics.importViewTotals({ sourceId:'primary',capturedAt:'2026-10-27T02:00:00Z',entries:[{entryId:'one',path:'/one/',views:3}] })).toThrow(/数据旧/);
      expect(()=>analytics.importViewTotals({ sourceId:'primary',capturedAt:'2026-10-28T02:00:00Z',entries:[{entryId:'one',path:'/one/',views:-1}] })).toThrow(/计数无效/);
      analytics.importViewTotals({ sourceId:'primary',capturedAt:'2026-10-28T02:00:00Z',entries:[{entryId:'one',path:'/one/',views:12}] });
      expect(analytics.viewTotals([{id:'one',path:'/one/'}]).get('one')).toBe(12);
    } finally { analytics.close(); }
  });
});
