import assert from'node:assert/strict';
import{spawn}from'node:child_process';
import{chromium}from'@playwright/test';
const PORT=3229,BASE=`http://127.0.0.1:${PORT}`;
const server=spawn('npm',['run','start','--','--port',String(PORT)],{stdio:'ignore'});
function ok(n){console.log('PASS',n);}
async function waitServer(){const dl=Date.now()+60000;while(Date.now()<dl){try{const r=await fetch(BASE+'/integrations');if(r.status<500)return;}catch{}await new Promise(r=>setTimeout(r,1000));}throw Error('no server');}
try{
 await waitServer();
 const b=await chromium.launch();
 try{
 for(const[name,vp]of[['desktop',{width:1280,height:800}],['mobile',{width:390,height:844}]]){
  const p=await b.newPage({viewport:vp});
  const mutations=[];
  p.on('request',r=>{if(r.url().includes('/api/')&&r.method()!=='GET')mutations.push(r.method()+' '+r.url());});
  await p.route('**/api/**',r=>{const u=r.request().url();const body=u.includes('/api/webhooks')?'{"webhook":null,"events":[]}':u.includes('/api/account-data')?'{"events":[],"retention":"ok"}':'{"tokens":[]}';r.fulfill({status:200,contentType:'application/json',body});});
  await p.goto(BASE+'/integrations');await p.waitForLoadState('networkidle');
  await p.getByText('Add-ons and channels').waitFor({state:'visible',timeout:15000});
  for(const n of ['Outbound webhooks','Zapier / Make','Email alerts','Slack','Google Chat','Crisp','Freshdesk','Zendesk','Facebook Messenger','WhatsApp Business'])await p.getByText(n,{exact:true}).waitFor({state:'visible'});
  assert.equal(await p.getByText('Set up (pending owner approval)').count(),10);
  assert.equal(await p.getByText('Needs from you').count(),10);
  assert.ok(await p.evaluate(w=>document.documentElement.scrollWidth<=w,vp.width),name+' overflow');
  assert.equal(mutations.length,0,mutations.join(','));
  await p.screenshot({path:`/downloads/automatepal-addons-${name}.png`,fullPage:true});
  await p.close();
  ok(name+' 10 add-ons with needs lists, disabled setup, no overflow, no mutations');
 }
 }finally{await b.close();}
}catch(e){console.error('FAIL',e);process.exitCode=1;}
finally{server.kill();}
