import {readFileSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {strict as assert} from 'node:assert';
import {authoredFingerprint} from '../packages/manager/src/recovery.ts';
const base='D:/Tools/cache/weava/tasks/shared-runtime-20261105';
const cases=[
 {id:'demo',port:4322,point:'update-fcd08b19-1dc4-4596-b56a-30efd581d0c8'},
 {id:'blog-blacknico',port:4324,point:'update-78fdd703-4822-4c36-bc49-79b80ebbb046'},
 {id:'crypto-blacknico',port:4323,point:'update-510d16bd-cdfd-4dd0-aa27-e7bea0c100b4'},
];
const results=[];
for(const item of cases){
 const root=join('E:/Code/WeavaSites',item.id),point=join('D:/Tools/weava/backups/shared-runtime/legacy',item.point),before=authoredFingerprint(point),after=authoredFingerprint(root,Object.keys(before.account));
 assert.deepEqual(after,before,item.id+' authored data, revisions, account or release changed');
 const config=JSON.parse(readFileSync(join(root,'site.json'),'utf8'));assert.equal(config.port,item.port);
 const deployment=JSON.parse(readFileSync(join(root,'program.json'),'utf8')),db=new DatabaseSync(join(root,'weava.sqlite'),{readOnly:true});
 let path:string|undefined,media:string|undefined,admin='/admin',owner=false;
 try{path=String(db.prepare("SELECT json_extract(data,'$.path') path FROM records WHERE scope='entry' AND json_extract(data,'$.kind')='content' AND json_extract(data,'$.status')='published' AND coalesce(json_extract(data,'$.visibility'),'public')<>'private' LIMIT 1").get()?.path??'');media=String(db.prepare("SELECT json_extract(data,'$.url') url FROM records WHERE scope='media' LIMIT 1").get()?.url??'');admin=String(db.prepare("SELECT value FROM state WHERE key='owner-admin-path'").get()?.value??admin);owner=!!db.prepare("SELECT value FROM state WHERE key='owner'").get();}finally{db.close();}
 const headers={Authorization:'Bearer '+readFileSync(join(root,'cli-token'),'utf8'),'User-Agent':'WeavaCheck'};
 const origin='http://127.0.0.1:'+item.port;
 const checked=[];
 for(const route of ['/',path,admin+'/','/api/admin/v1/session',media].filter((value):value is string=>!!value&&value.startsWith('/'))){const response=await fetch(origin+route,{headers,redirect:'manual',signal:AbortSignal.timeout(20000)});assert(response.status>=200&&response.status<400,item.id+' '+route+': '+response.status);checked.push({path:route,status:response.status});await response.arrayBuffer();}
 const statsBefore=new DatabaseSync(join(point,'analytics.sqlite'),{readOnly:true}),statsAfter=new DatabaseSync(join(root,'analytics.sqlite'),{readOnly:true});
 let tables=0;
 try{for(const row of statsBefore.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '%fts%' AND name NOT LIKE 'weava_%'").all() as {name:string}[]){const name='"'+row.name.replaceAll('"','""')+'"';const old=Number(statsBefore.prepare('SELECT COUNT(*) n FROM '+name).get()?.n),current=Number(statsAfter.prepare('SELECT COUNT(*) n FROM '+name).get()?.n);assert(current>=old,item.id+' analytics rows lost: '+row.name);tables++;}}finally{statsBefore.close();statsAfter.close();}
 results.push({id:item.id,port:item.port,programId:deployment.programId,preserved:{content:true,revisions:true,release:true,account:true,keys:true,comments:true,analyticsTables:tables},ownerConfigured:owner,http:checked});
}
assert.equal(new Set(results.map(row=>row.programId)).size,1);
writeFileSync(join(base,'adoption-results.json'),JSON.stringify(results,null,2));console.log(JSON.stringify(results));
