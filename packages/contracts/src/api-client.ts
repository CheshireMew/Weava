import { z } from 'zod';
import { adminApi, matchAdminApi, validateApiInput, type AdminApi, type ApiOperation, type ApiInput, type ApiOutput } from './admin-api.ts';
import { errorSchema } from './api-models.ts';
export class ApiClientError extends Error {
  constructor(message:string, public status:number, public details?:unknown) { super(message); }
}
export interface ApiClientOptions { baseUrl?:string;fetch?:typeof fetch;headers?:HeadersInit|(()=>HeadersInit);timeoutMs?:number;onUnauthorized?:(path:string)=>void }
type ParamPath<P extends string> = P extends `${infer A}{${string}}${infer B}` ? `${A}${string}${ParamPath<B>}` : P;
type Method='GET'|'POST';
export type ApiPath<M extends Method> = { [K in ApiOperation]:AdminApi[K]['method'] extends M ? ParamPath<AdminApi[K]['path']>|`${ParamPath<AdminApi[K]['path']>}?${string}` : never }[ApiOperation];
type WithoutQuery<P extends string> = P extends `${infer A}?${string}` ? A : P;
type OperationAt<P extends string,M extends Method> = P extends unknown ? { [K in ApiOperation]:AdminApi[K]['method'] extends M ? WithoutQuery<P> extends ParamPath<AdminApi[K]['path']> ? K : never : never }[ApiOperation] : never;
export type PathOutput<P extends string,M extends Method> = ApiOutput<OperationAt<P,M>>;
export type PathBody<P extends string> = z.input<AdminApi[OperationAt<P,'POST'>]['body']>;
type InputPart<T,K extends string> = {} extends T ? { [P in K]?:T } : { [P in K]:T };
export type ClientInput<K extends ApiOperation> = InputPart<ApiInput<K>['params'],'params'> & InputPart<ApiInput<K>['query'],'query'> & (AdminApi[K]['method'] extends 'POST' ? { body:ApiInput<K>['body'] } : {});
export interface AdminClient {
  <const P extends ApiPath<'GET'>>(path:P):Promise<PathOutput<P,'GET'>>;
  <const P extends ApiPath<'POST'>>(path:P,body:PathBody<P>):Promise<PathOutput<P,'POST'>>;
  call<K extends ApiOperation>(operation:K,input:ClientInput<K>):Promise<ApiOutput<K>>;
  request(path:string,body?:unknown):Promise<unknown>;
}
export function createAdminClient(options:ApiClientOptions={}):AdminClient {
  const transport=options.fetch ?? ((...args:Parameters<typeof fetch>)=>globalThis.fetch(...args));
  const request=async(path:string,body?:unknown):Promise<unknown>=>{
    const method=body===undefined?'GET':'POST',match=matchAdminApi(method,path);
    if(!match) throw new ApiClientError('接口未在共用定义中声明：'+method+' '+path,0);
    const query=new URLSearchParams(path.includes('?')?path.slice(path.indexOf('?')+1):'');
    try { validateApiInput(match,query,body); } catch(error) { throw new ApiClientError('请求参数无效。',400,error instanceof z.ZodError?error.issues:undefined); }
    const headers=new Headers(typeof options.headers==='function'?options.headers():options.headers);headers.set('Content-Type','application/json');
    let response:Response;
    try { response=await transport((options.baseUrl??'/api/admin/v1/').replace(/\/?$/,'/')+path,{method,headers,body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(options.timeoutMs??30000)}); }
    catch(error) { throw new ApiClientError(error instanceof Error&&error.name==='TimeoutError'?'网站响应超时，请稍后重试。':'无法连接网站，请检查服务和网络后重试。',0); }
    let result:unknown;
    try { result=response.headers.get('content-type')?.includes('application/json')?await response.json():await response.text(); }
    catch { throw new ApiClientError('网站没有返回有效结果，请稍后重试。',response.status); }
    if(!response.ok) { if(response.status===401&&!['login','session'].includes(path))options.onUnauthorized?.(path); const parsed=errorSchema.safeParse(result);throw new ApiClientError(parsed.success?parsed.data.error:'操作没有完成，请重试。',response.status,parsed.success?parsed.data.details:undefined); }
    const parsed=match.definition.response.safeParse(result);
    if(!parsed.success)throw new ApiClientError('网站返回的数据与接口定义不一致。',502,parsed.error.issues);
    return parsed.data;
  };
  const client=request as AdminClient;
  client.request=request;
  client.call=async(operation,input)=>{
    const definition=adminApi[operation];
    const params=definition.params.parse(input.params??{}) as Record<string,string>;
    const query=new URLSearchParams();for(const [key,value] of Object.entries(input.query??{}))if(value!==undefined)query.set(key,String(value));
    const path=definition.path.replace(/\{([^}]+)\}/g,(_,key:string)=>encodeURIComponent(params[key]));
    return await request(path+(query.size?'?'+query:''),'body' in input?input.body:undefined) as ApiOutput<typeof operation>;
  };
  return client;
}
