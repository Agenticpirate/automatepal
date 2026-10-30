import assert from'node:assert/strict';
import{cosine,rankChunks,parseVector,OwnerChunk}from'../lib/owner-retrieval';
function vec(n:number,hot:number){const v=Array(n).fill(0);v[hot]=1;return v;}
function chunk(id:string,embedding:number[]):OwnerChunk{return{id,documentId:'d-'+id,title:'T'+id,excerpt:'excerpt '+id,embedding};}
// cosine basics
assert.equal(cosine([1,0],[1,0]),1);
assert.equal(cosine([1,0],[0,1]),0);
assert.equal(cosine([1,0],[1]),-1);
assert.equal(cosine([],[]),-1);
assert.equal(cosine([NaN,0],[1,0]),-1);
assert.equal(cosine([0,0],[1,0]),-1);
// ranking: threshold, order, limit
const q=vec(768,0);
const chunks=[
 chunk('a',vec(768,0)),                    // score 1
 chunk('b',vec(768,1)),                    // score 0
 chunk('c',vec(768,0).map((x,i)=>i===0?0.8:i===1?0.6:0)), // 0.8
 chunk('d',vec(768,0).map((x,i)=>i===0?0.9:i===2?Math.sqrt(0.19):0)), // 0.9
 chunk('e',vec(768,0).map((x,i)=>i===0?0.75:i===3?Math.sqrt(1-0.5625):0)), // 0.75
 chunk('f',vec(768,0).map((x,i)=>i===0?0.73:i===4?Math.sqrt(1-0.5329):0)), // 0.73
 chunk('g',vec(768,0).map((x,i)=>i===0?0.72:i===5?Math.sqrt(1-0.5184):0)), // 0.72 boundary included
 chunk('h',vec(768,0).map((x,i)=>i===0?0.71:i===6?Math.sqrt(1-0.5041):0)), // below, excluded
];
const ranked=rankChunks(chunks,q);
assert.deepEqual(ranked.map(r=>r.id),['a','d','c','e']);
assert.equal(ranked.length,4);
assert.ok(!('embedding' in ranked[0]));
// boundary: exactly 0.72 included when fewer than limit
const two=rankChunks([chunks[6],chunks[7]],q);
assert.deepEqual(two.map(r=>r.id),['g']);
// empty
assert.deepEqual(rankChunks([],q),[]);
// parseVector
assert.deepEqual(parseVector('[1,0.5,-2]'),[1,0.5,-2]);
assert.equal(parseVector('not json'),null);
assert.equal(parseVector('[1,"x"]'),null);
assert.equal(parseVector(42),null);
console.log('PASS owner playground retrieval: cosine, threshold 0.72, top-4 order, boundary, parseVector');
