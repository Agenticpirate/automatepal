import {NextRequest,NextResponse} from 'next/server';
import {z} from 'zod';
import {authenticate,roleAtLeast} from '../../../lib/session';
import {validOrigin} from '../../../lib/origin';
import {allowRequest} from '../../../lib/rate-limit';
import {limitedJson} from '../../../lib/limited-json';
import {demoGate,demoLocked} from '../../../lib/demo-open';
import {filterConversations,transcriptsCsv} from '../../../lib/transcripts';
import {loadConversations} from '../../../lib/transcripts-load';
/* Chat history (db/049). GET lists conversations with their transcripts (latest 300 conversations),
   filtered by ?q, ?from, ?to (UTC days), ?status and ?source; ?format=csv exports the filtered list.
   POST {action:'delete',id} deletes one conversation (manager and up); POST {action:'retention',days}
   sets how long transcripts are kept (admin and up). Agents and up can read. */
const noStore={'Cache-Control':'no-store'};
const LIMIT=300;
export async function GET(req:NextRequest){
 const c=await authenticate(req);if(!c){const d=demoGate(req,'history');if(d)return d;return NextResponse.json({error:'Please sign in.'},{status:401});}
 const p=req.nextUrl.searchParams,f={q:p.get('q')?.slice(0,200)??'',from:p.get('from')??'',to:p.get('to')??'',status:p.get('status')??'all',source:p.get('source')??'all'};
 const [loaded,ret]=await Promise.all([loadConversations(c),c.client.from('transcript_settings').select('retention_days').eq('user_id',c.userId).maybeSingle()]);
 if(!loaded||ret.error)return NextResponse.json({error:'Chat history is not enabled on this database yet.'},{status:503,headers:noStore});
 const list=filterConversations(loaded.conversations,f);
 if(p.get('format')==='csv')return new NextResponse(transcriptsCsv(list),{headers:{...noStore,'Content-Type':'text/csv; charset=utf-8','Content-Disposition':`attachment; filename="automatepal-chat-history-${new Date().toISOString().slice(0,10)}.csv"`}});
 return NextResponse.json({conversations:list,total:loaded.conversations.length,truncated:loaded.truncated,retentionDays:ret.data?.retention_days??90,role:c.role,
  coverage:`Latest ${LIMIT} conversations. Transcripts hold visitor questions, AI answers, person-chat messages and requests.`},{headers:noStore});
}
const Action=z.discriminatedUnion('action',[z.object({action:z.literal('delete'),id:z.string().uuid()}),z.object({action:z.literal('retention'),days:z.union([z.literal(30),z.literal(90),z.literal(365)])})]);
export async function POST(req:NextRequest){
 const c=await authenticate(req);if(!c){const d=demoLocked();if(d)return d;return NextResponse.json({error:'Please sign in.'},{status:401});}
 if(!validOrigin(req))return NextResponse.json({error:'Invalid origin'},{status:403});
 if(!allowRequest('history:'+c.actorId))return NextResponse.json({error:'Please wait a minute.'},{status:429});
 let b:z.infer<typeof Action>;try{b=Action.parse(await limitedJson(req,1000));}catch{return NextResponse.json({error:'Check the fields and try again.'},{status:400});}
 if(b.action==='delete'){
  if(!roleAtLeast(c.role,'manager'))return NextResponse.json({error:'Only managers, admins and the owner can delete conversations.'},{status:403});
  const r=await c.client.rpc('delete_conversation',{p_case:b.id});
  if(r.error)return NextResponse.json({error:'Conversation not deleted. Try again.'},{status:400});
  return NextResponse.json({note:r.data?'Conversation deleted: its transcript, ticket, requests and person chat are gone. Downloaded copies are not recalled.':'That conversation was already deleted.'},{headers:noStore});
 }
 if(!roleAtLeast(c.role,'admin'))return NextResponse.json({error:'Only admins and the owner can change transcript retention.'},{status:403});
 const r=await c.client.rpc('set_transcript_retention',{p_days:b.days});
 if(r.error||r.data!==true)return NextResponse.json({error:'Retention not saved.'},{status:400});
 return NextResponse.json({note:`Transcripts are now kept for ${b.days} days after a conversation's last activity, then deleted with the conversation.`},{headers:noStore});
}
