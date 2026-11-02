import { resolve,join } from 'node:path';
import { mkdirSync,readFileSync,writeFileSync } from 'node:fs';
import { checkFiveSites } from './check-five-sites.ts';
const framework=resolve(import.meta.dirname,'..');
const selected=JSON.parse(readFileSync(join(framework,'dist/current.json'),'utf8'));
const output=process.env.WEAVA_CHECK_OUTPUT??'D:/Tools/cache/weava/personal-content-'+Date.now();
mkdirSync(output,{recursive:true});process.env.TEMP=output;process.env.TMP=output;
const result:{output:string;program:string;passed:boolean;sites?:unknown;error?:string}={output,program:selected.root,passed:false};
try{result.sites=await checkFiveSites(output,framework,{kinds:['blog','portfolio','documentation'],programRoot:selected.root});result.passed=true;}
catch(error){result.error=String(error);throw error;}
finally{writeFileSync(join(output,'results.json'),JSON.stringify(result,null,2));console.log(JSON.stringify({output,passed:result.passed,error:result.error}));}
