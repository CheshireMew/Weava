import type { Block } from '@weava/contracts';
export function findBlock(items: Block[], id: string): Block | undefined {
  for (const item of items) { if (item.id === id) return item; const found = findBlock(item.children ?? [], id); if (found) return found; }
}
export function patchBlock(items: Block[], id: string, patch: Partial<Block>): Block[] {
  return items.map((item) => item.id === id ? { ...item, ...patch } : item.children ? { ...item, children: patchBlock(item.children, id, patch) } : item);
}
export function removeBlock(items: Block[], id: string): Block[] {
  return items.filter((item) => item.id !== id).map((item) => item.children ? { ...item, children: removeBlock(item.children, id) } : item);
}
export function cloneBlocks(items: Block[]): Block[] {
  return items.map((item) => ({ ...structuredClone(item), id: crypto.randomUUID(), ...(item.children ? { children: cloneBlocks(item.children) } : {}) }));
}
export function insertAfter(items:Block[],id:string,block:Block):Block[]{const index=items.findIndex((item)=>item.id===id);if(index>=0)return [...items.slice(0,index+1),block,...items.slice(index+1)];return items.map((item)=>item.children?{...item,children:insertAfter(item.children,id,block)}:item);}
export function moveBlock(items: Block[], id: string, delta: number): Block[] {
  const index = items.findIndex((item) => item.id === id);
  if (index >= 0) { const next = [...items]; if (index + delta >= 0 && index + delta < next.length) [next[index], next[index + delta]] = [next[index + delta], next[index]]; return next; }
  return items.map((item) => item.children ? { ...item, children: moveBlock(item.children, id, delta) } : item);
}
