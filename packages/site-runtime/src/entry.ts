import {createApp} from 'astro/app/entrypoint';
const app=createApp();
export async function render(request:Request,locals:object){
 const routeData=app.match(request,true);
 if(!routeData)return null;
 return app.render(request,{locals,routeData,addCookieHeader:true});
}

