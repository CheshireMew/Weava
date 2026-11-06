import {isNoteType,type Release,type PublishedEntry} from '@weava/contracts';
import {newestFirst} from './release-index.ts';
import {withoutImportedPromotion} from './imported-document.ts';
import {renderDocument} from './documents.ts';
import type {Document} from '@weava/contracts';
/** WordPress appended this site-wide promotion to every post, including moments. */
export function cleanNoteHtml(html:string){
 return withoutImportedPromotion(html);
}
export function renderNoteDocument(document:Document){
 return renderDocument(document.format==='html'?{...document,source:cleanNoteHtml(String(document.source))}:document);
}
/** One public timeline: article references and complete short notes, never drafts. */
export function notesTimeline(release:Release){return release.entries.filter(entry=>entry.kind==='content'&&entry.visibility!=='private').sort(newestFirst);}
export function isNote(entry:Pick<PublishedEntry,'type'>,release:Pick<Release,'types'>){return isNoteType(release.types.find(type=>type.id===entry.type));}
export function notesPath(release:Release){return release.settings.extensions.notes?.path??release.entries.find(entry=>entry.kind==='page'&&entry.template==='notes-feed')?.path;}
