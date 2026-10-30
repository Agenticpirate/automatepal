import assert from'node:assert/strict';
import{spawn}from'node:child_process';
import{chromium}from'@playwright/test';
const PORT=3235,BASE=`http://127.0.0.1:${PORT}`;
const server=spawn('npm',['run','start','--','--port',String(PORT)],{stdio:'ignore'});
function ok(n){console.log('PASS',n);}
async function waitServer(){const dl=Date.now()+60000;while(Date.now()<dl){try{const r=await fetch(BASE+'/knowledge');if(r.status<500)return;}catch{}await new Promise(r=>setTimeout(r,1000));}throw Error('no server');}
try{
 await waitServer();
 const b=await chromium.launch();
 try{
 for(const[name,vp]of[['desktop',{width:1280,height:800}],['mobile',{width:390,height:844}]]){
  const mutations=[];
  const p=await b.newPage({viewport:vp});
  p.on('request',r=>{if(r.url().includes('/api/')&&r.method()!=='GET')mutations.push(r.method()+' '+r.url());});
  await p.route('**/api/**',r=>{const u=r.request().url();let body={};
   if(u.includes('/api/knowledge/custom'))body={responses:[]};else if(u.includes('/api/knowledge'))body={documents:[],usage:{pageUnits:0},attempts:[]};
   else if(u.includes('/api/tickets'))body={tickets:[]};
   else if(u.includes('/api/owner-overview'))body={tickets:[],queries:[],requests:[],truncated:{},usage:{utcDay:'',answersToday:0,dailyLimit:100,sources:0,sourceLimit:30,pageUnits:0,pageLimit:360},asOf:new Date().toISOString()};
   else if(u.includes('/api/owner-alerts'))body={preferences:{channel:'telegram',minimum_priority:'high',quiet_start:22,quiet_end:7,timezone:'Asia/Kolkata',digest:true,reasons:['refund','handoff']},log:[],eligible_now:[],eligible_count:0,coverage:''};
   else if(u.includes('/api/integrations'))body={tokens:[]};
   else if(u.includes('/api/webhooks'))body={webhook:null,events:[]};
   else if(u.includes('/api/account-data'))body={events:[],retention:'ok'};
   r.fulfill({status:200,contentType:'application/json',body:JSON.stringify(body)});});
  await p.goto(BASE+'/knowledge');await p.waitForLoadState('networkidle');
  await p.getByText('No sources yet. Add your first above').waitFor({state:'visible',timeout:15000});
  await p.goto(BASE+'/tickets');await p.waitForLoadState('networkidle');
  await p.getByRole('link',{name:'Create a fictional demo in Quick setup'}).waitFor({state:'visible',timeout:15000});
  await p.goto(BASE+'/owner');await p.waitForLoadState('networkidle');
  await p.getByRole('link',{name:'Finish Quick setup'}).waitFor({state:'visible',timeout:15000});
  await p.goto(BASE+'/integrations');await p.waitForLoadState('networkidle');
  await p.getByText('No tokens yet. Create one above to try the read-only API.').waitFor({state:'visible',timeout:15000});
  for(const pg of ['knowledge','tickets','owner','integrations']){await p.goto(BASE+'/'+pg);await p.waitForLoadState('networkidle');assert.ok(await p.evaluate(w=>document.documentElement.scrollWidth<=w,vp.width),pg+' overflow');}
  assert.equal(mutations.length,0,mutations.join(','));
  await p.goto(BASE+'/tickets');await p.waitForLoadState('networkidle');
  await p.screenshot({path:`/downloads/automatepal-empty-states-${name}.png`,fullPage:true});
  await p.close();
  ok(name+' 4 empty states with next-action guidance, no overflow, no mutations');
 }
 }finally{await b.close();}
}catch(e){console.error('FAIL',e);process.exitCode=1;}
finally{server.kill();}
