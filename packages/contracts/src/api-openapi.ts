import { z } from 'zod';
import { adminApi,idempotentOperations,type ApiOperation } from './admin-api.ts';
import { errorSchema } from './api-models.ts';
const schema=(value:z.ZodType,io:'input'|'output'='input')=>z.toJSONSchema(value,{io,unrepresentable:'any'});
export function authoringOpenApi(name:string,domain:string,models:Record<string,unknown>={}) {
  const paths:Record<string,Record<string,unknown>>={};
  for(const [operation,definition] of Object.entries(adminApi)) {
    const parameters=[];
    if(idempotentOperations.includes(operation as ApiOperation))parameters.push({name:'Idempotency-Key',in:'header',required:false,schema:{type:'string'},description:'相同标识及输入复用已有任务，不重复执行。'});
    for(const [location,value] of [['path',definition.params],['query',definition.query]] as const) {
      const json=schema(value,'output') as { properties?:Record<string,unknown>;required?:string[];additionalProperties?:unknown };
      for(const [key,property] of Object.entries(json.properties??{})) parameters.push({ name:key,in:location,required:location==='path'||!!json.required?.includes(key),schema:property });
    }
    const content=definition.format==='csv'?{'text/csv':{schema:{type:'string'}}}:definition.format==='schema'?{'application/json':{schema:schema(definition.response,'output')},'text/plain':{schema:{type:'string'}}}:{'application/json':{schema:schema(definition.response,'output')}};
    const responses:Record<string,unknown>={ [definition.status]:{description:definition.status===202?'任务已接收，读取 job/{id} 获取结果':'操作结果',content} };
    if(operation==='importWxr')responses['200']={description:'WXR 预检报告',content};
    for(const status of ['400','401','403','404','409','429','500','503'])responses[status]={description:({400:'输入无效',401:'请重新登录',403:'操作不允许',404:'对象不存在',409:'修订或预检冲突',429:'请求过于频繁',500:'接口合同或服务异常',503:'服务暂不可用'} as Record<string,string>)[status],content:{'application/json':{schema:{$ref:'#/components/schemas/ApiError'}}}};
    const operationSchema={ operationId:operation,summary:definition.summary,parameters,security:['session','login'].includes(operation)?[]:[{bearerAuth:[]},{sessionCookie:[]}],...(definition.method==='POST'?{requestBody:{required:true,content:{'application/json':{schema:schema(definition.body)}}}}:{}),responses };
    (paths['/api/admin/v1/'+definition.path]??={})[definition.method.toLowerCase()]=operationSchema;
  }
  return { openapi:'3.1.0',info:{title:name+' · Weava Authoring',version:'1'},servers:[{url:domain}],security:[{bearerAuth:[]},{sessionCookie:[]}],components:{securitySchemes:{bearerAuth:{type:'http',scheme:'bearer'},sessionCookie:{type:'apiKey',in:'cookie',name:'weava-session'}},schemas:{ApiError:schema(errorSchema),...models}},paths };
}
