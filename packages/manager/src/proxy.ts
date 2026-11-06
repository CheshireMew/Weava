import {existsSync,mkdirSync,readFileSync,renameSync,writeFileSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {atomic,json,noDirectoryLink} from './state.ts';

export function proxyDirectory(home:string,id:string){if(!/^[a-z0-9][a-z0-9-]{0,62}$/.test(id))throw new Error('网站编号无效。');return join(resolve(home),'proxy',id);}
const quote=(value:string)=>'"'+value.replaceAll('\\','/').replaceAll('"','\\"').replaceAll('$','\\$')+'"';
export function nginxMaintenance(home:string,id:string,port:number){
 const folder=proxyDirectory(home,id),active=quote(join(folder,'active.json'));
 return `# Include inside this site's existing server block. Keep TLS and access limits.\nproxy_intercept_errors on;\nset $weava_maintenance 0;\nif (-f ${active}) { set $weava_maintenance 1; }\nif ($uri = /robots.txt) { set $weava_maintenance 0; }\nif ($weava_maintenance = 1) { return 503; }\nerror_page 502 503 504 =503 @weava_maintenance;\nlocation @weava_maintenance {\n    default_type text/html;\n    charset utf-8;\n    add_header Retry-After 60 always;\n    add_header Cache-Control "no-store" always;\n    return 503 '<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>网站维护中</title><main><h1>网站正在更新</h1><p>请稍后重试，原有内容会继续保留。</p></main></html>';\n}\nlocation = /robots.txt {\n    error_page 418 = @weava_saved_robots;\n    error_page 502 503 504 = @weava_saved_robots;\n    if (-f ${active}) { return 418; }\n    proxy_intercept_errors on;\n    proxy_pass http://127.0.0.1:${port};\n    proxy_set_header Host $host;\n    proxy_set_header X-Forwarded-For $remote_addr;\n    proxy_set_header X-Forwarded-Proto $scheme;\n}\nlocation @weava_saved_robots {\n    root ${quote(folder)};\n    default_type text/plain;\n    add_header Cache-Control "no-store" always;\n    try_files /robots.txt =404;\n}\n`;
}
export function prepareProxy(home:string,id:string,port:number){
 const folder=proxyDirectory(home,id);noDirectoryLink(resolve(home));mkdirSync(folder,{recursive:true});noDirectoryLink(folder);
 const include=join(folder,'maintenance.conf');writeFileSync(include,nginxMaintenance(home,id,port));
 return {directory:folder,include,nginx:'include '+quote(include)+';\nlocation / { proxy_intercept_errors on; proxy_pass http://127.0.0.1:'+port+'; proxy_set_header Host $host; proxy_set_header X-Forwarded-For $remote_addr; proxy_set_header X-Forwarded-Proto $scheme; }'};
}
export function saveRobots(home:string,id:string,status:number,text:string){
 const folder=proxyDirectory(home,id);mkdirSync(folder,{recursive:true});
 if(status===200)writeFileSync(join(folder,'robots.txt'),text);
 else if(existsSync(join(folder,'robots.txt')))renameSync(join(folder,'robots.txt'),join(folder,'robots.previous.txt'));
}
export function maintenance(home:string,id:string,enabled:boolean,operation:string){
 const folder=proxyDirectory(home,id);mkdirSync(folder,{recursive:true});const file=join(folder,'active.json');
 if(enabled){if(existsSync(file)&&json(file).operation!==operation)throw new Error('网站已有未完成的维护操作，请先恢复。');atomic(file,{version:1,id,operation,since:new Date().toISOString()});}
 else if(existsSync(file)){if(json(file).operation!==operation)throw new Error('维护标记不属于本次操作。');renameSync(file,join(folder,'inactive.json'));}
}
