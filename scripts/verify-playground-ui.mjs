import assert from'node:assert/strict';
import{spawn}from'node:child_process';
import{chromium}from'@playwright/test';
const PORT=3227,BASE=`http://127.0.0.1:${PORT}`;
const server=spawn('npm',['run','start','--','--port',String(PORT)],{stdio:'ignore',env:{...process.env,NEXT_PUBLIC_DEMO_OPEN:'false'}});
const results={checks:[],mutations:[]};
function ok(n){results.checks.push(n);console.log('PASS',n);}
async function waitServer(){const dl=Date.now()+60000;while(Date.now()<dl){try{const r=await fetch(BASE+'/setup');if(r.status<500)return;}catch{}await new Promise(r=>setTimeout(r,1000));}throw Error('no server');}
const supported={answer:'You can ask for owner review within 14 days of your fictional order.',supported:true,retrieved:1,stages:['supported'],preview:true,sources:[{id:'s1',title:'Fictional refund FAQ',quotes:['customers can ask for owner review within 14 days']}]};
const fallback={answer:'I do not have enough published information to answer that. Please ask a person to review.',supported:false,retrieved:0,stages:['no_safe_sources'],preview:true,sources:[]};
try{
 await waitServer();
 const b=await chromium.launch();
 try{
 for(const[name,vp]of[['desktop',{width:1280,height:800}],['mobile',{width:390,height:844}]]){
  let answerBody=supported;
  const p=await b.newPage({viewport:vp});
  p.on('request',r=>{if(r.url().includes('/api/')&&r.method()!=='GET'&&!r.url().includes('/api/knowledge/test-answer'))results.mutations.push(r.method()+' '+r.url());});
  await p.route('**/api/knowledge',r=>r.fulfill({status:200,contentType:'application/json',body:JSON.stringify({documents:[{id:'d1',title:'Fictional refund FAQ',published:true,content:'x'.repeat(30),updated_at:'2026-10-30',source_kind:'text',applicability:'',effective_from:null,effective_until:null}],usage:{pageUnits:1},attempts:[]})}));
  await p.route('**/api/support',r=>r.fulfill({status:200,contentType:'application/json',body:JSON.stringify({requests:[],cases:[],settings:{label:'Site help',color:'#233de8',initials:'AP',prompts:['Ask a question'],allowedOrigins:[],excludedPaths:[]}})}));
  await p.route('**/api/knowledge/test-answer',r=>r.fulfill({status:200,contentType:'application/json',body:JSON.stringify(answerBody)}));
  await p.goto(BASE+'/setup');await p.waitForLoadState('networkidle');
  // 4 steps present
  for(const label of ['1. Add knowledge','2. Test it here','3. Pick the look','4. Install on your site'])await p.getByRole('button',{name:label}).waitFor({state:'visible',timeout:15000});
  await p.getByRole('button',{name:'2. Test it here'}).click();
  await p.getByRole('button',{name:'What is your refund policy?'}).click();
  await p.getByRole('button',{name:'Ask the preview'}).click();
  await p.getByText('Supported answer').waitFor({state:'visible'});
  await p.getByText('You can ask for owner review within 14 days').waitFor({state:'visible'});
  await p.getByText('customers can ask for owner review within 14 days').waitFor({state:'visible'});
  await p.getByText('Unrecorded preview · 1 sources retrieved').waitFor({state:'visible'});
  await p.screenshot({path:`/downloads/automatepal-playground-answer-${name}.png`,fullPage:true});
  ok(name+' playground supported answer with quote, stages, unrecorded label');
  // fallback case
  answerBody=fallback;
  await p.getByRole('button',{name:'Ask the preview'}).click();
  await p.getByText('Not answered - visitor sees this fallback').waitFor({state:'visible'});
  await p.getByText('I do not have enough published information').waitFor({state:'visible'});
  ok(name+' honest fallback display');
  // continue to look step 3 and install step 4 headers
  await p.getByRole('button',{name:'Continue to the look'}).click();
  await p.getByText('3. Keep the defaults or make it yours').waitFor({state:'visible'});
  await p.getByRole('button',{name:'4. Install on your site'}).click();
  await p.getByText('4. Ready to go live: test the link, then copy one line').waitFor({state:'visible'});
  ok(name+' 4-step navigation');
  assert.ok(await p.evaluate(w=>document.documentElement.scrollWidth<=w,vp.width),name+' overflow');
  await p.screenshot({path:`/downloads/automatepal-install-${name}.png`,fullPage:true});
  await p.close();
 }
 }finally{await b.close();}
 assert.equal(results.mutations.length,0,'unexpected mutations: '+results.mutations.join(','));
 ok('zero unexpected mutation requests');
}catch(e){console.error('FAIL',e);process.exitCode=1;}
finally{server.kill();const{default:fs}=await import('node:fs');fs.writeFileSync('/downloads/automatepal-playground-tests.json',JSON.stringify({run_at:new Date().toISOString(),...results},null,2));}
