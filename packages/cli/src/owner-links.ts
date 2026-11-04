import Database from 'better-sqlite3';
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { OwnerAccessLinks, ownerAccessUrl } from '../../core/src/owner-access-links.ts';
import { acquireInstanceWriter, processAlive } from '../../core/src/instance-access.ts';

export function localOwnerStatus(root: string) {
  const file = join(root, 'weava.sqlite');
  if(!existsSync(file))throw new Error('请先使用 init 初始化站点。');
  const db = new Database(file, {readonly: true, fileMustExist: true});
  try {return new OwnerAccessLinks(db).status();} finally {db.close();}
}
export function localOwnerLink(root: string, mode: 'initialize' | 'reset', origin?: string, resetTwoFactor = false) {
  const config = JSON.parse(readFileSync(join(root, 'site.json'), 'utf8'));
  const status = localOwnerStatus(root), base = origin ?? 'http://127.0.0.1:' + (config.port ?? 4322);
  // Validate the destination before revoking an earlier link.
  ownerAccessUrl(base, status.adminPath, '');
  const lease = acquireInstanceWriter(root);
  try {
    const db = new Database(join(root, 'weava.sqlite'), {fileMustExist: true});db.pragma('busy_timeout=5000');
    try {
      const grant = new OwnerAccessLinks(db).issue(mode, resetTwoFactor);
      return {mode: grant.mode, expiresAt: grant.expiresAt, url: ownerAccessUrl(base, status.adminPath, grant.token),
        message: mode === 'initialize' ? '打开链接设置站主账户，10 分钟内有效，只能使用一次。' : '打开链接重新设置账户，10 分钟内有效；提交成功前原账户保持不变。'};
    } finally {db.close();}
  } finally {lease.release();}
}
export function ownerLinkCommand(root: string, action: 'setup-link' | 'reset-link') {
  const quote=(value:string)=>process.platform==='win32'?"'"+value.replaceAll("'","''")+"'":"'"+value.replaceAll("'","'\\''")+"'";
  const entry=resolve(process.argv[1]);
  return [...(process.platform==='win32'?['&']:[]),quote(process.execPath),...(entry.endsWith('.ts')?['--import','tsx']:[]),quote(entry),'--site',quote(root),'owner',action].join(' ');
}
export async function checkedLocalOwnerLink(root:string,mode:'initialize'|'reset',origin?:string,resetTwoFactor=false) {
  const runtimeFile=join(root,'runtime.json');
  if(existsSync(runtimeFile)) {
    const runtime=JSON.parse(readFileSync(runtimeFile,'utf8')) as {pid:number;status:string;port:number};
    if(runtime.status!=='stopped'&&processAlive(runtime.pid)) {
      let supported=false;
      try{const response=await fetch('http://127.0.0.1:'+runtime.port+'/api/admin/v1/session',{signal:AbortSignal.timeout(3000)});supported=response.ok&&(await response.json() as {accountLinks?:boolean}).accountLinks===true;}catch{}
      if(!supported)throw new Error('当前运行程序尚不支持一次性设置链接，或仍在启动。请更新并重新启动程序后再试；原账户未修改。');
    }
  }
  return localOwnerLink(root,mode,origin,resetTwoFactor);
}

/** Report only after the selected runtime confirms support, never migrate data here. */
export async function announceOwnerAccess(root: string, port: string, origin: string | undefined, alive: () => boolean, write: (text: string) => void) {
  const until = Date.now() + 30000;
  while(alive() && Date.now() < until) {
    try {
      const response = await fetch('http://127.0.0.1:' + port + '/api/admin/v1/session', {signal: AbortSignal.timeout(1500)});
      if(response.ok) {
        const session = await response.json() as {accountLinks?: boolean};
        const status = localOwnerStatus(root), base = origin ?? 'http://127.0.0.1:' + port;
        const address = new URL(status.adminPath.replace(/\/$/,'')+'/',base).href;
        write('\n后台地址：' + address);
        if(!session.accountLinks){if(status.initialized)write('账户名：'+status.username);write('当前程序不支持一次性设置链接，请先更新程序。\n');return;}
        if(status.initialized)write('账户名：' + status.username + '\n忘记密码时，在这台电脑的终端执行以下命令，生成一次性重设链接：\n'+ownerLinkCommand(root,'reset-link')+'\n');
        else {
          const grant = localOwnerLink(root, 'initialize', base);
          write('首次使用，请打开下面的链接设置账户名和密码（10 分钟内有效）：\n' + grant.url + '\n链接丢失或过期时，在这台电脑的终端执行以下命令：\n'+ownerLinkCommand(root,'setup-link')+'\n');
        }
        return;
      }
    } catch {}
    await new Promise(done => setTimeout(done, 250));
  }
}
