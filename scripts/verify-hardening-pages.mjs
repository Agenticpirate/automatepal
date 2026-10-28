import assert from 'node:assert/strict';import {spawn} from 'node:child_process';import {chromium} from '@playwright/test';
const s=spawn(process.execPath,['node_modules/next/dist/bin/next','start','-p','3108'],{stdio:'ignore'}),b=await chromium.launch();
try{const p=await b.newPage({viewport:{width:390,height:844}});for(let n=0;n<40;n++){try{await p.goto('http://localhost:3108/integrations');break;}catch{await new Promise(r=>setTimeout(r,250));}}
await p.getByText('Audit and data controls',{exact:true}).waitFor();await p.getByText('Delete my preview application data',{exact:true}).click();assert.equal(await p.getByRole('button',{name:'Permanently delete preview data'}).isDisabled(),true);assert.equal(await p.locator('body').evaluate(e=>e.scrollWidth<=innerWidth),true);await p.getByText('Audit and data controls',{exact:true}).scrollIntoViewIfNeeded();await p.screenshot({path:'/downloads/hardening-data-controls-mobile.png',fullPage:true});
const r=await p.request.get('http://localhost:3108/api/status');for(const h of ['x-content-type-options','content-security-policy','permissions-policy','strict-transport-security','referrer-policy'])assert.ok(r.headers()[h]);
const results=await Promise.all(Array.from({length:10},()=>p.request.get('http://localhost:3108/api/status')));assert.ok(results.every(r=>r.status()===200));
for(const route of ['/api/account-data','/api/knowledge','/api/support','/api/actions','/api/proof'])assert.equal((await p.request.get('http://localhost:3108'+route)).status(),401);
console.log('PASS: mobile data controls, typed destructive confirmation disabled, security headers, 10 local concurrent status reads, 5 unauthenticated route denials.');
}finally{await b.close();s.kill('SIGTERM');await new Promise(r=>s.once('exit',r));}
