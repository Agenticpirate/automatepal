import {NextRequest,NextResponse} from 'next/server';
import {buildUnansweredDigest} from './unanswered-digest';
import {providerSummaries} from './billing/core/registry';
import {buildConversations} from './transcripts';

/* Open demo-preview mode, flag NEXT_PUBLIC_DEMO_OPEN (default ON while we build; set to
   'false' and redeploy to re-lock before launch). When ON and the request has no valid
   session, GET APIs on the app's own surfaces answer with the in-repo fictional fixtures
   below: no database rows, no secrets, no provider calls, no external sends. Every write
   stays locked with a read-only 403. The signed-in path is byte-for-byte untouched. */

export const demoOpen=()=>process.env.NEXT_PUBLIC_DEMO_OPEN!=='false';

export function demoLocked():NextResponse|null{
 return demoOpen()?NextResponse.json({error:'Demo preview is read-only while we build. Sign in to change anything.'},{status:403}):null;
}

const H=3600000,D=86400000;
const iso=(msAgo:number)=>new Date(Date.now()-msAgo).toISOString();
const day=(n:number,h=8)=>iso(n*D+h*H);
// The first 8 hex digits differ per case so short ticket labels (T-DE100001...) stay distinct.
const cid=(n:number)=>`de10000${n}-0000-4000-8000-00000000000${n}`;
const qid=(n:number)=>`de200000-0000-4000-8000-00000000000${n}`;
const rid=(n:number)=>`de300000-0000-4000-8000-00000000000${n}`;
const expires=()=>new Date(Date.now()+30*D).toISOString();

const tickets=[
 {id:cid(1),created_at:day(6),expires_at:expires(),order_label:'Fictional Launch Kit order',inbox_state:'attention',ticket_status:'open',priority:'high',category:'refund',tags:['refund','demo'],assigned_to_owner:true,first_reviewed_at:day(6,4),ticket_updated_at:day(0,5),ticket_type:'support',impact:'single_order',urgency:'high',assignment_queue:'owner',review_decision:null,related_ticket:null},
 {id:cid(2),created_at:day(5),expires_at:expires(),order_label:'Fictional Starter Box order',inbox_state:'open',ticket_status:'new',priority:'normal',category:'billing',tags:['billing'],assigned_to_owner:true,first_reviewed_at:null,ticket_updated_at:day(1,6),ticket_type:'support',impact:'single_order',urgency:'normal',assignment_queue:'owner',review_decision:null,related_ticket:null},
 {id:cid(3),created_at:day(4),expires_at:expires(),order_label:'Fictional Sample Pack order',inbox_state:'open',ticket_status:'in_progress',priority:'low',category:'shipping',tags:['shipping'],assigned_to_owner:true,first_reviewed_at:day(4,3),ticket_updated_at:day(2,2),ticket_type:'support',impact:'single_order',urgency:'low',assignment_queue:'owner',review_decision:null,related_ticket:null},
 {id:cid(4),created_at:day(2),expires_at:expires(),order_label:'Fictional Pro Subscription order',inbox_state:'attention',ticket_status:'open',priority:'urgent',category:'handoff',tags:['handoff'],assigned_to_owner:true,first_reviewed_at:null,ticket_updated_at:day(0,3),ticket_type:'support',impact:'multiple_orders',urgency:'urgent',assignment_queue:'owner',review_decision:null,related_ticket:null},
 {id:cid(5),created_at:day(9),expires_at:expires(),order_label:'Fictional Gift Card order',inbox_state:'resolved',ticket_status:'resolved',priority:'normal',category:'question',tags:[],assigned_to_owner:true,first_reviewed_at:day(9,2),ticket_updated_at:day(8),ticket_type:'support',impact:'single_order',urgency:'normal',assignment_queue:'owner',review_decision:'approved',related_ticket:null},
 {id:cid(6),created_at:day(3),expires_at:expires(),order_label:'Fictional Refill Pack order',inbox_state:'taken_over',ticket_status:'in_progress',priority:'high',category:'shipping',tags:['ai-paused'],assigned_to_owner:true,first_reviewed_at:day(3,1),ticket_updated_at:day(1,1),ticket_type:'support',impact:'single_order',urgency:'high',assignment_queue:'owner',review_decision:null,related_ticket:null},
 {id:cid(7),created_at:day(1),expires_at:expires(),order_label:'Fictional Bulk Office order',inbox_state:'open',ticket_status:'open',priority:'normal',category:'question',tags:[],assigned_to_owner:false,first_reviewed_at:null,ticket_updated_at:day(1,4),ticket_type:'support',impact:'multiple_orders',urgency:'normal',assignment_queue:'unassigned',review_decision:null,related_ticket:null},
 {id:cid(8),created_at:day(12),expires_at:expires(),order_label:'Fictional Damaged Item report',inbox_state:'closed',ticket_status:'closed',priority:'high',category:'refund',tags:['resolved'],assigned_to_owner:true,first_reviewed_at:day(12,1),ticket_updated_at:day(11),ticket_type:'support',impact:'single_order',urgency:'high',assignment_queue:'owner',review_decision:'refunded',related_ticket:null},
];

