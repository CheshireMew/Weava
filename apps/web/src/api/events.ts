import {EventQueue} from '../../../../packages/core/src/site-events.ts';
import type {ApiServices,AdminHandlers} from './types.ts';
export function eventHandlers({site}:Pick<ApiServices,'site'>){
  const queue=new EventQueue(site);
  return {
    events:async({query})=>queue.read(query.after,query.limit,query.types?.split(',').filter(Boolean)),
    eventConsumers:async()=>queue.consumers(),
    registerEventConsumer:async({body})=>queue.register(body.id,body.after,body.types),
    claimEvents:async({body})=>queue.claim(body.id),
    finishEvents:async({body})=>queue.finish(body.id,body.token,body.error),
    retryEvents:async({body})=>queue.retry(body.id),
  } satisfies Pick<AdminHandlers,'events'|'eventConsumers'|'registerEventConsumer'|'claimEvents'|'finishEvents'|'retryEvents'>;
}
