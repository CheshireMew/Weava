import { useEffect, useState } from 'react';
import { api } from './api.ts';
import { Dialog } from './Dialog.tsx';
import {PreviewFrame} from './PreviewFrame.tsx';
import {LoadingState} from './LoadingState.tsx';
import { blockDefinitions } from '@weava/contracts';

const names: Record<string, string> = { title: '标题', description: '摘要', path: '网址', document: '正文', source: '内容', fields: '自定义字段', blocks: '页面区块', cover: '封面', categories: '分类', tags: '标签', status: '状态', visibility: '可见性', template: '模板', termIds: '分类关联', indexable: '搜索收录', publishedAt: '发布日期' };
const label = (path: string) => path.split('/').slice(1).map((key) => names[key] ?? key.replaceAll('~1', '/').replaceAll('~0', '~')).join(' / ');
const display = (value: any) => value === undefined ? '（未设置）' : typeof value === 'string' ? value : JSON.stringify(value, null, 2);
function Value({ value, html, title }: { value: any; html?: string; title: string }) {
  const [code, setCode] = useState(false);
  const toggle = <button type="button" aria-label={title + '代码'} aria-pressed={code} onClick={() => setCode(value => !value)}>代码</button>;
  if (html !== undefined) return <div>{toggle}{code ? <pre aria-label={title}>{display(value)}</pre> : <div className="revision-prose" aria-label={title} onClick={(event) => { if ((event.target as Element).closest('a')) event.preventDefault(); }} dangerouslySetInnerHTML={{ __html: html }} />}</div>;
  if (Array.isArray(value) && value.some((item) => item && typeof item.type === 'string' && item.props)) {
    const blocks = (items: any[]) => items.map((item) => <li key={item.id}><strong>{blockDefinitions[item.type]?.label ?? item.type}</strong><p>{Object.entries(item.props ?? {}).map(([key, content]) => typeof content === 'string' ? content : '').filter(Boolean).join(' · ')}</p>{item.children?.length > 0 && <ul>{blocks(item.children)}</ul>}</li>);
    return <div className="revision-blocks">{toggle}{code ? <pre aria-label={title}>{display(value)}</pre> : <ul>{blocks(value)}</ul>}</div>;
  }
  return <pre aria-label={title}>{display(value)}</pre>;
}

