import assert from'node:assert/strict';
import{spawn}from'node:child_process';
import{chromium}from'@playwright/test';
const PORT=3234,BASE=`http://127.0.0.1:${PORT}`;
const server=spawn('npm',['run','start','--','--port',String(PORT)],{stdio:'ignore'});
function ok(n){console.log('PASS',n);}
async function waitServer(){const dl=Date.now()+60000;while(Date.now()<dl){try{const r=await fetch(BASE+'/setup');if(r.status<500)return;}catch{}await new Promise(r=>setTimeout(r,1000));}throw Error('no server');}
const docs=[{id:'d1',title:'Fictional refund FAQ',published:true,content:'x'.repeat(30),updated_at:'2026-10-30',source_kind:'text',applicability:'',effective_from:null,effective_until:null},{id:'d2',title:'Draft shipping notes',published:false,content:'y'.repeat(30),updated_at:'2026-10-30',source_kind:'text',applicability:'',effective_from:null,effective_until:null},{id:'d3',title:'Draft hours',published:false,content:'z'.repeat(30),updated_at:'2026-10-30',source_kind:'text',applicability:'',effective_from:null,effective_until:null}];
try{
 await waitServer();
 const b=await chromium.launch();
 try{
 for(const[name,vp]of[['desktop',{width:1280,height:800}],['mobile',{width:390,height:844}]]){
  let expired=false;
  const mutations=[];
  const p=await b.newPage({viewport:vp});
  p.on('request',r=>{if(r.url().includes('/api/')&&r.method()!=='GET'&&!r.url().includes('/api/support'))mutations.push(r.method()+' '+r.url());});
  await p.route('**/api/knowledge',r=>r.fulfill({status:200,contentType:'application/json',body:JSON.stringify({documents:docs,usage:{pageUnits:1},attempts:[]})}));
  await p.route('**/api/support',r=>{
   if(r.request().method()==='POST')r.fulfill({status:200,contentType:'application/json',body:JSON.stringify({token:'tok123',expiresAt:new Date(Date.now()+(expired?-5:45)*60000).toISOString(),note:'ok'})});
   else r.fulfill({status:200,contentType:'application/json',body:JSON.stringify({requests:[],cases:[],settings:{label:'Site help',color:'#233de8',initials:'AP',prompts:['Ask a question'],allowedOrigins:[],excludedPaths:[]}})});});
  await p.goto(BASE+'/setup');await p.waitForLoadState('networkidle');
  await p.getByRole('button',{name:'2. Test it here'}).click();
  await p.getByText('You have 2 unpublished sources. The preview answers only from published sources.').waitFor({state:'visible',timeout:15000});
  ok(name+' unpublished-source nudge in playground');
  await p.getByRole('button',{name:'4. Install on your site'}).click();
  await p.getByRole('button',{name:'Create one-hour test'}).click();
  await p.getByText('Expires in about 45 minutes').waitFor({state:'visible'});
  ok(name+' live countdown shown');
  expired=true;
  await p.getByRole('button',{name:'Create one-hour test'}).click();
  await p.getByText('This test link has expired. Create a fresh one-hour test above').waitFor({state:'visible'});
  ok(name+' expired-link warning shown');
  assert.ok(await p.evaluate(w=>document.documentElement.scrollWidth<=w,vp.width),name+' overflow');
  assert.equal(mutations.length,0,mutations.join(','));
  await p.screenshot({path:`/downloads/automatepal-setup-nudges-${name}.png`,fullPage:true});
  await p.close();
  ok(name+' no overflow, no unexpected mutations, screenshot saved');
 }
 }finally{await b.close();}
}catch(e){console.error('FAIL',e);process.exitCode=1;}
finally{server.kill();}
