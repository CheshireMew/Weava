import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

export function passwordFromFile(path:string) {
  // Only the BOM and one text-file line ending are framing; spaces are part of the password.
  return readFileSync(resolve(path),'utf8').replace(/^\ufeff/,'').replace(/\r?\n$/,'');
}
async function hiddenInput(prompt:string):Promise<string> {
  if(!process.stdin.isTTY || !process.stderr.isTTY)throw new Error('非交互环境请使用 --password-file，不要把密码放进命令参数。');
  process.stderr.write(prompt);
  const input=process.stdin,previous=input.isRaw;
  input.setRawMode(true);input.resume();input.setEncoding('utf8');
  return new Promise((resolve,reject)=>{
    let value='';
    const finish=(error?:Error)=>{input.off('data',read);input.setRawMode(previous);input.pause();process.stderr.write('\n');error?reject(error):resolve(value);};
    const read=(chunk:string)=>{
      for(const char of chunk){
        if(char==='\u0003'){finish(new Error('已取消密码输入。'));return;}
        if(char==='\r'||char==='\n'){finish();return;}
        if(char==='\u007f'||char==='\b'){value=[...value].slice(0,-1).join('');continue;}
        if(char>=' '&&char!=='\u007f')value+=char;
      }
    };
    input.on('data',read);
  });
}
export async function readOwnerPassword(file?:string) {
  if(file)return passwordFromFile(file);
  const password=await hiddenInput('新密码（至少 15 个字符，输入不会显示）：');
  const repeat=await hiddenInput('确认新密码：');
  if(password!==repeat)throw new Error('两次输入的密码不一致。');
  return password;
}
