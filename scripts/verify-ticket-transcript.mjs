import assert from'node:assert/strict';
import{spawn}from'node:child_process';
import{chromium}from'@playwright/test';
const PORT=3255,BASE=`http://127.0.0.1:${PORT}`;
const server=spawn('npm',['run','start','--','--port',String(PORT)],{stdio:'ignore'});
function ok(n){console.log('PASS',n);}
async function waitServer(){const dl=Date.now()+60000;while(Date.now()<dl){try{const r=await fetch(BASE+'/tickets');if(r.status<500)return;}catch{}await new Promise(r=>setTimeout(r,1000));}throw Error('no server');}
const now=Date.now(),iso=(ms)=>new Date(now-ms).toISOString();
const ticket={id:'t1',created_at:iso(3*86400000),order_label:'Order A',inbox_state:'attention',ticket_status:'open',priority:'high',category:'handoff',assigned_to_owner:false,tags:[],ticket_type:'question',assignment_queue:'',expires_at:null,first_reviewed_at:null,ticket_updated_at:iso(1000),message_count:3,last_message_at:iso(1000)};
const timeline={events:[{id:'e1',created_at:iso(2*86400000),kind:'note_added',body:'Internal note: called the courier.'}],
 requests:[{id:'r1',created_at:iso(1500000),kind:'lead_callback',message:'Please follow up on my delivery question.',status:'pending_review',contact_email:'sam@example.com'},
  {id:'r2',created_at:iso(1400000),kind:'refund_request',message:'Refund review please.',status:'pending_review',contact_email:null}],
 questions:[{id:'q1',created_at:iso(1600000),question:'Do you deliver on Sundays?',supported:false,feedback:null}],
 coverage:'Recorded questions, review requests and internal events only.'};
try{
 await waitServer();
 const b=await chromium.launch();
 try{
 for(const[name,vp]of[['desktop',{width:1280,height:800}],['mobile',{width:390,height:844}]]){
  const p=await b.newPage({viewport:vp});
  await p.route('**/api/**',r=>{const u=r.request().url();let body={};
   if(u.includes('/api/tickets?id='))body=timeline;
   else if(u.includes('/api/tickets'))body={tickets:[ticket],truncated:false,coverage:''};
   r.fulfill({status:200,contentType:'application/json',body:JSON.stringify(body)});});
  await p.goto(BASE+'/tickets');await p.waitForLoadState('networkidle');
  await p.getByText('Order A').waitFor({state:'visible',timeout:15000});
  await p.getByRole('button',{name:/T-T1/}).click();
  await p.getByText('Internal note: called the courier.').waitFor({state:'visible',timeout:15000});
  await p.getByText('Visitor request: lead callback').waitFor({state:'visible'});
  await p.getByText(/Follow-up email \(visitor consented\): sam@example\.com/).waitFor({state:'visible'});
  await p.getByText('Visitor question · unanswered').waitFor({state:'visible'});
  // chronological: question (oldest) before lead_callback before refund before note
  const items=await p.locator("ol li p").filter({hasText:"·"}).allInnerTexts();
  const order=items.map(t=>t.includes('Visitor question')?'q':t.includes('lead callback')?'l':t.includes('refund request')?'r':t.includes('note added')?'n':'?').join('');
  assert.equal(order,'nqlr',order);
  ok(name+' transcript: consented email shown, chronological Q -> lead -> refund -> note');
  await p.screenshot({path:'/downloads/automatepal-ticket-transcript-'+name+'.png',fullPage:true});
  await p.close();
 }
 }finally{await b.close();}
 console.log('all transcript checks passed');
}finally{server.kill();}
