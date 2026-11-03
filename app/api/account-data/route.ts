import{demoGate,demoLocked}from'../../../lib/demo-open';
import {NextRequest,NextResponse} from 'next/server';
import {authenticate,roleAtLeast,type Session} from '../../../lib/session';import {loadConversations} from '../../../lib/transcripts-load';import {validOrigin} from '../../../lib/origin';
import {limitedJson} from '../../../lib/limited-json';
import {allowRequest} from '../../../lib/rate-limit';
export async function GET(req:NextRequest){const c=await authenticate(req);if(!c){const d=demoGate(req,'account-data');if(d)return d;return NextResponse.json({error:'Please sign in.'},{status:401});}if(req.nextUrl.searchParams.get('export')==='1')return exportData(c);const r=await c.client.from('owner_audit_events').select('id,created_at,resource,operation,resource_id').eq('user_id',c.userId).order('created_at',{ascending:false}).limit(100);return NextResponse.json(r.error?{error:'Audit history unavailable.'}:{events:r.data,limit:100,retention:'Latest 100 shown; max 1000 retained per workspace. No raw text, tokens or contact details.'},{status:r.error?503:200});}
export async function POST(req:NextRequest){const c=await authenticate(req);if(!c){const d=demoLocked();if(d)return d;return NextResponse.json({error:'Please sign in.'},{status:401});}if(!validOrigin(req))return NextResponse.json({error:'Invalid origin'},{status:403});if(!allowRequest('data:'+c.actorId))return NextResponse.json({error:'Please wait a minute.'},{status:429});try{const b=await limitedJson(req,1000) as {confirmation?:unknown};if(b?.confirmation!=='DELETE MY PREVIEW DATA')throw Error('Confirmation required.');const r=await c.client.rpc('delete_preview_data',{p_confirmation:b.confirmation});if(r.error||!r.data)throw Error('Not deleted. Reconcile uncertain actions first or try again after service recovery.');return NextResponse.json({note:'Preview application data deleted. Auth account, provider-held data, exports and backups are not deleted by this action. No PayPal action taken.'});}catch{return NextResponse.json({error:'Not deleted or outcome unconfirmed. Reload audit history before retrying. Reconcile uncertain actions first.'},{status:400});}}

/* Account-data export (owner only): conversations with full transcripts (latest 300), knowledge sources,
   custom responses, consented leads, settings and the audit history, as one JSON download. */
async function exportData(c:Session){
 if(!roleAtLeast(c.role,'owner'))return NextResponse.json({error:'Only the workspace owner can export workspace data.'},{status:403});
 if(!allowRequest('export:'+c.actorId))return NextResponse.json({error:'Please wait a minute.'},{status:429});
 const[conv,docs,custom,leads,widget,email,retention,refresh,insights,audit]=await Promise.all([
  loadConversations(c),
  c.client.from('knowledge_documents').select('id,title,content,published,source_kind,created_at,updated_at').eq('user_id',c.userId).limit(31),
  c.client.from('custom_responses').select('id,question,answer,published,updated_at').eq('user_id',c.userId).limit(31),
  c.client.from('support_requests').select('id,case_id,created_at,kind,contact_email').eq('user_id',c.userId).eq('contact_consent',true).not('contact_email','is',null).limit(500),
  c.client.from('widget_settings').select('label,color,initials,prompts,controls').eq('user_id',c.userId).maybeSingle(),
  c.client.from('email_settings').select('owner_alerts,weekly_digest,new_leads').eq('user_id',c.userId).maybeSingle(),
  c.client.from('transcript_settings').select('retention_days').eq('user_id',c.userId).maybeSingle(),
  c.client.from('refresh_settings').select('frequency,sitemap_url,last_run_at').eq('user_id',c.userId).maybeSingle(),
  c.client.from('conversation_insights').select('case_id,topic,sentiment,outcome,labeled_at').eq('user_id',c.userId).limit(1000),
  c.client.from('owner_audit_events').select('id,created_at,resource,operation,resource_id').eq('user_id',c.userId).order('created_at',{ascending:false}).limit(1000),
 ]);
 if(!conv||docs.error||custom.error||leads.error||audit.error)return NextResponse.json({error:'Export unavailable. Try again after service recovery.'},{status:503});
 const body={exportedAt:new Date().toISOString(),workspace:c.userId,conversations:conv.conversations,conversationsTruncated:conv.truncated,knowledgeSources:docs.data,customResponses:custom.data,leads:leads.data,
  settings:{widget:widget.data??null,email:email.error?null:email.data,transcriptRetentionDays:retention.error?null:(retention.data?.retention_days??90),refresh:refresh.error?null:refresh.data},insights:insights.error?[]:insights.data,auditEvents:audit.data,
  notIncluded:'Sign-in account details held by Supabase Auth, billing provider credentials (never exported), backups and provider-held data.'};
 return new NextResponse(JSON.stringify(body,null,1),{headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','Content-Disposition':`attachment; filename="automatepal-workspace-export-${new Date().toISOString().slice(0,10)}.json"`}});
}
