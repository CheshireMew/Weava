import type {Storage} from './storage.ts';

type PublicationScope='publication-plan'|'publication-schedule';

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
