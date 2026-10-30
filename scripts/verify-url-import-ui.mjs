import assert from'node:assert/strict';
import{spawn}from'node:child_process';
import{chromium}from'@playwright/test';
const PORT=3257,BASE=`http://127.0.0.1:${PORT}`;
const server=spawn('npm',['run','start','--','--port',String(PORT)],{stdio:'ignore'});
function ok(n){console.log('PASS',n);}
async function waitServer(){const dl=Date.now()+60000;while(Date.now()<dl){try{const r=await fetch(BASE+'/knowledge');if(r.status<500)return;}catch{}await new Promise(r=>setTimeout(r,1000));}throw Error('no server');}
try{
 await waitServer();
 const b=await chromium.launch();
 try{
 for(const[name,vp]of[['desktop',{width:1280,height:800}],['mobile',{width:390,height:844}]]){
  const p=await b.newPage({viewport:vp});
  const mutations=[];
  p.on('request',r=>{if(r.url().includes('/api/knowledge')&&!r.url().includes('import-url')&&r.method()==='POST')mutations.push(r.url());});
  await p.route('**/api/**',r=>{const u=r.request().url();let body={};
   if(u.includes('/api/knowledge/import-url'))body={title:'Example FAQ',content:'Refund policy: send items back within 14 days.\nShipping: 3 to 7 business days.',fetchedBytes:1024,truncated:false,sourceUrl:'https://example.com/faq',note:'Fetched one page only. Review the extracted text; nothing is saved or published until you choose it.'};
   else if(u.includes('/api/knowledge/custom'))body={responses:[]};
   else if(u.includes('/api/knowledge'))body={documents:[],usage:{pageUnits:0},attempts:[]};
   r.fulfill({status:200,contentType:'application/json',body:JSON.stringify(body)});});
  await p.goto(BASE+'/knowledge');await p.waitForLoadState('networkidle');
  await p.getByText('Import one public page by URL').waitFor({state:'visible',timeout:15000});
  await p.locator('input[type=url]').fill('https://example.com/faq');
  await p.getByText('Fetch and review page').click();
  await p.getByText(/Fetched one page only/).waitFor({state:'visible',timeout:15000});
  assert.equal(await p.locator('label',{hasText:'Source title'}).locator('input').inputValue(),'Example FAQ');
  const content=await p.locator('label',{hasText:'Source text'}).locator('textarea').inputValue();
  assert.ok(content.includes('Refund policy'),content);
  const checks=await p.locator('form input[type=checkbox]').evaluateAll(els=>els.map(e=>e.checked));
  assert.ok(!checks.some(Boolean),'no consent or publish checkbox auto-checked: '+JSON.stringify(checks));
  assert.equal(mutations.length,0,'import must not save anything');
  ok(name+' url import: prefills review form, consent/publish stay unchecked, nothing saved');
  await p.screenshot({path:'/downloads/automatepal-url-import-'+name+'.png',fullPage:true});
  await p.close();
 }
 }finally{await b.close();}
 console.log('all url-import UI checks passed');
}finally{server.kill();}
