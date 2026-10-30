import assert from'node:assert/strict';
import{spawn}from'node:child_process';
import{chromium}from'@playwright/test';
const PORT=3246,BASE=`http://127.0.0.1:${PORT}`;
const server=spawn('npm',['run','start','--','--port',String(PORT)],{stdio:'ignore',env:{...process.env,NEXT_PUBLIC_DEMO_OPEN:'false'}});
function ok(n){console.log('PASS',n);}
async function waitServer(){const dl=Date.now()+60000;while(Date.now()<dl){try{const r=await fetch(BASE+'/owner');if(r.status<500)return;}catch{}await new Promise(r=>setTimeout(r,1000));}throw Error('no server');}
const now=Date.now(),iso=(ms)=>new Date(now-ms).toISOString();
const overview={tickets:[],truncated:{},usage:{utcDay:'',answersToday:4,dailyLimit:100,sources:2,sourceLimit:30,pageUnits:2,pageLimit:360},asOf:new Date(now).toISOString(),
 requests:[],coverage:'',
 queries:[
  {id:'q1',case_id:'c1',created_at:iso(86400000),question:'Do you ship to Pune?',supported:true,feedback:1},
  {id:'q2',case_id:'c1',created_at:iso(86400000),question:'What is the refund policy?',supported:true,feedback:1},
  {id:'q3',case_id:'c2',created_at:iso(2*86400000),question:'Do you deliver to Pune?',supported:true,feedback:-1},
  {id:'q4',case_id:'c2',created_at:iso(3*86400000),question:'Weekend hours?',supported:false,feedback:null}]};
const tickets=[{id:'t1',created_at:iso(86400000),order_label:'Order A',inbox_state:'attention',ticket_status:'open',priority:'normal',category:'handoff',assigned_to_owner:false,tags:[],ticket_type:'question',assignment_queue:'',expires_at:null,first_reviewed_at:null,ticket_updated_at:iso(1000),message_count:2,last_message_at:iso(1000)},
 {id:'t2',created_at:iso(86400000),order_label:'Order B',inbox_state:'auto',ticket_status:'open',priority:'normal',category:'billing',assigned_to_owner:false,tags:[],ticket_type:'question',assignment_queue:'',expires_at:null,first_reviewed_at:null,ticket_updated_at:iso(2000),message_count:1,last_message_at:iso(2000)}];
try{
 await waitServer();
 const b=await chromium.launch();
 try{
 for(const[name,vp]of[['desktop',{width:1280,height:800}],['mobile',{width:390,height:844}]]){
  const p=await b.newPage({viewport:vp});
  await p.route('**/api/**',r=>{const u=r.request().url();let body={};
   if(u.includes('/api/tickets'))body={tickets,truncated:false,coverage:''};
   else if(u.includes('/api/owner-overview'))body=overview;
   else if(u.includes('/api/owner-alerts'))body={preferences:{channel:'telegram',minimum_priority:'high',quiet_start:22,quiet_end:7,timezone:'Asia/Kolkata',digest:true,reasons:[]},log:[],eligible_now:[],eligible_count:0,coverage:''};
   r.fulfill({status:200,contentType:'application/json',body:JSON.stringify(body)});});
  await p.goto(BASE+'/owner');await p.waitForLoadState('networkidle');
  await p.getByText('Last 7 days (from the loaded snapshot):').waitFor({state:'visible',timeout:15000});
  const strip=await p.locator('div',{hasText:'Last 7 days'}).first().textContent();
  assert.ok(strip.includes('3 answered')&&strip.includes('1 unanswered'),strip);
  assert.ok(strip.includes('75% answered'),strip);
  assert.ok(strip.includes('67% of 3 ratings helpful'),strip);
  ok(name+' owner strip: 75% answered, 67% of 3 ratings helpful');
  await p.screenshot({path:'/downloads/automatepal-language-insights-'+name+'.png',fullPage:true});
  await p.goto(BASE+'/tickets');await p.waitForLoadState('networkidle');
  await p.getByText('Order A').waitFor({state:'visible',timeout:15000});
  await p.getByText('Order B').waitFor({state:'visible'});
  await p.getByText('Escalations only').click();
  await p.getByText('Order A').waitFor({state:'visible'});
  assert.equal(await p.getByText('Order B').count(),0,'Order B should be filtered out');
  ok(name+' tickets: Escalations only keeps handoff ticket, hides billing ticket');
  await p.screenshot({path:'/downloads/automatepal-escalations-filter-'+name+'.png',fullPage:true});
  await p.close();
 }
 }finally{await b.close();}
 console.log('all language-insights UI checks passed');
}finally{server.kill();}
