import assert from'node:assert/strict';
import{spawn}from'node:child_process';
import{chromium}from'@playwright/test';
const PORT=3232,BASE=`http://127.0.0.1:${PORT}`;
const server=spawn('npm',['run','start','--','--port',String(PORT)],{stdio:'ignore',env:{...process.env,NEXT_PUBLIC_DEMO_OPEN:'false'}});
function ok(n){console.log('PASS',n);}
async function waitServer(){const dl=Date.now()+60000;while(Date.now()<dl){try{const r=await fetch(BASE+'/setup');if(r.status<500)return;}catch{}await new Promise(r=>setTimeout(r,1000));}throw Error('no server');}
const variants={
 good:{found:true,tokenFound:'tok123',tokenMatches:true,originAllowed:true,finalUrl:'https://owner.example/'},
 mismatch:{found:true,tokenFound:'old',tokenMatches:false,originAllowed:null,finalUrl:'https://owner.example/'},
 missing:{found:false,tokenFound:null,tokenMatches:null,originAllowed:null,finalUrl:'https://owner.example/'},
 noorigin:{found:true,tokenFound:'tok123',tokenMatches:true,originAllowed:false,finalUrl:'https://owner.example/'}};
try{
 await waitServer();
 const b=await chromium.launch();
 try{
 for(const[name,vp]of[['desktop',{width:1280,height:800}],['mobile',{width:390,height:844}]]){
  let variant='good';
  const mutations=[];
  const p=await b.newPage({viewport:vp});
  p.on('request',r=>{if(r.url().includes('/api/')&&r.method()!=='GET'&&!r.url().includes('/api/support')&&!r.url().includes('/api/setup/verify-install'))mutations.push(r.method()+' '+r.url());});
  await p.route('**/api/knowledge',r=>r.fulfill({status:200,contentType:'application/json',body:JSON.stringify({documents:[{id:'d1',title:'Fictional refund FAQ',published:true,content:'x'.repeat(30),updated_at:'2026-10-30',source_kind:'text',applicability:'',effective_from:null,effective_until:null}],usage:{pageUnits:1},attempts:[]})}));
  await p.route('**/api/support',r=>{
   if(r.request().method()==='POST')r.fulfill({status:200,contentType:'application/json',body:JSON.stringify({token:'tok123',expiresAt:new Date(Date.now()+3600e3).toISOString(),note:'ok'})});
   else r.fulfill({status:200,contentType:'application/json',body:JSON.stringify({requests:[],cases:[],settings:{label:'Site help',color:'#233de8',initials:'AP',prompts:['Ask a question'],allowedOrigins:[],excludedPaths:[]}})});});
  await p.route('**/api/setup/verify-install',r=>r.fulfill({status:200,contentType:'application/json',body:JSON.stringify(variants[variant])}));
  await p.goto(BASE+'/setup');await p.waitForLoadState('networkidle');
  await p.getByRole('button',{name:'4. Install on your site'}).click();
  await p.getByRole('button',{name:'Create one-hour test'}).click();
  await p.getByText('One-line fictional demo script').waitFor({state:'visible',timeout:15000});
  await p.getByText('Check that it worked').waitFor({state:'visible'});
  await p.locator('input[type=url]').fill('https://owner.example/');
  await p.getByRole('button',{name:'Check my site'}).click();
  await p.getByText('Found: the demo script is on that page and matches this one-hour test, and the origin is allowed.').waitFor({state:'visible'});
  ok(name+' green result: script+token+origin verified');
  variant='noorigin';
  await p.getByRole('button',{name:'Check my site'}).click();
  await p.getByText("Script found and it matches, but this site's address is not in your allowed list yet.").waitFor({state:'visible'});
  ok(name+' origin pre-flight warning shown');
  variant='mismatch';
  await p.getByRole('button',{name:'Check my site'}).click();
  await p.getByText('A widget script was found, but it does not match this test link.').waitFor({state:'visible'});
  ok(name+' token mismatch warning shown');
  variant='missing';
  await p.getByRole('button',{name:'Check my site'}).click();
  await p.getByText('No demo script found on that page.').waitFor({state:'visible'});
  ok(name+' not-found guidance shown');
  assert.ok(await p.evaluate(w=>document.documentElement.scrollWidth<=w,vp.width),name+' overflow');
  assert.equal(mutations.length,0,mutations.join(','));
  await p.screenshot({path:`/downloads/automatepal-install-check-${name}.png`,fullPage:true});
  await p.close();
  ok(name+' no overflow, no unexpected mutations, screenshot saved');
 }
 }finally{await b.close();}
}catch(e){console.error('FAIL',e);process.exitCode=1;}
finally{server.kill();}
