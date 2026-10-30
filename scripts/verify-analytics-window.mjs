import assert from'node:assert/strict';
import{spawn}from'node:child_process';
import{chromium}from'@playwright/test';
const PORT=3256,BASE=`http://127.0.0.1:${PORT}`;
const server=spawn('npm',['run','start','--','--port',String(PORT)],{stdio:'ignore',env:{...process.env,NEXT_PUBLIC_DEMO_OPEN:'false'}});
function ok(n){console.log('PASS',n);}
async function waitServer(){const dl=Date.now()+60000;while(Date.now()<dl){try{const r=await fetch(BASE+'/owner');if(r.status<500)return;}catch{}await new Promise(r=>setTimeout(r,1000));}throw Error('no server');}
const now=Date.now(),iso=(ms)=>new Date(now-ms).toISOString();
const queries=[
 {id:'q1',case_id:'c1',created_at:iso(86400000),question:'Recent answered?',supported:true,feedback:1},
 {id:'q2',case_id:'c1',created_at:iso(2*86400000),question:'Recent unanswered?',supported:false,feedback:null},
 {id:'q3',case_id:'c2',created_at:iso(15*86400000),question:'Old answered from two weeks back?',supported:true,feedback:-1},
 {id:'q4',case_id:'c2',created_at:iso(25*86400000),question:'Very old unanswered question?',supported:false,feedback:null},
 {id:'q5',case_id:'c3',created_at:iso(45*86400000),question:'Outside the 30 day window?',supported:false,feedback:null}];
const overview={tickets:[],truncated:{},usage:{utcDay:'',answersToday:1,dailyLimit:100,sources:1,sourceLimit:30,pageUnits:1,pageLimit:360},asOf:new Date(now).toISOString(),requests:[],coverage:'',queries};
try{
 await waitServer();
 const b=await chromium.launch();
 try{
 for(const[name,vp]of[['desktop',{width:1280,height:800}],['mobile',{width:390,height:844}]]){
  const p=await b.newPage({viewport:vp});
  await p.route('**/api/**',r=>{const u=r.request().url();let body={};
   if(u.includes('/api/owner-overview'))body=overview;
   else if(u.includes('/api/owner-alerts'))body={preferences:{channel:'telegram',minimum_priority:'high',quiet_start:22,quiet_end:7,timezone:'Asia/Kolkata',digest:true,reasons:[]},log:[],eligible_now:[],eligible_count:0,coverage:''};
   r.fulfill({status:200,contentType:'application/json',body:JSON.stringify(body)});});
  await p.goto(BASE+'/owner');await p.waitForLoadState('networkidle');
  await p.getByText('Last 7 days (from the loaded snapshot):').waitFor({state:'visible',timeout:15000});
  let strip=await p.locator('div',{hasText:'Last 7 days'}).first().textContent();
  assert.ok(strip.includes('1 answered')&&strip.includes('1 unanswered'),strip);
  assert.equal((await p.locator('section',{hasText:'Question trend'}).locator('ol li').allInnerTexts()).length,7,'7 trend rows by default');
  await p.getByRole('button',{name:'30 days'}).click();
  await p.getByText('Last 30 days (from the loaded snapshot):').waitFor({state:'visible'});
  strip=await p.locator('div',{hasText:'Last 30 days'}).first().textContent();
  assert.ok(strip.includes('2 answered')&&strip.includes('2 unanswered'),strip);
  assert.ok(strip.includes('50% answered'),strip);
  assert.ok(strip.includes('50% of 2 ratings helpful'),strip);
  assert.equal((await p.locator('section',{hasText:'Question trend'}).locator('ol li').allInnerTexts()).length,30,'30 trend rows after toggle');
  ok(name+' owner analytics: 7-day default, 30-day toggle recomputes strip and trend');
  await p.screenshot({path:'/downloads/automatepal-analytics-30d-'+name+'.png',fullPage:true});
  await p.close();
 }
 }finally{await b.close();}
 console.log('all analytics-window checks passed');
}finally{server.kill();}
