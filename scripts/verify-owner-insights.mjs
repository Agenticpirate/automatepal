import assert from'node:assert/strict';
import{spawn}from'node:child_process';
import{chromium}from'@playwright/test';
const PORT=3245,BASE=`http://127.0.0.1:${PORT}`;
const server=spawn('npm',['run','start','--','--port',String(PORT)],{stdio:'ignore',env:{...process.env,NEXT_PUBLIC_DEMO_OPEN:'false'}});
function ok(n){console.log('PASS',n);}
async function waitServer(){const dl=Date.now()+60000;while(Date.now()<dl){try{const r=await fetch(BASE+'/owner');if(r.status<500)return;}catch{}await new Promise(r=>setTimeout(r,1000));}throw Error('no server');}
const now=Date.now(),iso=(ms)=>new Date(now-ms).toISOString();
const overview={tickets:[],truncated:{},usage:{utcDay:'',answersToday:1,dailyLimit:100,sources:2,sourceLimit:30,pageUnits:2,pageLimit:360},asOf:new Date(now).toISOString(),
 requests:[{id:'r1',status:'pending_review',created_at:iso(2*86400000)}],
 queries:[
  {id:'q1',case_id:'c1',created_at:iso(86400000),question:'Do you ship to Pune?',supported:false,feedback:null},
  {id:'q2',case_id:'c1',created_at:iso(86400000),question:'Do you deliver to Pune city?',supported:false,feedback:null},
  {id:'q3',case_id:'c2',created_at:iso(86400000),question:'What is the refund policy?',supported:true,feedback:1},
  {id:'q4',case_id:'c2',created_at:iso(40*86400000),question:'Old question last month',supported:false,feedback:null}]};
const docs=[{id:'d1',title:'Fictional refund FAQ',published:true,content:'x'.repeat(40),updated_at:iso(120*86400000),source_kind:'text',applicability:'',effective_from:null,effective_until:null},{id:'d2',title:'Fresh shipping notes',published:true,content:'y'.repeat(25),updated_at:iso(2*86400000),source_kind:'text',applicability:'',effective_from:null,effective_until:null}];
try{
 await waitServer();
 const b=await chromium.launch();
 try{
 for(const[name,vp]of[['desktop',{width:1280,height:800}],['mobile',{width:390,height:844}]]){
  const mutations=[];
  const p=await b.newPage({viewport:vp});
  p.on('request',r=>{if(r.url().includes('/api/')&&r.method()!=='GET')mutations.push(r.method()+' '+r.url());});
  await p.route('**/api/**',r=>{const u=r.request().url();let body={};
   if(u.includes('/api/knowledge/custom'))body={responses:[]};
   else if(u.includes('/api/knowledge'))body={documents:docs,usage:{pageUnits:2},attempts:[]};
   else if(u.includes('/api/owner-overview'))body=overview;
   else if(u.includes('/api/owner-alerts'))body={preferences:{channel:'telegram',minimum_priority:'high',quiet_start:22,quiet_end:7,timezone:'Asia/Kolkata',digest:true,reasons:[]},log:[],eligible_now:[],eligible_count:0,coverage:''};
   r.fulfill({status:200,contentType:'application/json',body:JSON.stringify(body)});});
  await p.goto(BASE+'/owner');await p.waitForLoadState('networkidle');
  await p.getByText('Question trend').waitFor({state:'visible',timeout:15000});
  // weekly strip: last 7 days = q1,q2 unanswered + q3 answered; r1 review request. q4 is 40 days old.
  await p.getByText('Last 7 days (from the loaded snapshot):').waitFor({state:'visible'});
  const strip=await p.locator('div', {hasText:'Last 7 days'}).first().textContent();
  assert.ok(strip.includes('1 answered')&&strip.includes('2 unanswered')&&strip.includes('1 review requests'),strip);
  ok(name+' weekly strip counts 1 answered / 2 unanswered / 1 review');
  await p.getByText('Unanswered themes').waitFor({state:'visible'});
  await p.getByText('2 times: Do you ship to Pune?').waitFor({state:'visible'});
  ok(name+' unanswered themes clusters the Pune pair');
  assert.equal(mutations.length,0,mutations.join(','));
  await p.screenshot({path:`/downloads/automatepal-owner-insights-${name}.png`,fullPage:true});
  await p.goto(BASE+'/knowledge');await p.waitForLoadState('networkidle');
  await p.getByText('Sources (').waitFor({state:'visible',timeout:15000});
  await p.getByText('Unchanged 90+ days - check it is still accurate.').waitFor({state:'visible'});
  const nudges=await p.getByText('Unchanged 90+ days - check it is still accurate.').count();
  assert.equal(nudges,1,'only the 120-day source is nudged, not the 2-day one');
  ok(name+' stale-source nudge on old published source only');
  assert.equal(mutations.length,0,mutations.join(','));
  await p.screenshot({path:`/downloads/automatepal-stale-nudge-${name}.png`,fullPage:true});
  await p.close();
  ok(name+' no overflow/mutations, screenshots saved');
 }
 }finally{await b.close();}
}catch(e){console.error('FAIL',e);process.exitCode=1;}
finally{server.kill();}
