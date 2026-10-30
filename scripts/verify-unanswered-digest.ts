import assert from'node:assert/strict';
import{buildUnansweredDigest,normalizeQuestion,DIGEST_MAX_GROUPS,DigestInteraction}from'../lib/unanswered-digest';
const now=new Date('2026-10-30T12:00:00.000Z');
const iso=(ms:number)=>new Date(ms).toISOString();
const H=3600*1000,D=24*H;
function row(p:Partial<DigestInteraction>):DigestInteraction{return{id:Math.random().toString(36).slice(2),created_at:iso(now.getTime()-H),question:'q',supported:false,feedback:null,...p};}

// normalization
assert.equal(normalizeQuestion('  What  Is\nThe\tPolicy? '),'what is the policy?');

// empty input
const empty=buildUnansweredDigest([],now);
assert.equal(empty.unansweredInWindow,0);assert.equal(empty.groups.length,0);assert.equal(empty.omittedGroups,0);assert.equal(empty.rowsConsidered,0);

// grouping across case/whitespace variants, count, latest, display from latest
const g=buildUnansweredDigest([
 row({question:'What is the refund policy?',created_at:iso(now.getTime()-3*H)}),
 row({question:'what  is the refund policy?',created_at:iso(now.getTime()-2*H),feedback:-1}),
 row({question:'WHAT IS THE REFUND POLICY?',created_at:iso(now.getTime()-1*H)}),
 row({question:'Different question',created_at:iso(now.getTime()-5*H)}),
 row({question:'Supported row',supported:true,created_at:iso(now.getTime()-1*H)}),
],now);
assert.equal(g.unansweredInWindow,4);
assert.equal(g.groups.length,2);
const top=g.groups[0];
assert.equal(top.count,3);assert.equal(top.negative,1);
assert.equal(top.latestAt,iso(now.getTime()-1*H));
assert.equal(top.question,'WHAT IS THE REFUND POLICY?');
assert.equal(g.rowsConsidered,5);

// window boundary: exactly 7 days ago included, older excluded
const b=buildUnansweredDigest([
 row({created_at:iso(now.getTime()-7*D)}),
 row({created_at:iso(now.getTime()-7*D-1)}),
 row({created_at:iso(now.getTime()-8*D)}),
],now);
assert.equal(b.unansweredInWindow,1);assert.equal(b.rowsConsidered,1);

// invalid and future timestamps excluded
const iv=buildUnansweredDigest([
 row({created_at:'not-a-date'}),
 row({created_at:iso(now.getTime()+H)}),
 row({created_at:''}),
 row({created_at:iso(now.getTime()-H)}),
],now);
assert.equal(iv.excludedInvalid,3);assert.equal(iv.unansweredInWindow,1);

// top-30 cap and omitted count
const many:DigestInteraction[]=[];
for(let i=0;i<35;i++)many.push(row({question:'Unique question number '+i,created_at:iso(now.getTime()-i*1000)}));
const capped=buildUnansweredDigest(many,now);
assert.equal(capped.groups.length,DIGEST_MAX_GROUPS);
assert.equal(capped.omittedGroups,5);
assert.equal(capped.unansweredInWindow,35);

// ordering: count desc, then latest desc
const ord=buildUnansweredDigest([
 row({question:'aaa',created_at:iso(now.getTime()-1*H)}),
 row({question:'bbb',created_at:iso(now.getTime()-2*H)}),
 row({question:'bbb',created_at:iso(now.getTime()-3*H)}),
 row({question:'ccc',created_at:iso(now.getTime()-10*H)}),
 row({question:'ccc',created_at:iso(now.getTime()-9*H)}),
],now);
assert.deepEqual(ord.groups.map(x=>x.key),['bbb','ccc','aaa']);

console.log('PASS unanswered digest unit tests');
