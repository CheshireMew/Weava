export interface WebsiteContext {
 id:string;
 root:string;
 preview:boolean;
 entry?:Readonly<Record<string,any>>;
 settings:Readonly<Record<string,any>>;
 request:{url:URL;method:string;owner:boolean};
 resources:{path(relative:string):string};
 content:{
  get(id:string):Readonly<Record<string,any>>|null;
  query(query?:{type?:string;kind?:'content'|'page';page?:number;pageSize?:number;query?:string;category?:string;tag?:string;fields?:Record<string,string>}):Readonly<{items:readonly Readonly<Record<string,any>>[];total:number;page:number;pageSize:number;pages:number}>;
  render(document:unknown):string;
 };
 media:{url(id:string):string|null};
 seo:{head(entry?:Record<string,any>,url?:URL):string};
 business:{
  get(collection:string,id:string):any;
  list(collection:string):{id:string;value:any}[];
  put(collection:string,id:string,value:unknown):void;
  transaction<T>(fn:()=>T):T;
 };
 tasks:{enqueue(operation:string,payload:unknown,key?:string):unknown;get(id:string):unknown;log(id:string,offset?:number):unknown};
}
export declare function getWebsite():WebsiteContext;
export declare function defineExtension<T>(factory:T):T;