const queries=[
 {id:qid(1),case_id:cid(3),created_at:day(1,7),question:'Do you ship to Pune?',supported:false,feedback:null},
 {id:qid(2),case_id:cid(3),created_at:day(1,6),question:'Do you deliver to Pune city?',supported:false,feedback:null},
 {id:qid(3),case_id:cid(2),created_at:day(1,5),question:'What is the refund policy?',supported:true,feedback:1},
 {id:qid(4),case_id:cid(2),created_at:day(2,8),question:'What is the refund policy for opened kits?',supported:true,feedback:1},
 {id:qid(5),case_id:cid(2),created_at:day(2,6),question:'Can I change my delivery address?',supported:true,feedback:null},
 {id:qid(6),case_id:cid(3),created_at:day(3,7),question:'Do you ship to Pune?',supported:false,feedback:null},
 {id:qid(7),case_id:cid(6),created_at:day(3,5),question:'Weekend hours?',supported:false,feedback:null},
 {id:qid(8),case_id:cid(1),created_at:day(4,8),question:'Is the Launch Kit vegan?',supported:true,feedback:1},
 {id:qid(9),case_id:cid(1),created_at:day(4,4),question:'Do you accept returns without a receipt?',supported:true,feedback:-1},
 {id:qid(10),case_id:cid(4),created_at:day(5,6),question:'What payment methods do you take?',supported:true,feedback:null},
 {id:qid(11),case_id:cid(7),created_at:day(5,4),question:'Bulk discount for offices?',supported:false,feedback:null},
 {id:qid(12),case_id:cid(6),created_at:day(6,3),question:'How do I track my fictional order?',supported:true,feedback:1},
 {id:qid(13),case_id:cid(2),created_at:day(0,2),question:'Is gift wrap available?',supported:true,feedback:null},
 {id:qid(14),case_id:cid(7),created_at:day(0,1),question:'Do you ship to Pune?',supported:false,feedback:null},
 {id:qid(15),case_id:cid(5),created_at:day(41),question:'Old question from last month',supported:false,feedback:null},
];

const requests=[
 {id:rid(1),case_id:cid(1),created_at:day(1,3),kind:'refund_request',message:'Could someone review this fictional refund question?',status:'pending_review',contact_email:null,contact_consent:false},
 {id:rid(2),case_id:cid(4),created_at:day(2,2),kind:'human_handoff',message:'Fictional demo: I would like a person to review this question.',status:'pending_review',contact_email:null,contact_consent:false},
 {id:rid(3),case_id:cid(7),created_at:day(5,1),kind:'lead_callback',message:'Fictional demo: please follow up on my question.',status:'resolved',contact_email:'fictional-buyer@example.com',contact_consent:true},
];

