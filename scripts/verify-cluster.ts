import assert from'node:assert/strict';
import{clusterQuestions,words}from'../lib/cluster';
function ok(n:string){console.log('PASS',n);}
const rows=[
 {question:'Do you ship to Pune?'},
 {question:'Do you deliver to Pune city?'},
 {question:'What is the refund policy?'},
 {question:'How do I get a refund for my order?'},
 {question:'Do you offer student discounts?'}];
const c=clusterQuestions(rows);
assert.equal(c.length,3,'three themes');
assert.equal(c[0].size,2);
assert.ok(c.some(x=>x.sample.includes('Pune')&&x.size===2),'shipping cluster');
assert.ok(c.some(x=>x.sample.includes('refund')&&x.size===2),'refund cluster');
assert.ok(c.some(x=>x.sample.includes('student')&&x.size===1),'singleton');
ok('clusters similar questions, separates themes');
assert.deepEqual([...words('What is the refund policy?')].sort(),['policy','refund'],'stopwords removed');
ok('word normalization removes stopwords and punctuation');
assert.equal(clusterQuestions([]).length,0,'empty input');
assert.equal(clusterQuestions([{question:'??'}]).length,0,'no usable words');
ok('edge cases');
console.log('verify-cluster: all unit tests passed');
