import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { existsSync, lstatSync, realpathSync, readdirSync, mkdirSync, copyFileSync, readFileSync, writeFileSync, renameSync, symlinkSync } from 'node:fs';
import { join, resolve, relative, dirname, basename } from 'node:path';
import { WeavaError } from '@weava/contracts';
const hash = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');
interface DependencySnapshot { files: {path:string;hash:string}[]; links: {path:string;target:string}[] }
export function verifyProgramDependencies(root:string,snapshot:DependencySnapshot){
  const files=new Map(snapshot.files.map(file=>[file.path,file.hash])),links=new Map(snapshot.links.map(link=>[link.path,link.target]));
  const base=join(root,'node_modules');
  if(lstatSync(base).isSymbolicLink())throw new WeavaError('程序依赖仍关联可变的外部目录。');
  const fail=(path:string)=>{throw new WeavaError('程序依赖文件或关联校验失败：'+path);};
  function visit(folder:string){
    for(const entry of readdirSync(folder,{withFileTypes:true})){
      const file=join(folder,entry.name),key=relative(root,file).replaceAll('\\','/');
      if(entry.isSymbolicLink()){
        const target=links.get(key);if(!target||!target.startsWith('node_modules/.store/'))fail(key);
        const actual=realpathSync.native(file),expected=resolve(root,target!);
        if((process.platform==='win32'?actual.toLowerCase():actual)!==(process.platform==='win32'?expected.toLowerCase():expected))fail(key);
        links.delete(key);
      }else if(entry.isDirectory())visit(file);
      else if(entry.isFile()){
        const expected=files.get(key);if(!expected||hash(readFileSync(file))!==expected)fail(key);files.delete(key);
      }else fail(key);
    }
  }
  visit(base);if(files.size||links.size)fail(files.keys().next().value??links.keys().next().value??'node_modules');
}
/** Copy installed runtime packages and their resolved dependency graph; never hardlink mutable inputs. */
export function freezeProgramDependencies(output: string, source: string): DependencySnapshot {
  const root=resolve(output),destination=join(root,'node_modules'),marker=join(root,'dependencies.json');
  if(existsSync(marker))return JSON.parse(readFileSync(marker,'utf8'));
  if(existsSync(destination)) {
    if(!lstatSync(destination).isSymbolicLink())throw new WeavaError('依赖目标已存在且不是旧版关联目录，请选择新的构建目录。');
    // Move only this explicitly identified directory link, not its resolved target.
    renameSync(destination,join(root,'node_modules.retained-'+crypto.randomUUID()));
  }
  mkdirSync(destination,{recursive:true});
  const nodes=new Map<string,{target:string;dependencies:Map<string,string>}>(),links:DependencySnapshot['links']=[],files:DependencySnapshot['files']=[];
  const link=(path:string,target:string)=>{mkdirSync(dirname(path),{recursive:true});symlinkSync(target,path,process.platform==='win32'?'junction':'dir');links.push({path:relative(root,path).replaceAll('\\','/'),target:relative(root,target).replaceAll('\\','/')});};
  const find=(from:string,name:string)=>{
    const require=createRequire(join(from,'package.json'));
    for(const base of require.resolve.paths(name)??[])if(existsSync(join(base,name,'package.json')))return realpathSync.native(join(base,name));
    return undefined;
  };
  const visit=(directory:string):string=>{
    const real=realpathSync.native(directory),known=nodes.get(real);if(known)return known.target;
    const pkg=JSON.parse(readFileSync(join(real,'package.json'),'utf8'));
    // Native libraries can resolve sibling packages relative to their binary.
    // Retain a node_modules layout for each resolved graph, as package managers do.
    const modules=join(destination,'.store',hash(real).slice(0,24),'node_modules');
    const target=join(modules,pkg.name??basename(real)),node={target,dependencies:new Map<string,string>()};nodes.set(real,node);
    function copy(folder:string,to:string){
      mkdirSync(to,{recursive:true});
      for(const item of readdirSync(folder,{withFileTypes:true})){
        if(item.name==='node_modules')continue;
        const input=join(folder,item.name),result=join(to,item.name),info=lstatSync(input);
        if(info.isSymbolicLink()){
          const actual=realpathSync.native(input);
          if(lstatSync(actual).isDirectory())copy(actual,result);else{copyFileSync(actual,result);files.push({path:relative(root,result).replaceAll('\\','/'),hash:hash(readFileSync(result))});}
        }else if(info.isDirectory())copy(input,result);
        else if(info.isFile()){copyFileSync(input,result);files.push({path:relative(root,result).replaceAll('\\','/'),hash:hash(readFileSync(result))});}
      }
    }
    copy(real,target);
    for(const name of Object.keys({...pkg.dependencies,...pkg.optionalDependencies,...pkg.peerDependencies})){
      const resolved=find(real,name);
      if(!resolved){if(pkg.dependencies?.[name]&&!pkg.optionalDependencies?.[name])throw new WeavaError('已安装依赖不完整：'+pkg.name+' → '+name);continue;}
      node.dependencies.set(name,visit(resolved));
    }
    for(const [name,resolved]of node.dependencies)if(join(modules,name)!==target)link(join(modules,name),resolved);
    return target;
  };
  const sourceRoot=resolve(source),pkg=JSON.parse(readFileSync(join(sourceRoot,'..','package.json'),'utf8'));
  for(const [name,spec]of Object.entries(pkg.dependencies??{}))if(!String(spec).startsWith('workspace:')){
    const directory=join(sourceRoot,name);if(!existsSync(directory))throw new WeavaError('运行依赖未安装：'+name);
    link(join(destination,name),visit(directory));
  }
  const snapshot={files,links};writeFileSync(marker,JSON.stringify(snapshot));return snapshot;
}