const documents=[
 {id:'de400000-0000-4000-8000-000000000001',title:'Fictional refund FAQ',content:'Fictional refund policy for the demo store. Unopened kits can be returned within 30 days for a full refund. Opened kits are reviewed case by case by a person; nothing refunds automatically. Gift cards are not refundable. This text is fictional demo content, not a real policy.',created_at:day(20),updated_at:day(2),published:true,source_kind:'text',applicability:'demo-store',effective_from:null,effective_until:null},
 {id:'de400000-0000-4000-8000-000000000002',title:'Fictional shipping notes',content:'Fictional shipping notes. The demo store ships within India in 3-5 business days. Pune delivery is not available yet; questions about Pune should go to review. Tracking links are fictional in this preview. Weekend hours are 10am-2pm IST, fictional.',created_at:day(15),updated_at:day(6),published:true,source_kind:'text',applicability:'demo-store',effective_from:null,effective_until:null},
 {id:'de400000-0000-4000-8000-000000000003',title:'Fictional product care guide',content:'Fictional care guide for the Launch Kit. Store below 25C, keep dry, and use within 12 months of the fictional manufacturing date. The kit is plant-based and vegan. Do not treat this as real product advice.',created_at:day(10),updated_at:day(10),published:true,source_kind:'text',applicability:'demo-store',effective_from:null,effective_until:null},
];

const coverageOverview='Latest 200 tickets, 1000 queries, 100 requests only. Counts and trends cover these loaded rows; not all-time analytics. UTC days. No customer reply metric or SLA.';
const noStore={'Cache-Control':'no-store'};

