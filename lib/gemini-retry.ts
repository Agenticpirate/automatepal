// Bounded retry for transient Gemini transport failures only.
// Never retries quota (429) or client (4xx) errors; at most one extra attempt for network/5xx.
export class ProviderError extends Error{status?:number}
export function isTransient(e:unknown):boolean{
  const s=(e as {status?:number})?.status??(e as {statusCode?:number})?.statusCode;
  if(typeof s==='number')return s>=500&&s<600;
  const msg=String((e as Error)?.message??e);
  return /fetch failed|network|ECONNRESET|ETIMEDOUT|socket|timed out/i.test(msg)&&!/429|quota/i.test(msg);
}
export async function withTransientRetry<T>(fn:()=>Promise<T>,backoffMs=250):Promise<T>{
  try{return await fn();}
  catch(e){if(!isTransient(e))throw e;await new Promise(r=>setTimeout(r,backoffMs));return fn();}
}
