import type {Instrumentation} from 'next';
/* Server errors go to lib/server-errors.ts: metadata only (route template, router context, release, request
   id). The error message, the request path and query, headers and bodies are never recorded. */
export const onRequestError:Instrumentation.onRequestError=async(_err,request,context)=>{
 if(process.env.NEXT_RUNTIME!=='nodejs')return;
 try{
  const {recordServerError}=await import('./lib/server-errors');
  const h=request.headers?.['x-request-id'];
  await recordServerError({routePath:context.routePath,routeType:context.routeType,method:request.method,requestId:Array.isArray(h)?h[0]:h});
 }catch{/* monitoring never throws */}
};