function demoFixture(key:string,req:NextRequest):NextResponse|null{
 const today=new Date().toISOString().slice(0,10);
 const pageUnits=documents.reduce((n,d)=>n+Math.ceil([...d.content].length/2500),0);
 switch(key){
 case 'owner-overview':
  return NextResponse.json({asOf:new Date().toISOString(),tickets,queries,requests,usage:{utcDay:today,answersToday:queries.filter(x=>x.created_at.startsWith(today)).length,dailyLimit:100,sources:documents.length,sourceLimit:30,pageUnits,pageLimit:360},truncated:{tickets:false,queries:false,requests:false},coverage:coverageOverview},{headers:noStore});
 case 'owner-alerts':
  return NextResponse.json({preferences:{minimum_priority:'high',reasons:['refund','handoff','negative_feedback','unanswered'],channel:'telegram',quiet_start:22,quiet_end:7,timezone:'Asia/Kolkata',digest:true},log:[],enabled:false,eligible_now:[
   {id:cid(1),order_label:'Fictional Launch Kit order',ticket_status:'open',priority:'high',category:'refund',reasons:['priority','refund','unanswered']},
   {id:cid(4),order_label:'Fictional Pro Subscription order',ticket_status:'open',priority:'urgent',category:'handoff',reasons:['priority','handoff']},
  ],eligible_count:2,coverage:'In-app review surface from latest 200 tickets / 1000 queries. Not a delivery: nothing is sent.'},{headers:noStore});
 case 'tickets':{
  const id=req.nextUrl.searchParams.get('id');
  if(id){
   const found=tickets.find(t=>t.id===id);
   if(!found)return NextResponse.json({error:'Ticket not found.'},{status:404});
   return NextResponse.json({events:[
    {id:'de500000-0000-4000-8000-000000000001',created_at:found.created_at,kind:'created',body:'Fictional ticket created from the demo widget.'},
    {id:'de500000-0000-4000-8000-000000000002',created_at:found.ticket_updated_at,kind:'note',body:'Fictional internal note: review before any customer-facing reply.'},
   ],requests:requests.filter(r=>r.case_id===id).map(x=>({id:x.id,created_at:x.created_at,kind:x.kind,message:x.message,status:x.status,contact_email:x.contact_consent?x.contact_email:null})),questions:queries.filter(q=>q.case_id===id).map(q=>({id:q.id,created_at:q.created_at,question:q.question,supported:q.supported,feedback:q.feedback})),messages:found.inbox_state==='taken_over'?[
    {id:'de510000-0000-4000-8000-000000000001',created_at:day(1,2),author:'owner',body:'Hi, this is the fictional store owner. I have paused the assistant and will help you here.'},
    {id:'de510000-0000-4000-8000-000000000002',created_at:day(1,1),author:'visitor',body:'Thanks! Can the fictional refill pack still ship this week?'},
   ]:[],coverage:'Recorded questions, review requests, internal events and widget replies. Full AI answers are in Chat history. A reply is emailed only when you tick “Also email this reply” and the visitor gave an address with consent. Contact emails appear only when the visitor consented to share them.'},{headers:noStore});
  }
  return NextResponse.json({tickets,truncated:false,limit:200},{headers:noStore});
 }
 case 'operations':
  return NextResponse.json({events:[
   {id:'de600000-0000-4000-8000-000000000001',created_at:day(0,4),request_id:'demo-req-0001',code:'TICKET_READ_FAILED',severity:'warning',component:'tickets',release:'demo-preview',attempt:1},
   {id:'de600000-0000-4000-8000-000000000002',created_at:day(0,3),request_id:'demo-req-0002',code:'SAFE_RETRY_RECOVERED',severity:'info',component:'tickets',release:'demo-preview',attempt:2},
   {id:'de600000-0000-4000-8000-000000000003',created_at:day(1,6),request_id:'demo-req-0003',code:'OWNER_SNAPSHOT_FAILED',severity:'error',component:'owner',release:'demo-preview',attempt:1},
   {id:'de600000-0000-4000-8000-000000000004',created_at:day(2,5),request_id:'demo-req-0004',code:'ALERT_CHECK_SKIPPED',severity:'info',component:'alerts',release:'demo-preview',attempt:1},
   {id:'de600000-0000-4000-8000-000000000005',created_at:day(4,9),request_id:'demo-req-0005',code:'HEALTH_PROBE_SLOW',severity:'warning',component:'health',release:'demo-preview',attempt:1},
  ],summary:{asOf:new Date().toISOString(),coverage:'Fictional demo fixture. Loaded rows only.',dependencyProbe:'Database query succeeded; model/provider not probed.',automatedRecovery:'Ticket-list transient DB connection/capacity error: one read retry only.'},coverage:'Fictional demo fixture. Latest 200 within 7 days; max 500 retained.'},{headers:noStore});
 case 'knowledge':
  return NextResponse.json({documents,attempts:[],usage:{sources:documents.length,pageUnits,sourceLimit:30,pageLimit:360,unit:'2500 stored text characters, rounded up per source'}},{headers:noStore});
 case 'knowledge-custom':
  return NextResponse.json({responses:[
   {id:'de700000-0000-4000-8000-000000000001',question:'Do you ship to Pune?',answer:'Not yet - fictional demo answer. Pune delivery is planned; a person will follow up on your case.',published:true,updated_at:day(2)},
   {id:'de700000-0000-4000-8000-000000000002',question:'Weekend hours?',answer:'Fictional demo answer: 10am-2pm IST on weekends.',published:false,updated_at:day(3)},
  ]},{headers:noStore});
 case 'knowledge-analytics':{
  const rows=queries.map(q=>({...q,source_count:q.supported?2:0}));
  return NextResponse.json({interactions:rows,digest:buildUnansweredDigest(rows),truncated:false,coverage:'Most recent up to1000 recorded demo questions only; not all-time totals.'},{headers:noStore});
 }
 case 'webhooks':
  return NextResponse.json({webhook:null,events:[]},{headers:noStore});
 case 'integrations':
  return NextResponse.json({tokens:[]},{headers:noStore});
 case 'sandbox-catalog':
  return NextResponse.json({asOf:new Date().toISOString(),environment:'PayPal sandbox',readOnly:true,paymentExecution:false,data:{products:[{id:'PROD-DEMO-FICTIONAL1',name:'Fictional Launch Kit'},{id:'PROD-DEMO-FICTIONAL2',name:'Fictional Starter Box'}],plans:[{id:'P-DEMO0000000000000000001',product_id:'PROD-DEMO-FICTIONAL1',name:'Fictional Monthly Plan',status:'ACTIVE'}],coverage:'First page only, up to 20 products and 20 plans. Plan status is not subscription activation, payment, revenue or customer eligibility. No subscriber/contact/transaction data returned. Fictional demo fixture; no provider call was made.'}},{headers:noStore});
 case 'support':
  return NextResponse.json({requests,cases:tickets.map(t=>({id:t.id,created_at:t.created_at,expires_at:t.expires_at,order_label:t.order_label,inbox_state:t.inbox_state})),settings:{label:'Fictional demo store',color:'#FD91CC',initials:'AP',prompts:['What is the refund policy?','Do you ship to Pune?','Weekend hours?'],allowedOrigins:[],excludedPaths:[],autoOpen:false,side:'right',hideSources:false,hideOrder:false,hideContact:false,visitorChoice:true,workingHours:{enabled:true,timezone:'Asia/Kolkata',days:[1,2,3,4,5].map(day=>({day,start:'09:00',end:'18:00'})),awayMessage:'Fictional demo store: we are away right now. Leave your question and the team will reply when they are back.'}}},{headers:noStore});
 case 'history':{
  // Fictional transcripts built from the same fixtures; answers are written here, nothing is stored.
  const answers:Record<string,string>={'What is the refund policy?':'Unopened fictional kits can be returned within 30 days for a refund review by the owner.','Is the Launch Kit vegan?':'Yes. The fictional Launch Kit lists only plant-based ingredients.'};
  const conversations=buildConversations(tickets.map(t=>({id:t.id,created_at:t.created_at,ticket_status:t.ticket_status,inbox_state:t.inbox_state,order_label:t.order_label})),
   queries.map(q=>({...q,answer:q.supported?(answers[q.question]??'Answered from the fictional store FAQ.'):'Not enough verified source information. A person can review this.',source:q.case_id===cid(3)?'hosted_page':'widget'})),[],requests.map(r=>({id:r.id,case_id:r.case_id,created_at:r.created_at,kind:r.kind,message:r.message})));
  return NextResponse.json({conversations,total:conversations.length,truncated:false,retentionDays:90,role:'owner',demo:true,coverage:'Fictional demo conversations. Transcripts hold visitor questions, AI answers, person-chat messages and requests.'},{headers:noStore});
 }
 case 'email-settings':
  return NextResponse.json({settings:{owner_alerts:true,weekly_digest:true,new_leads:true},log:[{id:'deb00000-0000-4000-8000-000000000001',created_at:day(1,2),email_type:'owner_alert',status:'dry_run'},{id:'deb00000-0000-4000-8000-000000000002',created_at:day(3,1),email_type:'weekly_digest',status:'dry_run'}],transport:'dry_run',canEdit:false,caps:'Per workspace per UTC day: 20 owner alerts, 20 new-lead emails, 20 invites, 50 visitor replies, 100 in total; one weekly digest every 6 days.'},{headers:noStore});
 case 'knowledge-refresh':
  return NextResponse.json({settings:{frequency:'weekly',sitemap_url:'https://north-dock.example.com/sitemap.xml',last_run_at:day(2,3),next_due_at:iso(-5*D),last_summary:{checked:4,changed:1,added:0,removed:0,sitemap:'read'}},items:[],limits:'Each run re-checks up to 15 saved pages, least recently checked first, so every saved page takes its turn. It proposes up to 5 sitemap pages that were not in an earlier read; dismissed pages are not proposed again. A saved page is proposed for removal only when it answers 404 or 410, or when a fully read sitemap no longer lists it (only pages on the same host as the sitemap); a dismissed removal is not proposed again. The same robots.txt, private-address and size checks as an import apply.'},{headers:noStore});
 case 'insights':
  return NextResponse.json({topics:['Billing','Shipping','Refunds','Account','Product','Technical issue'],enabled:true,canEdit:false},{headers:noStore});
 case 'leads':{
  const leads=requests.filter(r=>r.contact_consent&&r.contact_email).map(r=>({id:r.id,case_id:r.case_id,created_at:r.created_at,kind:r.kind,contact_email:r.contact_email as string}));
  return NextResponse.json({leads,total:leads.length,limit:500,role:'owner',demo:true,coverage:'Fictional demo lead. Consented contact emails from widget requests, latest 500. Nothing is forwarded to email or a CRM.'},{headers:noStore});
 }
 case 'dashboard':{
  const ev=(n:number,ms:number,kind:string,source:string,amount?:number,note?:string)=>({id:`de800000-0000-4000-8000-00000000000${n}`,ts:iso(ms),kind,source,refId:`DEMO-${n}0000FICTIONAL`,amount,currency:amount!=null?'USD':undefined,customer:'fictional-customer@example.com',note:note??'Fictional demo event'});
  const events=[
   ev(1,13*D,'product_created','paypal_sandbox',undefined,'Fictional Launch Kit created'),
   ev(2,13*D,'plan_created','paypal_sandbox',undefined,'Fictional Monthly Plan created'),
   ev(3,12*D,'order_created','paypal_sandbox',49,'Fictional order for the Launch Kit'),
   ev(4,12*D,'payment_succeeded','paypal_sandbox',49),
   ev(5,8*D,'subscription_created','paypal_sandbox',undefined,'Fictional monthly subscription'),
   ev(6,8*D,'payment_succeeded','paypal_sandbox',12),
   ev(7,3*D,'payment_failed','paypal_sandbox',12,'Fictional decline: insufficient funds'),
   ev(8,1*D,'payment_succeeded','paypal_sandbox',12),
   ev(9,10*D,'payment_succeeded','simulation',99),
   ev(10,9*D,'payment_succeeded','simulation',12),
   ev(11,6*D,'payment_succeeded','simulation',12),
   ev(12,5*D,'payment_failed','simulation',12,'Fictional decline in simulation'),
   ev(13,2*D,'subscription_created','simulation',undefined,'Fictional simulated subscriber'),
   ev(14,2*D,'payment_succeeded','simulation',12),
  ];
  const stats={totalRevenue:73,mrr:12,activeSubscriptions:1,failedPayments:1,succeededPayments:3};
  const demoStats={totalRevenue:135,mrr:24,activeSubscriptions:2,failedPayments:1,succeededPayments:4};
  return NextResponse.json({stats,demoStats,events},{headers:noStore});
 }
 case 'account-data':
  return NextResponse.json({events:[
   {id:'de900000-0000-4000-8000-000000000001',created_at:day(1,2),resource:'knowledge_document',operation:'update',resource_id:'de400000-0000-4000-8000-000000000001'},
   {id:'de900000-0000-4000-8000-000000000002',created_at:day(2,5),resource:'ticket',operation:'review',resource_id:cid(1)},
   {id:'de900000-0000-4000-8000-000000000003',created_at:day(3,1),resource:'widget_settings',operation:'update',resource_id:null},
  ],limit:100,retention:'Latest 100 shown; max 1000 retained per workspace. No raw text, tokens or contact details.'},{headers:noStore});
 case 'proof':
  return NextResponse.json({contracts:[],assessments:[],events:[]},{headers:noStore});
 case 'actions':
  return NextResponse.json({actions:[]},{headers:noStore});
 case 'team':{
  // Fictional teammates on example.com addresses; nobody here is a real person.
  const ws='de500000-0000-4000-8000-000000000001';
  return NextResponse.json({me:{id:ws,email:'owner@north-dock.example.com'},demo:true,
   workspaces:[{workspace_id:ws,role:'owner',owner_email:'owner@north-dock.example.com',joined_at:day(40)}],
   current:{workspace_id:ws,role:'owner'},
   team:[
    {user_id:ws,email:'owner@north-dock.example.com',role:'owner',joined_at:day(40),is_you:true},
    {user_id:'de500000-0000-4000-8000-000000000002',email:'priya.admin@north-dock.example.com',role:'admin',joined_at:day(21),is_you:false},
    {user_id:'de500000-0000-4000-8000-000000000003',email:'arjun.support@north-dock.example.com',role:'manager',joined_at:day(14),is_you:false},
    {user_id:'de500000-0000-4000-8000-000000000004',email:'meera.agent@north-dock.example.com',role:'agent',joined_at:day(6),is_you:false},
    {user_id:'de500000-0000-4000-8000-000000000005',email:'kiran.agent@north-dock.example.com',role:'agent',joined_at:day(2),is_you:false},
   ],
   invites:[{id:'de500000-0000-4000-8000-000000000010',email:'new.hire@north-dock.example.com',role:'agent',created_at:day(1),expires_at:iso(-6*D)}],
  },{headers:noStore});
 }
 case 'billing':
  // Fictional PayPal test connection and lookups. No credential, no provider call, no money movement.
  return NextResponse.json({providers:providerSummaries(),
   connections:[{id:'dea00000-0000-4000-8000-000000000001',provider:'paypal',mode:'test',key_id:'k1',key_hint:'AYdemo…demo',account_label:null,config:{},status:'connected',last_checked_at:day(0,2),live_confirmed_at:null,created_at:day(9),updated_at:day(0,2),needsRotation:false}],
   events:[
    {id:'dea10000-0000-4000-8000-000000000001',provider:'paypal',mode:'test',event:'connected',actor_id:null,created_at:day(9)},
    {id:'dea10000-0000-4000-8000-000000000002',provider:'paypal',mode:'test',event:'check_ok',actor_id:null,created_at:day(0,2)},
   ],
   lookups:[
    {id:'dea20000-0000-4000-8000-000000000001',case_id:cid(1),provider:'paypal',mode:'test',kind:'verify',intent:null,outcome:'verified',record_kind:'order',record_ref:'…901E',record_status:'COMPLETED',amount_minor:4900,currency:'USD',created_at:day(1,4)},
    {id:'dea20000-0000-4000-8000-000000000002',case_id:cid(1),provider:'paypal',mode:'test',kind:'lookup',intent:'refund_status',outcome:'answered',record_kind:'order',record_ref:'…901E',record_status:'COMPLETED',amount_minor:4900,currency:'USD',created_at:day(1,3)},
    {id:'dea20000-0000-4000-8000-000000000003',case_id:cid(2),provider:'paypal',mode:'test',kind:'verify',intent:null,outcome:'mismatch',record_kind:null,record_ref:null,record_status:null,amount_minor:null,currency:null,created_at:day(2,6)},
    {id:'dea20000-0000-4000-8000-000000000004',case_id:cid(2),provider:'paypal',mode:'test',kind:'lookup',intent:'failed_payment',outcome:'answered',record_kind:'subscription',record_ref:'I-…BBBB',record_status:'ACTIVE',amount_minor:1900,currency:'USD',created_at:day(2,5)},
   ],
   available:true,role:'owner',encryptionReady:true,paymentExecution:false,demo:true,
   limits:{workspacePer10Min:60,workspacePerDay:300,providerPer10Min:30,caseFailedVerifications:5,caseLookups:30,verificationMinutes:30}},{headers:noStore});
 default:return null;
 }
}

export function demoGate(req:NextRequest,key:string):NextResponse|null{
 if(!demoOpen())return null;
 if(req.method==='GET')return demoFixture(key,req);
 return demoLocked();
}