function Changes({ changes }: { changes: any[] }) {
  return <div className="revision-changes">{!changes.length && <p>这两个版本的内容相同。</p>}{changes.map((change) => <section key={change.path}><h3>{label(change.path)}</h3><div className="revision-pair"><Value title={'修改前 ' + label(change.path)} value={change.before} html={change.beforeHtml} /><Value title={'修改后 ' + label(change.path)} value={change.after} html={change.afterHtml} /></div></section>)}</div>;
}
export function RevisionDialog({ id, history, onClose, onRestore, onError }: { id: string; history: any[]; onClose: () => void; onRestore: (version: number) => Promise<any>; onError: (message: string) => void }) {
  const [before, setBefore] = useState(history[1]?.revision ?? history[0]?.revision), [after, setAfter] = useState(history[0]?.revision);
  const [failure, setFailure] = useState(''), [reload, setReload] = useState(0);
  const [comparison, setComparison] = useState<any>(null), [preview, setPreview] = useState(false), [busy, setBusy] = useState(false);
  useEffect(() => {
    let active = true; setComparison(null); setFailure('');
    api(`revision/compare?${new URLSearchParams({ id, from: String(before), to: String(after) })}`).then((data) => { if (active) setComparison(data); }).catch((error) => { if (active) setFailure(error.message); });
    return () => { active = false; };
  }, [id, before, after, reload]);
  const picker = (title: string, value: number, change: (version: number) => void) => <label>{title}<select aria-label={title} value={value} onChange={(event) => change(Number(event.target.value))}>{history.map((row) => <option key={row.revision} value={row.revision}>#{row.revision} · {new Date(row.createdAt).toLocaleString()} · {row.label}</option>)}</select></label>;
  return <Dialog className="modal revision-dialog" label="历史版本" onClose={onClose} dismissible={!busy}><div className="modal-title"><h2>历史版本</h2><button disabled={busy} onClick={onClose}>关闭</button></div>
    <div className="revision-pair">{picker('比较版本', before, setBefore)}{picker('目标版本', after, setAfter)}</div>
    <div className="revision-actions"><button onClick={() => setPreview(!preview)}>{preview ? '查看内容差异' : '查看页面对照'}</button><button className="primary" disabled={busy || !comparison} onClick={async () => { setBusy(true); try { await onRestore(after); } catch (error: any) { setFailure(error.message); } finally { setBusy(false); } }}>将目标版本恢复为工作稿</button></div>
    {failure && <p className="error" role="alert">{failure} <button onClick={() => setReload((value) => value + 1)}>重新读取</button></p>}
    {!comparison ? !failure && <LoadingState label="读取版本" /> : preview ? <div className="revision-pair revision-previews">{[before, after].map((version, index) => <PreviewFrame key={index} title={index ? '目标版本预览' : '比较版本预览'} src={'/__preview/' + encodeURIComponent(id) + '?revision=' + version} />)}</div> : <Changes changes={comparison.changes} />}
  </Dialog>;
}
export function MergeDialog({ plan, onSave, onRemote, onClose, onError }: { plan: any; onSave: (choices: Record<string, 'local' | 'remote'>) => Promise<any>; onRemote: () => void; onClose: () => void; onError: (message: string) => void }) {
  const [failure, setFailure] = useState('');
  const [choices, setChoices] = useState<Record<string, 'local' | 'remote'>>({}), [busy, setBusy] = useState(false);
  const [original, setOriginal] = useState<any>(null);
  useEffect(() => { setChoices({}); setOriginal(null); }, [plan.remote.revision]);
  return <Dialog className="modal revision-dialog" label="解决保存冲突" onClose={onClose} dismissible={!busy}><div className="modal-title"><h2>解决保存冲突</h2><button disabled={busy} onClick={onClose}>返回本地编辑</button></div>
    {failure && <p className="error" role="alert">{failure}</p>}
    <p>另一个窗口已经保存了修改。不同位置的改动会合并；同一位置的改动请逐项选择。本地内容会保留到处理完成。</p>
    {plan.conflicts.map((conflict: any) => <section className="merge-conflict" key={conflict.path}><h3>{label(conflict.path)}</h3><button type="button" onClick={() => setOriginal(conflict)}>查看原版本</button><div className="revision-pair">{(['local', 'remote'] as const).map((side) => <div key={side}><label className="merge-choice"><input type="radio" name={conflict.path} aria-label={label(conflict.path) + (side === 'local' ? '保留本地' : '保留服务器')} checked={choices[conflict.path] === side} onChange={() => setChoices({ ...choices, [conflict.path]: side })} />{side === 'local' ? '本地修改' : '服务器修改'}</label><Value title={label(conflict.path) + side} value={conflict[side]} html={conflict[side + 'Html']} /></div>)}</div></section>)}
    {plan.changes.length > 0 && <section><h3>可合并的修改</h3><Changes changes={plan.changes} /></section>}
    {original && <Dialog label="原版本" onClose={() => setOriginal(null)}><div className="modal-title"><h2>{label(original.path)} · 原版本 #{plan.base.revision}</h2><button onClick={() => setOriginal(null)}>关闭</button></div><Value key={original.path} title={label(original.path) + '原版本'} value={original.base} html={original.baseHtml} /></Dialog>}
    {!plan.conflicts.length && <p>没有需要选择的冲突，可以直接保存合并结果。</p>}
    <div className="revision-actions"><button disabled={busy} onClick={onRemote}>采用服务器版本</button><button className="primary" disabled={busy || plan.conflicts.some((row: any) => !choices[row.path])} onClick={async () => { setBusy(true); setFailure(''); try { await onSave(choices); } catch (error: any) { setFailure(error.message); } finally { setBusy(false); } }}>保存合并结果</button></div>
  </Dialog>;
}
