import {AsyncLocalStorage} from 'node:async_hooks';
import type {WebsiteContext} from './site-sdk.ts';
export type {WebsiteContext} from './site-sdk.ts';
export function getWebsite():WebsiteContext{
 const value=(globalThis as any)[Symbol.for('weava.website.context')]?.getStore();
 if(!value)throw new Error('getWebsite 只能在网站请求或已绑定的网站任务中使用。');
 return value;
}
export function defineExtension<T>(factory:T):T{return factory;}

