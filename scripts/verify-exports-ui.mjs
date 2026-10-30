import assert from'node:assert/strict';
import{readFileSync}from'node:fs';
import{spawn}from'node:child_process';
import{chromium}from'@playwright/test';
const PORT=3241,BASE=`http://127.0.0.1:${PORT}`;
const server=spawn('npm',['run','start','--','--port',String(PORT)],{stdio:'ignore',env:{...process.env,NEXT_PUBLIC_DEMO_OPEN:'false'}});
function ok(n){console.log('PASS',n);}
async function waitServer(){const dl=Date.now()+60000;while(Date.now()<dl){try{const r=await fetch(BASE+'/knowledge');if(r.status<500)return;}catch{}await new Promise(r=>setTimeout(r,1000));}throw Error('no server');}
const docs=[{id:'d1',title:'Fictional refund FAQ',published:true,content:'x'.repeat(40),updated_at:'2026-10-30',source_kind:'text',applicability:'',effective_from:null,effective_until:null},{id:'d2',title:'Draft shipping',published:false,content:'y'.repeat(25),updated_at:'2026-10-29',source_kind:'text',applicability:'',effective_from:null,effective_until:null}];
const overview={tickets:[],requests:[],truncated:{},usage:{utcDay:'',answersToday:1,dailyLimit:100,sources:2,sourceLimit:30,pageUnits:2,pageLimit:360},asOf:new Date().toISOString(),queries:[{id:'q1',case_id:'c1',created_at:'2026-10-30T09:00:00Z',question:'Do you ship to Pune?',supported:false,feedback:null},{id:'q2',case_id:'c2',created_at:'2026-10-30T09:05:00Z',question:'Opening hours?',supported:true,feedback:1}]};
try{
 await waitServer();
 const b=await chromium.launch();
 try{
 for(const[name,vp]of[['desktop',{width:1280,height:800}],['mobile',{width:390,height:844}]]){
  const p=await b.newPage({viewport:vp,acceptDownloads:true});
  await p.route('**/api/**',r=>{const u=r.request().url();let body={};
   if(u.includes('/api/knowledge/custom'))body={responses:[]};
   else if(u.includes('/api/knowledge'))body={documents:docs,usage:{pageUnits:2},attempts:[]};
   else if(u.includes('/api/owner-overview'))body=overview;
   else if(u.includes('/api/owner-alerts'))body={preferences:{channel:'telegram',minimum_priority:'high',quiet_start:22,quiet_end:7,timezone:'Asia/Kolkata',digest:true,reasons:[]},log:[],eligible_now:[],eligible_count:0,coverage:''};
   r.fulfill({status:200,contentType:'application/json',body:JSON.stringify(body)});});
  await p.goto(BASE+'/knowledge');await p.waitForLoadState('networkidle');await p.getByText('Sources (').waitFor({state:'visible',timeout:15000});
  const[dl1]=await Promise.all([p.waitForEvent('download'),p.getByRole('button',{name:'Export sources CSV'}).click()]);
  const csv1=readFileSync(await dl1.path(),'utf8');
  assert.ok(csv1.includes('Fictional refund FAQ')&&csv1.includes('Draft shipping')&&csv1.startsWith('Source,Full ID'),csv1.slice(0,200));
  ok(name+' sources CSV downloads with both rows');
  await p.goto(BASE+'/owner');await p.waitForLoadState('networkidle');await p.getByText('Question trend').waitFor({state:'visible',timeout:15000});
  const[dl2]=await Promise.all([p.waitForEvent('download'),p.getByRole('button',{name:'Export unanswered questions CSV'}).click()]);
  const csv2=readFileSync(await dl2.path(),'utf8');
  assert.ok(csv2.includes('Do you ship to Pune?')&&!csv2.includes('Opening hours?'),csv2.slice(0,200));
  ok(name+' unanswered CSV downloads with only unsupported questions');
  assert.ok(await p.evaluate(w=>document.documentElement.scrollWidth<=w,vp.width),name+' overflow');
  await p.screenshot({path:`/downloads/automatepal-exports-${name}.png`,fullPage:true});
  await p.close();
  ok(name+' no overflow, screenshot saved');
 }
 }finally{await b.close();}
}catch(e){console.error('FAIL',e);process.exitCode=1;}
finally{server.kill();}
