import assert from 'node:assert/strict';
import {allowRequest} from '../lib/rate-limit';
import {authenticate} from '../lib/session';
import {NextRequest} from 'next/server';
async function main(){const t=1000;for(let i=0;i<6;i++)assert.equal(allowRequest('fixture',t),true);assert.equal(allowRequest('fixture',t),false);assert.equal(allowRequest('fixture',t+60000),true);assert.equal(allowRequest('x'.repeat(257),t),false);
for(let i=0;i<5100;i++)allowRequest('identity'+i,t);assert.equal(allowRequest('overflow',t),false);assert.equal(allowRequest('after-expiry',t+60000),true);
const old=global.fetch,env={url:process.env.NEXT_PUBLIC_SUPABASE_URL,key:process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY};process.env.NEXT_PUBLIC_SUPABASE_URL='https://example.invalid';process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY='fictional';global.fetch=async()=>{throw Error('Injected auth outage')};try{assert.equal(await authenticate(new NextRequest('https://example.invalid',{headers:{authorization:'Bearer fictional'}})),null);}finally{global.fetch=old;if(env.url===undefined)delete process.env.NEXT_PUBLIC_SUPABASE_URL;else process.env.NEXT_PUBLIC_SUPABASE_URL=env.url;if(env.key===undefined)delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;else process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY=env.key;}
console.log('PASS: 6/min window, expiry, max identities fail closed, oversized key denial, auth outage fails closed.');}
main().catch(e=>{console.error(e.message);process.exitCode=1});
