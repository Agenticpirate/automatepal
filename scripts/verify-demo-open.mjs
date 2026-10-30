import assert from'node:assert/strict';
import{spawn}from'node:child_process';
import{chromium}from'@playwright/test';
/* Open demo preview mode: unauthenticated visitors can view the app surfaces with the
   in-repo fictional fixtures; writes stay locked; noindex + robots; banner visible;
   the new in-house charts render from the fixture rows. Server runs with the flag's
   default (ON). No route interception - the point is that the real demo path works. */
const PORT=3260,BASE=`http://127.0.0.1:${PORT}`;
const server=spawn('npm',['run','start','--','--port',String(PORT)],{stdio:'ignore'});
function ok(n){console.log('PASS',n);}
async function waitServer(){const dl=Date.now()+90000;while(Date.now()<dl){try{const r=await fetch(BASE+'/api/status');if(r.status<500)return;}catch{}await new Promise(r=>setTimeout(r,1000));}throw Error('no server');}
try{
 await waitServer();
 const ov=await(await fetch(BASE+'/api/owner-overview')).json();
 assert.ok(ov.tickets.some(t=>t.order_label==='Fictional Launch Kit order'),'overview fixture');
 assert.equal(ov.error,undefined,'no auth error');
 ok('unauth GET /api/owner-overview serves fictional fixture');
 for(const[key,path]of[['tickets','/api/tickets'],['operations','/api/operations'],['knowledge','/api/knowledge'],['support','/api/support'],['dashboard','/api/dashboard'],['integrations','/api/integrations'],['webhooks','/api/webhooks'],['account-data','/api/account-data'],['sandbox-catalog','/api/sandbox-catalog'],['owner-alerts','/api/owner-alerts'],['actions','/api/actions'],['proof','/api/proof'],['knowledge-custom','/api/knowledge/custom'],['knowledge-analytics','/api/knowledge/analytics']]){
  const r=await fetch(BASE+path);assert.equal(r.status,200,key+' status');const j=await r.json();assert.equal(j.error,undefined,key+' error');
 }
 ok('all 14 demo GET APIs answer 200 without a session');
 const w=await fetch(BASE+'/api/tickets',{method:'POST',headers:{'content-type':'application/json'},body:'{}'});
 assert.equal(w.status,403,'write blocked');const wj=await w.json();assert.ok(/read-only/.test(wj.error),'read-only message');
 const chat=await fetch(BASE+'/api/chat',{method:'POST',headers:{'content-type':'application/json'},body:'{"message":"hi"}'});
 assert.equal(chat.status,403,'chat blocked in demo');
 ok('writes and AI chat return read-only 403 in demo mode');
 const robots=await(await fetch(BASE+'/robots.txt')).text();
 assert.ok(/Disallow: \//.test(robots),'robots disallows all in demo mode');
 ok('robots.txt disallows all in demo mode');
 const b=await chromium.launch();
 try{
 for(const[name,vp]of[['desktop',{width:1280,height:900}],['mobile',{width:390,height:844}]]){
  const p=await b.newPage({viewport:vp});
  const mutations=[];p.on('request',r=>{if(r.url().includes('/api/')&&r.method()!=='GET')mutations.push(r.method()+' '+r.url());});
  const home=await p.goto(BASE+'/');await p.waitForLoadState('networkidle');
  const robotsMeta=await p.evaluate(()=>document.querySelector('meta[name=robots]')?.content??'');
  assert.ok(/noindex/.test(robotsMeta),'noindex meta on /');
  ok(name+' homepage carries noindex/nofollow meta');
  await p.goto(BASE+'/owner');await p.waitForLoadState('networkidle');
  await p.getByText('Open demo preview').waitFor({state:'visible',timeout:15000});
  await p.getByText('Fictional Launch Kit order').first().waitFor({state:'visible'});
  const sparks=await p.locator('svg.ap-spark').count();assert.equal(sparks,8,'8 KPI sparklines');
  assert.ok(await p.locator('svg .ap-line-main').count()>=1,'line chart on owner');
  assert.ok(await p.locator('svg .ap-stack-seg').count()>=1,'stacked bars on owner');
  assert.ok(await p.locator('svg .ap-ring').count()>=1,'radial rings on owner');
  assert.ok(await p.locator('.ap-chart-bar rect, rect.ap-chart-bar').count()>=1,'trend bars still on owner');
  ok(name+' owner: banner, fixture rows, sparklines x8, line, stacked, rings, bars');
  assert.equal(mutations.length,0,mutations.join(','));
  await p.screenshot({path:`/downloads/automatepal-demo-open-owner-${name}.png`,fullPage:true});
  await p.goto(BASE+'/operations');await p.waitForLoadState('networkidle');
  await p.getByText('Event flow').waitFor({state:'visible',timeout:15000});
  assert.ok(await p.locator('svg .ap-line-main').count()>=1,'operations line');
  await p.goto(BASE+'/dashboard');await p.waitForLoadState('networkidle');
  await p.getByText('Succeeded volume per day').waitFor({state:'visible',timeout:15000});
  assert.ok(await p.locator('svg .ap-line-main').count()>=1,'dashboard line');
  ok(name+' operations event flow + dashboard volume charts render');
  assert.ok(!(await p.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1)),'mobile overflow');
  assert.equal(mutations.length,0,mutations.join(','));
  await p.screenshot({path:`/downloads/automatepal-demo-open-dash-${name}.png`,fullPage:true});
  await p.close();
 }
 }finally{await b.close();}
}catch(e){console.error('FAIL',e);process.exitCode=1;}
finally{server.kill();}
