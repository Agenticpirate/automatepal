import assert from'node:assert/strict';
import{spawn}from'node:child_process';
import{chromium,request as pwrequest}from'@playwright/test';
const PORT=3219,BASE=`http://127.0.0.1:${PORT}`;
const server=spawn('npm',['run','start','--','--port',String(PORT)],{stdio:'ignore',env:{...process.env,NEXT_PUBLIC_DEMO_OPEN:'false'}});
const results={viewport_checks:[],mutation_requests:[],anonymous_status:null,checks:[]};
function ok(name){results.checks.push(name);console.log('PASS',name);}
async function waitServer(){const deadline=Date.now()+120000;while(Date.now()<deadline){try{const r=await fetch(BASE+'/knowledge');if(r.status<500)return;}catch{}await new Promise(r=>setTimeout(r,1500));}throw Error('dev server did not start');}
const now=Date.now(),H=3600*1000;
const digestFixture={windowDays:7,windowStart:new Date(now-7*24*H).toISOString(),generatedAt:new Date(now).toISOString(),rowsConsidered:12,unansweredInWindow:5,groups:[
 {key:'what is the fictional refund window?',question:'What is the fictional refund window?',count:3,latestAt:new Date(now-H).toISOString(),negative:1},
 {key:'do you support fictional plan upgrades?',question:'Do you support fictional plan upgrades?',count:2,latestAt:new Date(now-2*H).toISOString(),negative:0}],omittedGroups:0,excludedInvalid:0};
function analyticsBody(digest){return JSON.stringify({interactions:[],digest,truncated:false,coverage:'Most recent up to1000 recorded demo questions only; not all-time totals.'});}
async function newPage(browser,viewport,analyticsHandler){
 const page=await browser.newPage({viewport});
 page.on('request',req=>{if(req.url().includes('/api/')&&req.method()!=='GET')results.mutation_requests.push(req.method()+' '+req.url());});
 await page.route('**/api/knowledge',r=>r.fulfill({status:200,contentType:'application/json',body:JSON.stringify({documents:[],usage:{pageUnits:0},attempts:[]})}));
 await page.route('**/api/knowledge/analytics',r=>analyticsHandler(r));
 await page.goto(BASE+'/knowledge');await page.waitForLoadState('networkidle');
 return page;}
try{
 await waitServer();
 const browser=await chromium.launch();
 try{
  // desktop: load, counts, draft handoff, overflow
  let page=await newPage(browser,{width:1280,height:800},r=>r.fulfill({status:200,contentType:'application/json',body:analyticsBody(digestFixture)}));
  const section=page.locator('section',{hasText:'Questions the demo could not answer'});
  await section.getByRole('button',{name:'Load digest'}).click();
  await assertText(section,'Asked 3 times');
  await assertText(section,'1 negative feedback');
  await assertText(section,'12 recorded questions in window');
  await section.getByRole('button',{name:'Prepare Q&A'}).first().click();
  const qa=page.locator('section',{hasText:'Custom Q&A'});
  assert.equal(await qa.getByRole('textbox').first().inputValue(),'What is the fictional refund window?');
  assert.equal(await page.locator('label',{hasText:'Approved answer'}).locator('textarea').inputValue(),'');
  assert.equal(await page.locator('label',{hasText:'I allow this text to be sent to Gemini'}).locator('input').isChecked(),false);
  assert.equal(await page.locator('label',{hasText:'Publish this text to anyone'}).locator('input').isChecked(),false);
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=1280),'desktop horizontal overflow');
  await page.screenshot({path:'/downloads/automatepal-digest-desktop.png',fullPage:true});
  ok('desktop load, counts, draft handoff (question only), consent/publish cleared, no overflow');
  // failed refresh clears stale numbers
  await page.unroute('**/api/knowledge/analytics');
  await page.route('**/api/knowledge/analytics',r=>r.fulfill({status:503,contentType:'application/json',body:JSON.stringify({error:'Analytics unavailable.'})}));
  await section.getByRole('button',{name:'Refresh digest'}).click();
  await assertText(section,'Could not load the digest');
  assert.equal(await section.getByText('Asked 3 times').count(),0,'stale counts still visible after failed refresh');
  ok('failed refresh shows error and clears stale counts');
  await page.close();
  // empty state
  page=await newPage(browser,{width:1280,height:800},r=>r.fulfill({status:200,contentType:'application/json',body:analyticsBody({...digestFixture,rowsConsidered:4,unansweredInWindow:0,groups:[],omittedGroups:0})}));
  const emptySection=page.locator('section',{hasText:'Questions the demo could not answer'});
  await emptySection.getByRole('button',{name:'Load digest'}).click();
  await assertText(emptySection,'No unanswered demo questions in this window.');
  ok('empty state');
  await page.close();
  // mobile viewport
  page=await newPage(browser,{width:390,height:844},r=>r.fulfill({status:200,contentType:'application/json',body:analyticsBody(digestFixture)}));
  const mSection=page.locator('section',{hasText:'Questions the demo could not answer'});
  await mSection.getByRole('button',{name:'Load digest'}).click();
  await assertText(mSection,'Asked 3 times');
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=390),'mobile horizontal overflow');
  await page.screenshot({path:'/downloads/automatepal-digest-mobile.png',fullPage:true});
  ok('mobile load and no overflow');
  await page.close();
 }finally{await browser.close();}
 // real anonymous request (no interception)
 const ctx=await pwrequest.newContext();
 const anon=await ctx.get(BASE+'/api/knowledge/analytics');
 results.anonymous_status=anon.status();
 assert.equal(anon.status(),401);
 await ctx.dispose();
 ok('real anonymous analytics request returns 401');
 assert.equal(results.mutation_requests.length,0,'unexpected mutation requests: '+results.mutation_requests.join(', '));
 ok('zero mutation requests during UI flows');
}catch(e){console.error('FAIL',e);process.exitCode=1;}
finally{server.kill();}
const{default:fs}=await import('node:fs');
fs.writeFileSync('/downloads/automatepal-digest-tests.json',JSON.stringify({run_at:new Date().toISOString(),...results},null,2));
async function assertText(section,text){await section.getByText(text,{exact:false}).first().waitFor({state:'visible',timeout:15000});}
