import assert from'node:assert/strict';
import{spawn}from'node:child_process';
import{chromium}from'@playwright/test';
const PORT=3244,BASE=`http://127.0.0.1:${PORT}`;
const server=spawn('npm',['run','start','--','--port',String(PORT)],{stdio:'ignore'});
function ok(n){console.log('PASS',n);}
async function waitServer(){const dl=Date.now()+60000;while(Date.now()<dl){try{const r=await fetch(BASE+'/setup');if(r.status<500)return;}catch{}await new Promise(r=>setTimeout(r,1000));}throw Error('no server');}
try{
 await waitServer();
 const b=await chromium.launch();
 try{
 for(const[name,vp]of[['desktop',{width:1280,height:800}],['mobile',{width:390,height:844}]]){
  const posts=[];
  const p=await b.newPage({viewport:vp});
  p.on('request',r=>{if(r.url().includes('/api/')&&r.method()!=='GET')posts.push(r.method()+' '+r.url());});
  await p.route('**/api/**',r=>{const u=r.request().url();let body={};
   if(u.includes('/api/knowledge/custom'))body={responses:[]};
   else if(u.includes('/api/knowledge'))body={documents:[],usage:{pageUnits:0},attempts:[]};
   else if(u.includes('/api/support'))body={requests:[],cases:[],settings:{label:'Site help',color:'#233de8',initials:'AP',prompts:['Ask a question'],allowedOrigins:[],excludedPaths:[]}};
   r.fulfill({status:200,contentType:'application/json',body:JSON.stringify(body)});});
  await p.goto(BASE+'/knowledge');await p.waitForLoadState('networkidle');
  await p.getByText('Sources (').waitFor({state:'visible',timeout:15000});
  await p.getByRole('button',{name:'Fill a fictional sample'}).click();
  assert.equal(await p.locator('input').first().inputValue().catch(()=>''),'','title input not first - check below');
  await p.getByText('Fill a fictional sample').waitFor({state:'visible'});
  const content=await p.locator('textarea').last().inputValue();
  assert.ok(content.includes('Refund policy')&&content.includes('Support hours'),'sample content pre-filled');
  assert.equal(posts.length,0,'sample fill must not save: '+posts.join(','));
  ok(name+' sample pack pre-fills form, zero saves');
  await p.goto(BASE+'/setup');await p.waitForLoadState('networkidle');
  await p.getByRole('button',{name:'3. Pick the look'}).click();
  await p.getByRole('button',{name:'3. Pick the look'}).waitFor({state:'visible'});
  await p.reload();await p.waitForLoadState('networkidle');
  await p.waitForFunction(()=>{const b=[...document.querySelectorAll('button')].find(x=>x.getAttribute('aria-current')==='step');return b&&b.textContent.includes('3. Pick the look');},null,{timeout:15000});
  ok(name+' setup step persists across reload');
  assert.ok(await p.evaluate(w=>document.documentElement.scrollWidth<=w,vp.width),name+' overflow');
  await p.screenshot({path:`/downloads/automatepal-sample-memory-${name}.png`,fullPage:true});
  await p.close();
  ok(name+' no overflow, screenshot saved');
 }
 }finally{await b.close();}
}catch(e){console.error('FAIL',e);process.exitCode=1;}
finally{server.kill();}
