/* A readable title for tickets that have no order label. Conversations opened by the installed widget or the chat
   API carry no order, so the ticket list showed a blank title for every real conversation. They are titled with
   the visitor's first question (the same text agents already see in the ticket timeline), or "Website
   conversation" when nothing was asked yet. Reads through the signed-in client, so row-level security applies. */
import type {SupabaseClient} from '@supabase/supabase-js';
export const UNTITLED='Website conversation';
const BATCH=100;
export const titleFrom=(question:string|null|undefined)=>{const t=(question??'').replace(/\s+/g,' ').trim();return t?(t.length>90?t.slice(0,89).trimEnd()+'…':t):UNTITLED;};
export async function withTitles<T extends {id:string;order_label:string|null}>(client:SupabaseClient,userId:string,tickets:T[]):Promise<(T&{order_label:string})[]>{
 const need=tickets.filter(t=>!t.order_label).map(t=>t.id);
 const first=new Map<string,string>();
 try{
  for(let i=0;i<need.length;i+=BATCH){
   const r=await client.from('knowledge_interactions').select('case_id,question,created_at').eq('user_id',userId).in('case_id',need.slice(i,i+BATCH)).order('created_at',{ascending:true}).limit(2000);
   if(r.error)break;
   for(const q of r.data??[])if(!first.has(q.case_id as string))first.set(q.case_id as string,q.question as string);
  }
 }catch{/* titles are a convenience: fall back to the generic one */}
 return tickets.map(t=>({...t,order_label:t.order_label||titleFrom(first.get(t.id))}));
}
