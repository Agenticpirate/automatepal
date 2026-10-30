import assert from'node:assert/strict';
import{spawn}from'node:child_process';
const PORT=3253,BASE=`http://127.0.0.1:${PORT}`;
const server=spawn('npm',['run','start','--','--port',String(PORT)],{stdio:'ignore'});
async function waitServer(){const dl=Date.now()+60000;while(Date.now()<dl){try{const r=await fetch(BASE+'/widget.js');if(r.status<500)return;}catch{}await new Promise(r=>setTimeout(r,1000));}throw Error('no server');}
try{
 await waitServer();
 const w=await fetch(BASE+'/widget.js');
 assert.equal(w.headers.get('cache-control'),'public, max-age=300, stale-while-revalidate=600');
 console.log('PASS widget.js short cache with SWR');
 const o=await fetch(BASE+'/owner');
 assert.equal(o.headers.get('cache-control'),'no-store');
 console.log('PASS /owner stays no-store');
 const html=await (await fetch(BASE+'/')).text();
 const chunk=html.match(/src="([^"]*_next[^"]*\.js)"/);
 assert.ok(chunk,'hashed chunk reference');
 const c=await fetch(BASE+chunk[1]);
 assert.ok((c.headers.get('cache-control')||'').includes('immutable'),'chunk immutable');
 console.log('PASS hashed chunks immutable');
 const a=await fetch(BASE+'/api/widget');
 assert.equal(a.headers.get('cache-control'),'no-store');
 console.log('PASS /api/widget stays no-store');
 console.log('all cache-header checks passed');
}finally{server.kill();}
