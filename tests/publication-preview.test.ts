import {beforeEach,expect,it,vi} from 'vitest';
import {defaultSettings,entrySchema,type Release} from '@weava/contracts';
import {selectPublicPage} from '../packages/core/src/public-page-selection.ts';
const mocks=vi.hoisted(()=>({read:vi.fn()}));
vi.mock('../packages/core/src/publication.ts',()=>({readPublicationPreview:mocks.read}));
beforeEach(()=>mocks.read.mockReset());
it('previews the reviewed release including its title, settings and templates without reading the latest draft',()=>{
 const entry={...entrySchema.parse({id:'reviewed',kind:'page',title:'已确认的标题',path:'/reviewed/'}),html:'<p>已确认的正文</p>',revisionId:7};
 const candidate={id:'candidate-release',createdAt:'',label:'',entries:[entry],types:[],layouts:[],settings:{...defaultSettings,name:'已确认的站名'}} as unknown as Release;
 mocks.read.mockReturnValue(candidate);
 const site:any={visibleRelease:vi.fn(),settings:vi.fn(),store:{get:vi.fn()}};
 const page=selectPublicPage(site,new URL('http://localhost/__preview/reviewed?candidate=confirmed&revision=7'),true);
 expect(page.preview).toBe(true);expect(page.entry).toBe(entry);expect(page.release).toBe(candidate);
 expect(page.release.settings.name).toBe('已确认的站名');expect(mocks.read).toHaveBeenCalledWith(site,'confirmed');
 expect(site.visibleRelease).not.toHaveBeenCalled();expect(site.settings).not.toHaveBeenCalled();expect(site.store.get).not.toHaveBeenCalled();
 expect(()=>selectPublicPage(site,new URL('http://localhost/__preview/other?candidate=confirmed'),true)).toThrow('本次发布中没有这篇内容');
});
it('requires an owner session before opening a publication candidate',()=>{
 expect(()=>selectPublicPage({} as any,new URL('http://localhost/__preview/reviewed?candidate=confirmed'),false)).toThrow('请先登录后台');
 expect(mocks.read).not.toHaveBeenCalled();
});
it('rejects expired or legacy candidates before attempting to render them',async()=>{
 const {readPublicationPreview}=await vi.importActual<typeof import('../packages/core/src/publication.ts')>('../packages/core/src/publication.ts');
 const lookup=vi.fn(),site:any={store:{raw:{prepare:()=>({get:lookup})}}};
 expect(()=>readPublicationPreview(site,'expired')).toThrow('发布预览已过期');
 lookup.mockReturnValue({data:JSON.stringify({optionsKey:'legacy'})});
 expect(()=>readPublicationPreview(site,'legacy')).toThrow('发布预览已过期');
});
