import { z } from 'zod';
import { adminApi } from './admin-api.ts';
type JsonSchema={type?:string|string[];properties?:Record<string,JsonSchema>;required?:string[];items?:JsonSchema;anyOf?:JsonSchema[];oneOf?:JsonSchema[];enum?:unknown[]};
const compact=(schema:JsonSchema):string=>{
  if(schema.enum)return schema.enum.map(String).join(' / ');
  if(schema.properties)return '{ '+Object.entries(schema.properties).map(([key,value])=>key+(schema.required?.includes(key)?'':'?')+': '+(value.type??(value.properties?'object':value.items?'array':'JSON'))).join(', ')+' }';
  if(schema.items)return compact(schema.items)+'[]';
  if(schema.anyOf||schema.oneOf)return (schema.anyOf??schema.oneOf)!.map(compact).join(' | ');
  return Array.isArray(schema.type)?schema.type.join(' | '):schema.type??'JSON';
};
const describe=(value:z.ZodType)=>compact(z.toJSONSchema(value,{io:'input',unrepresentable:'any'}) as JsonSchema).replaceAll('|','\\|');
export function apiReferenceMarkdown(){
  const lines=['# 后台 API 参考','','此文件由 `node --import tsx scripts/generate-api-docs.ts` 从 `packages/contracts/src/admin-api.ts` 生成。不要手工修改表格；更改接口定义后重新生成，测试会检查是否同步。','','服务端请求与成功响应校验、后台和 CLI 的客户端、此表及 OpenAPI 共用同一份定义。`schema --format openapi` 返回完整的参数、请求体、成功响应与错误响应 JSON Schema；`schema --format types` 导出站点条目类型及客户端入口。','','除登录状态与登录接口外，接口需要站主 Cookie 或 Bearer 凭据。`202` 表示后台任务已接收，使用 `GET job/{id}` 查询结果。错误响应为 `{error:string,details?:JSON}`；`409` 需要重新读取修订并重新预检。扩展字段、统计维度行与不同任务的结果在相应字段中保留开放 JSON，字段的业务规则由领域服务继续检查。','','| 操作 | 方法与路径 | 参数 | 请求体 | 成功响应 |','| --- | --- | --- | --- | --- |'];
  for(const [key,def] of Object.entries(adminApi)){
    const params=[['路径',def.params],['查询',def.query]] as const;
    const inputs=params.filter(([,schema])=>Object.keys((z.toJSONSchema(schema,{io:'input',unrepresentable:'any'}) as JsonSchema).properties??{}).length).map(([name,schema])=>name+' '+describe(schema)).join('; ')||'—';
    lines.push('| `'+key+'` · '+def.summary+' | `'+def.method+' /api/admin/v1/'+def.path+'` | '+inputs+' | '+(def.method==='POST'?describe(def.body):'—')+' | '+def.status+' · '+describe(def.response)+' |');
  }
  return lines.join('\n')+'\n';
}
