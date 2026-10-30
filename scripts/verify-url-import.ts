import assert from'node:assert/strict';
import{robotsAllowed,htmlToText,pageTitle,importUrlProblem,resolvedAddrsProblem}from'../lib/url-import';
function ok(n:string){console.log('PASS',n);}
// robots
assert.equal(robotsAllowed('User-agent: *\nDisallow: /private','/private/page'),false);
assert.equal(robotsAllowed('User-agent: *\nDisallow: /private','/public/page'),true);
assert.equal(robotsAllowed('User-agent: *\nDisallow: /p\nAllow: /public','/public'),true);
assert.equal(robotsAllowed('User-agent: googlebot\nDisallow: /','/anything'),true);
assert.equal(robotsAllowed('User-agent: *\nDisallow:','/anything'),true);
assert.equal(robotsAllowed('','/anything'),true);
assert.equal(robotsAllowed('User-agent: automatepal\nDisallow: /faq','/faq'),false);
ok('robots.txt: disallow, allow precedence, agent scoping, empty rules');
// html to text
const{txtHtml}= {txtHtml:'<html><head><title> FAQ &amp; Help </title><style>body{color:red}</style></head><body><script>alert(1)</script><h1>Returns</h1><p>Send it back within 14 days.</p><br><p>No questions asked &lt;guaranteed&gt;.</p></body></html>'};
const r=htmlToText(txtHtml);
assert.ok(!r.text.includes('alert')&&!r.text.includes('color:red'),'scripts/styles stripped');
assert.ok(r.text.includes('Returns')&&r.text.includes('Send it back within 14 days.'));
assert.ok(r.text.includes('No questions asked <guaranteed>.'));
assert.equal(r.truncated,false);
const big=htmlToText('<p>'+'x'.repeat(40000)+'</p>');
assert.equal(big.truncated,true);
assert.equal([...big.text].length,30000);
assert.equal(pageTitle(txtHtml),'FAQ & Help');
assert.equal(pageTitle('<p>no title</p>'),'');
ok('htmlToText: strips scripts/styles, decodes entities, caps at 30000 chars, title extraction');
// URL validation
assert.equal(importUrlProblem('not a url'),'Enter a full https:// URL.');
assert.equal(importUrlProblem('ftp://example.com/x'),'Only http and https URLs can be imported.');
assert.equal(importUrlProblem('https://user:pass@example.com/x'),'URLs with credentials cannot be imported.');
assert.equal(importUrlProblem('http://192.168.1.5/x'),'Private or local addresses cannot be imported.');
assert.equal(importUrlProblem('http://localhost:3000/x'),'Private or local addresses cannot be imported.');
assert.equal(importUrlProblem('https://app.internal/x'),'Private or local addresses cannot be imported.');
assert.equal(importUrlProblem('https://example.com/faq'),null);
ok('URL validation: scheme, credentials, private hosts refused');
// DNS results
assert.equal(resolvedAddrsProblem([]),'That address did not resolve.');
assert.equal(resolvedAddrsProblem([{address:'10.0.0.4',family:4}]),'That address resolves to a private network and cannot be imported.');
assert.equal(resolvedAddrsProblem([{address:'fd00::1',family:6}]),'That address resolves to a private network and cannot be imported.');
assert.equal(resolvedAddrsProblem([{address:'93.184.216.34',family:4},{address:'192.168.0.1',family:4}]),'That address resolves to a private network and cannot be imported.');
assert.equal(resolvedAddrsProblem([{address:'93.184.216.34',family:4}]),null);
ok('DNS validation: any private answer refuses, public passes');
console.log('all url-import checks passed');
