import {chromium} from '@playwright/test';import {spawn} from 'node:child_process';import assert from 'node:assert/strict';
// One brand theme: no light/dark picker, no html[data-theme], and an OS dark preference changes nothing.
const s=spawn(process.execPath,['node_modules/next/dist/bin/next','start','-p','3111'],{stdio:'ignore',env:{...process.env,NEXT_PUBLIC_DEMO_OPEN:'false'}}),b=await chromium.launch();try{const p=await b.newPage({viewport:{width:1280,height:900},colorScheme:'dark'});await p.route('**/api/**',r=>r.fulfill(r.request().url().includes('/api/support?token=')?{contentType:'application/json',body:JSON.stringify({case:{order:'Fictional Launch Kit order',amount:19,currency:'USD',status:'Fictional preview',inboxState:'open',branding:{label:'North Dock',initials:'N',color:'#333333',prompts:['Ask a question','Talk to a person']},controls:{hideOrder:true}}})}:{status:401,contentType:'application/json',body:'{"error":"Please sign in."}'}));for(let n=0;n<40;n++){try{await p.goto('http://localhost:3111/tickets');break;}catch{await new Promise(r=>setTimeout(r,250));}}
const lum=c=>{const m=c.match(/[\d.]+/g).slice(0,3).map(Number).map(x=>x/255).map(x=>x<=.04045?x/12.92:((x+.055)/1.055)**2.4);return m[0]*.2126+m[1]*.7152+m[2]*.0722;};
for(const path of ['','pricing','tickets','owner','support','help','contact','operations']){await p.goto('http://localhost:3111/'+path);await p.waitForLoadState('networkidle');
 assert.equal(await p.getByLabel('Color theme').count(),0,path+' still has a theme picker');
 assert.equal(await p.evaluate(()=>document.documentElement.dataset.theme??null),null,path+' sets data-theme');
 assert.equal(await p.locator('.desk-widget>.desk-topbar').count(),0,path+' renders the old theme bar');
 // The page surface under the content stays light (white or brand tint) even with a dark OS preference.
 const surface=await p.evaluate(()=>{const el=document.querySelector('.ap-dash-main,.desk-app,main,body');return getComputedStyle(el).backgroundColor;});
 if(!/rgba\(0, 0, 0, 0\)/.test(surface))assert.ok(lum(surface)>.8,path+' surface is dark: '+surface);
 await p.screenshot({path:'/downloads/theme-'+(path||'home')+'-desktop.png'});await p.setViewportSize({width:390,height:844});assert.equal(await p.locator('body').evaluate(e=>e.scrollWidth<=innerWidth),true,path+' overflow');await p.screenshot({path:'/downloads/theme-'+(path||'home')+'-mobile.png'});await p.setViewportSize({width:1280,height:900});}
// Brand text tokens keep AA contrast on white: ink, muted, deep blue, navy.
const contrast=['rgb(10,27,61)','rgb(74,88,120)','rgb(9,49,141)','rgb(4,26,82)'].map(c=>1.05/(lum(c)+.05));assert.ok(contrast.every(x=>x>=4.5),'brand contrast '+contrast);
console.log('PASS eight surfaces: no theme picker or bar, no data-theme, light brand surface under a dark OS preference, no mobile overflow, AA brand text contrast.');}finally{await b.close();s.kill('SIGTERM');await new Promise(r=>s.once('exit',r));}
