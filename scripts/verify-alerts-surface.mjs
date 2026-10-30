import assert from'node:assert/strict';
import{spawn}from'node:child_process';
import{chromium}from'@playwright/test';
const PORT=3225,BASE=`http://127.0.0.1:${PORT}`;
const server=spawn('npm',['run','start','--','--port',String(PORT)],{stdio:'ignore'});
const results={checks:[],mutation_requests:[]};
function ok(n){results.checks.push(n);console.log('PASS',n);}
async function waitServer(){const dl=Date.now()+60000;while(Date.now()<dl){try{const r=await fetch(BASE+'/owner');if(r.status<500)return;}catch{}await new Promise(r=>setTimeout(r,1000));}throw Error('no server');}
const overview={asOf:new Date().toISOString(),tickets:[],queries:[],requests:[],usage:{utcDay:'2026-10-30',answersToday:0,dailyLimit:100,sources:0,sourceLimit:30,pageUnits:0,pageLimit:360},truncated:{tickets:false,queries:false,requests:false},coverage:'fixture'};
const alerts={preferences:{minimum_priority:'high',reasons:['refund','handoff','negative_feedback','unanswered'],channel:'telegram',quiet_start:22,quiet_end:7,timezone:'Asia/Kolkata',digest:true},log:[],enabled:false,eligible_count:2,eligible_now:[
 {id:'11111111-1111-4111-8111-111111111111',order_label:'Fictional Launch Kit order',ticket_status:'open',priority:'high',category:'refund',reasons:['priority','refund','unanswered']},
 {id:'22222222-2222-4222-8222-222222222222',order_label:'Fictional Annual plan order',ticket_status:'in_progress',priority:'normal',category:'handoff',reasons:['handoff']}],coverage:'fixture coverage'};
try{
 await waitServer();
 const b=await chromium.launch();
 try{
 forconst: for(const[name,vp]of[['desktop',{width:1280,height:800}],['mobile',{width:390,height:844}]]){
  const p=await b.newPage({viewport:vp});
  p.on('request',r=>{if(r.url().includes('/api/')&&r.method()!=='GET')results.mutation_requests.push(r.method()+' '+r.url());});
  await p.route('**/api/owner-overview',r=>r.fulfill({status:200,contentType:'application/json',body:JSON.stringify(overview)}));
  await p.route('**/api/owner-alerts',r=>r.fulfill({status:200,contentType:'application/json',body:JSON.stringify(alerts)}));
  await p.goto(BASE+'/owner');await p.waitForLoadState('networkidle');
  const panel=p.locator('section',{hasText:'Owner notification rules'});
  await panel.getByText('Needs review now (2)',{exact:false}).waitFor({state:'visible',timeout:15000});
  await panel.getByText('Fictional Launch Kit order').waitFor({state:'visible'});
  await panel.getByText('matches: priority, refund, unanswered').waitFor({state:'visible'});
  await panel.getByText('matches: handoff').waitFor({state:'visible'});
  assert.ok(await panel.locator('a[href="/tickets"]').count()>=2);
  assert.ok(await p.evaluate(w=>document.documentElement.scrollWidth<=w,vp.width),name+' overflow');
  await p.screenshot({path:`/downloads/automatepal-alerts-${name}.png`,fullPage:true});
  await p.close();
  ok(name+' eligible surface renders with reasons, ticket links, no overflow');
 }
 }finally{await b.close();}
 assert.equal(results.mutation_requests.length,0,'mutations: '+results.mutation_requests.join(','));
 ok('zero mutation requests');
}catch(e){console.error('FAIL',e);process.exitCode=1;}
finally{server.kill();const{default:fs}=await import('node:fs');fs.writeFileSync('/downloads/automatepal-alerts-tests.json',JSON.stringify({run_at:new Date().toISOString(),...results},null,2));}
