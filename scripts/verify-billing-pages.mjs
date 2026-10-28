import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {chromium} from '@playwright/test';
const server=spawn(process.execPath,['node_modules/next/dist/bin/next','start','-p','3107'],{stdio:'ignore'});
const b=await chromium.launch();
try {
 const p=await b.newPage({viewport:{width:390,height:844}});
 for(let n=0;n<40;n++){try{await p.goto('http://localhost:3107/help');break;}catch{await new Promise(r=>setTimeout(r,250));}}
 const item={order:'Fictional Launch Kit order',amount:19,currency:'USD',status:'Sandbox fixture',branding:{label:'Site help',initials:'AP',prompts:[]},controls:{},billing:{mode:'fictional',reference:'DEMO-11111111',title:'Fictional Launch Kit order',totalMinor:1900,currency:'USD',paymentStatus:'Not connected',refundStatus:'Review only',invoiceStatus:'Not issued',taxStatus:'Not calculated'}};
 await p.route('**/api/support?*',r=>r.fulfill({contentType:'application/json',body:JSON.stringify({case:item})}));
 await p.goto('http://localhost:3107/help?token='+ 'a'.repeat(64));
 await p.getByRole('region',{name:'Fictional billing overview'}).waitFor();
 assert.equal(await p.locator('body').evaluate(e=>e.scrollWidth<=innerWidth),true);
 assert.equal(await p.getByText('USD 19.00',{exact:true}).count(),1);
 await p.screenshot({path:'/downloads/billing-overview-mobile.png',fullPage:true});
 await p.setViewportSize({width:1280,height:900});await p.screenshot({path:'/downloads/billing-overview-desktop.png',fullPage:true});
 item.controls.hideOrder=true;await p.goto('http://localhost:3107/help?token='+ 'a'.repeat(64));await p.getByText('Ask a question',{exact:true}).waitFor();assert.equal(await p.getByRole('region',{name:'Fictional billing overview'}).count(),0);
 item.controls.hideOrder=false;item.billing=null;await p.goto('http://localhost:3107/help?token='+ 'a'.repeat(64));await p.getByText('Ask a question',{exact:true}).waitFor();assert.equal(await p.getByRole('region',{name:'Fictional billing overview'}).count(),0);
 console.log('PASS: mobile overflow, fixture labels, hidden order control, invalid fixture omitted');
} finally {await b.close();server.kill('SIGTERM');await new Promise(r=>server.once('exit',r));}
