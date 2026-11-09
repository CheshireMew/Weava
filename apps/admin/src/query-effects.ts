export type QueryDomain='content'|'content-count'|'settings'|'models'|'terms'|'layouts'|'media'|'publication'|'operations'|'account'|'analytics'|'extensions'|'comments';
function domains(path:string):QueryDomain[]{
  const [route,query='']=path.split('?');
  if(route==='state')return ['settings','models','terms','layouts','extensions','content-count',...(['appearance','comments'].includes(new URLSearchParams(query).get('panel')??'')?['publication' as const]:[]),...(new URLSearchParams(query).get('panel')==='operations'||new URLSearchParams(query).has('entryId')?['operations' as const]:[])];
  if(/^(entry|entries|references)(\/|$)/.test(route))return ['content','publication'];
  if(route==='settings')return ['settings'];
  if(route==='types'||route.startsWith('authoring/'))return ['models'];
  if(route==='terms')return ['terms'];
  if(route==='layouts')return ['layouts'];
  if(route.startsWith('media')||route.startsWith('image-'))return ['media'];
  if(route.startsWith('analytics'))return ['analytics'];
  if(route.startsWith('account'))return ['account'];
  if(route.startsWith('comment'))return ['comments'];
  if(route.startsWith('extension'))return ['extensions'];
  return ['operations'];
}
export function mutationDomains(path:string,body?:any):QueryDomain[]{
  const route=path.split('?')[0];
  if(route==='import/file'||route.startsWith('import')&&body?.options?.dryRun===true)return [];
  if(['publication','entry/check','entry/merge','entry/structure'].includes(route)||route.endsWith('/preview'))return [];
  if(route==='entry'||route==='entry/merge/save'||route==='restore')return ['content','terms','settings',...(route==='entry'&&body?.revision==null?['content-count' as const]:[])];
  if(route.startsWith('entries/'))return ['content','terms','settings',...(route==='entries/create'||route==='entries/duplicate'||route==='entries/delete'?['content-count' as const]:[]),...(route==='entries/delete'?['publication','operations'] as const:[])];
  if(route==='settings')return ['settings'];
  if(route==='types'||route.startsWith('authoring/'))return ['models','content'];
  if(route==='terms')return ['terms','content','settings'];
  if(route==='layouts')return ['layouts'];
  if(route.startsWith('media')||route.startsWith('image-'))return ['media','operations'];
  if(route==='publish'||route==='rollback'||route==='withdraw')return ['publication','content','operations'];
  if(route.startsWith('import'))return ['models','settings','terms','layouts','content','content-count','media','operations'];
  if(route.startsWith('extension'))return ['extensions','models','layouts','settings','content','operations'];
  if(route.startsWith('analytics'))return ['analytics'];
  if(route.startsWith('account'))return ['account'];
  if(route.startsWith('comment'))return ['comments'];
  return ['operations'];
}
export const affectedQueries=(affected:readonly QueryDomain[])=>(path:string)=>domains(path).some(domain=>affected.includes(domain));
export function jobDomains(operation:string):QueryDomain[]{
  if(operation==='preflight-wxr')return [];
  if(operation==='publish')return mutationDomains('publish');
  if(operation==='entry-delete')return mutationDomains('entries/delete');
  if(operation==='withdraw')return mutationDomains('withdraw');
  if(operation.startsWith('media'))return mutationDomains('media');
  if(operation.includes('wxr')||operation==='import-json'||operation==='import-source')return mutationDomains('import');
  if(operation==='restore-history'||operation==='archive-history')return ['operations','content','publication'];
  return ['operations'];
}
