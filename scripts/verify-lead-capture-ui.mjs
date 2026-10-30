import assert from'node:assert/strict';
import{spawn}from'node:child_process';
import{chromium}from'@playwright/test';
const PORT=3254,BASE=`http://127.0.0.1:${PORT}`;
const server=spawn('npm',['run','start','--','--port',String(PORT)],{stdio:'ignore',env:{...process.env,NEXT_PUBLIC_DEMO_OPEN:'false'}});
function ok(n){console.log('PASS',n);}
async function waitServer(){const dl=Date.now()+60000;while(Date.now()<dl){try{const r=await fetch(BASE+'/help');if(r.status<500)return;}catch{}await new Promise(r=>setTimeout(r,1000));}throw Error('no server');}
const now=Date.now(),iso=(ms)=>new Date(now-ms).toISOString();
const caseItem={branding:{initials:'AP',label:'AutomatePal',prompts:[]},inboxState:'auto',controls:{},billing:null};
const overview={tickets:[],truncated:{},usage:{utcDay:'',answersToday:0,dailyLimit:100,sources:1,sourceLimit:30,pageUnits:1,pageLimit:360},asOf:new Date(now).toISOString(),coverage:'',
 requests:[{id:'r1',kind:'lead_callback',status:'pending_review',created_at:iso(86400000)},{id:'r2',kind:'refund_request',status:'pending_review',created_at:iso(86400000)}],
 queries:[{id:'q1',case_id:'c1',created_at:iso(86400000),question:'Weekend hours?',supported:false,feedback:null}]};
try{
 await waitServer();
 const b=await chromium.launch();
 try{
 for(const[name,vp]of[['desktop',{width:1280,height:800}],['mobile',{width:390,height:844}]]){
  const p=await b.newPage({viewport:vp});
  await p.route('**/api/**',r=>{const u=r.request().url(),m=r.request().method();let body={};
   if(u.includes('/api/support')&&m==='GET')body={case:caseItem};
   else if(u.includes('/api/support')&&m==='POST'){const j=r.request().postDataJSON();if(j.action==='answer')body={interactionId:'i1',supported:false,answer:'I do not have enough published information to answer that. Please ask a person to review.',sources:[]};else body={note:'ok'};}
   else if(u.includes('/api/owner-overview'))body=overview;
   else if(u.includes('/api/owner-alerts'))body={preferences:{channel:'telegram',minimum_priority:'high',quiet_start:22,quiet_end:7,timezone:'Asia/Kolkata',digest:true,reasons:[]},log:[],eligible_now:[],eligible_count:0,coverage:''};
   r.fulfill({status:200,contentType:'application/json',body:JSON.stringify(body)});});
  await p.goto(BASE+'/help?token='+'a'.repeat(64));await p.waitForLoadState('networkidle');
  await p.getByText('Clear answers. A person when needed.').waitFor({state:'visible',timeout:15000});
  await p.locator('textarea').fill('Do you deliver on Sundays?');
  await p.getByText('Ask a question').click();
  await p.getByText('Not enough verified source information.').waitFor({state:'visible',timeout:15000});
  const nudge=p.getByRole('button',{name:'Request a demo follow-up'});
  await nudge.waitFor({state:'visible'});
  await p.getByText('This question could not be answered from published sources.').waitFor({state:'visible'});
  await nudge.click();
  assert.equal(await p.locator('label',{hasText:'What do you need?'}).locator('select').inputValue(),'lead_callback','kind select should switch to lead_callback');
  assert.equal(await p.evaluate(()=>document.activeElement&&document.activeElement.id),'help-email','email input should be focused');
  const msg=await p.locator('textarea').inputValue();
  assert.ok(msg.trim().length>=5,'message prefilled');
  ok(name+' help: unsupported answer shows follow-up nudge, click sets lead_callback + focuses email');
  await p.screenshot({path:'/downloads/automatepal-lead-capture-'+name+'.png',fullPage:true});
  await p.goto(BASE+'/owner');await p.waitForLoadState('networkidle');
  await p.getByText('Last 7 days (from the loaded snapshot):').waitFor({state:'visible',timeout:15000});
  const strip=await p.locator('div',{hasText:'Last 7 days'}).first().textContent();
  assert.ok(strip.includes('2 review requests (1 follow-ups)'),strip);
  ok(name+' owner strip: 2 review requests (1 follow-ups)');
  await p.close();
 }
 }finally{await b.close();}
 console.log('all lead-capture UI checks passed');
}finally{server.kill();}
