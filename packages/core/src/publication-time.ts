import type {Storage} from './storage.ts';

type PublicationScope='publication-plan'|'publication-schedule';
export function nextPublicationTime(store:Storage){
  return (store.raw.prepare('SELECT due_at FROM publication_due INDEXED BY publication_due_time ORDER BY due_at LIMIT 1').get() as {due_at:number}|undefined)?.due_at??null;
}

/** Match the date parser used at the save boundary, including older persisted
 * offset and RFC date strings. Do not rewrite plans or their revision identity
 * merely to inspect the queue. */
export function duePublications(store:Storage,scopes:readonly PublicationScope[],clock:number,limit:number){
  return store.raw.prepare(`SELECT scope,id,revision FROM publication_due INDEXED BY publication_due_time
    WHERE scope IN (${scopes.map(()=>'?').join(',')})
      AND due_at<=?
    ORDER BY due_at,scope,id LIMIT ?`
  ).all(...scopes,clock,limit) as {scope:PublicationScope;id:string;revision:number}[];
}
