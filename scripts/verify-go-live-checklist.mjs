import assert from'node:assert/strict';
import{spawn}from'node:child_process';
import{chromium}from'@playwright/test';
const PORT=3240,BASE=`http://127.0.0.1:${PORT}`;
const server=spawn('npm',['run','start','--','--port',String(PORT)],{stdio:'ignore'});
function ok(n){console.log('PASS',n);}
async function waitServer(){const dl=Date.now()+60000;while(Date.now()<dl){try{const r=await fetch(BASE+'/setup');if(r.status<500)return;}catch{}await new Promise(r=>setTimeout(r,1000));}throw Error('no server');}
try{
 await waitServer();
 const b=await chromium.launch();
 try{
 for(const[name,vp]of[['desktop',{width:1280,height:800}],['mobile',{width:390,height:844}]]){
  const p=await b.newPage({viewport:vp});
  await p.route('**/api/knowledge',r=>r.fulfill({status:200,contentType:'application/json',body:JSON.stringify({documents:[{id:'d1',title:'Fictional refund FAQ',published:true,content:'x'.repeat(30),updated_at:'2026-10-30',source_kind:'text',applicability:'',effective_from:null,effective_until:null}],usage:{pageUnits:1},attempts:[]})}));
  await p.route('**/api/knowledge/custom',r=>r.fulfill({status:200,contentType:'application/json',body:'{"responses":[]}'}));
  await p.route('**/api/knowledge/test-answer',r=>r.fulfill({status:200,contentType:'application/json',body:JSON.stringify({answer:'Fictional answer.',supported:true,retrieved:1,stages:['supported'],preview:true,sources:[]})}));
  await p.route('**/api/support',r=>{
   if(r.request().method()==='POST'){const a=r.request().postDataJSON()?.action;
    if(a==='create_demo')r.fulfill({status:200,contentType:'application/json',body:JSON.stringify({token:'tok123',expiresAt:new Date(Date.now()+3600e3).toISOString(),note:'ok'})});
    else r.fulfill({status:200,contentType:'application/json',body:'{"note":"saved"}'});}
   else r.fulfill({status:200,contentType:'application/json',body:JSON.stringify({requests:[],cases:[],settings:{label:'Site help',color:'#233de8',initials:'AP',prompts:['Ask a question'],allowedOrigins:[],excludedPaths:[]}})});});
  await p.route('**/api/setup/verify-install',r=>r.fulfill({status:200,contentType:'application/json',body:JSON.stringify({found:true,tokenFound:'tok123',tokenMatches:true,originAllowed:true,finalUrl:'https://owner.example/'})}));
  await p.goto(BASE+'/setup');await p.waitForLoadState('networkidle');
  await p.getByText('Go-live checklist - 1 of 4 ready').waitFor({state:'visible',timeout:15000});
  ok(name+' starts at 1 of 4 (knowledge only)');
  await p.getByRole('button',{name:'2. Test it here'}).click();
  await p.locator('input[placeholder="Ask something a customer would ask"]').fill('What is the refund policy?');
  await p.getByRole('button',{name:'Ask the preview'}).click();
  await p.getByText('Go-live checklist - 2 of 4 ready').waitFor({state:'visible'});
  ok(name+' test marks 2 of 4');
  await p.getByRole('button',{name:'3. Pick the look'}).click();
  await p.getByRole('button',{name:'Save look and continue'}).click();
  await p.getByText('Go-live checklist - 3 of 4 ready').waitFor({state:'visible'});
  ok(name+' look save marks 3 of 4');
  await p.getByRole('button',{name:'Create one-hour test'}).click();
  await p.getByText('One-line fictional demo script').waitFor({state:'visible'});
  await p.locator('input[type=url]').fill('https://owner.example/');
  await p.getByRole('button',{name:'Check my site'}).click();
  await p.getByText('Go-live checklist - 4 of 4 ready').waitFor({state:'visible'});
  ok(name+' verified install marks 4 of 4');
  await p.reload();await p.waitForLoadState('networkidle');
  await p.getByText('Go-live checklist - 4 of 4 ready').waitFor({state:'visible',timeout:15000});
  await p.getByText('(tracked in this browser)').waitFor({state:'visible'});
  ok(name+' checklist persists across reload with honest scope label');
  assert.ok(await p.evaluate(w=>document.documentElement.scrollWidth<=w,vp.width),name+' overflow');
  await p.screenshot({path:`/downloads/automatepal-checklist-${name}.png`,fullPage:true});
  await p.close();
  ok(name+' no overflow, screenshot saved');
 }
 }finally{await b.close();}
}catch(e){console.error('FAIL',e);process.exitCode=1;}
finally{server.kill();}
