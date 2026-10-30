import type { Block, ContentType } from './index.ts';
export function contentBlockIssues(blocks:Block[],definition:Pick<ContentType,'allowedBlocks'>,prefix='blocks') {
  const allowed=definition.allowedBlocks;
  if(!allowed)return [];
  const issues:{path:string;message:string;code:string}[]=[];
  const visit=(items:Block[],path:string)=>items.forEach((block,index)=>{
    if(!allowed.includes(block.type))issues.push({path:`${path}.${index}.type`,message:'当前内容类型不允许使用区块：'+block.type,code:'blockType'});
    if(block.children)visit(block.children,`${path}.${index}.children`);
  });visit(blocks,prefix);return issues;
}
