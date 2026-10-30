import assert from'node:assert/strict';
import{privateIpV4,privateIpV6,privateHost,detectWidgetScript}from'../lib/install-check';
function ok(n:string){console.log('PASS',n);}
// privateIpV4
for(const[ip,want]of[['10.0.0.1',true],['127.0.0.1',true],['192.168.1.1',true],['172.16.0.1',true],['172.31.255.255',true],['172.15.0.1',false],['172.32.0.1',false],['8.8.8.8',false],['100.64.0.1',true],['100.63.0.1',false],['169.254.1.1',true],['0.0.0.0',true],['224.0.0.1',true],['192.0.0.1',true],['abc',true],['1.2.3',true],['999.1.1.1',true]] as [string,boolean][])assert.equal(privateIpV4(ip),want,'v4 '+ip);
ok('privateIpV4 ranges and garbage');
// privateIpV6
for(const[ip,want]of[['::1',true],['::',true],['fd00::1',true],['fc12::1',true],['fe80::1',true],['fe90::1',true],['2606:4700::1111',false],['::ffff:10.0.0.1',true],['::ffff:8.8.8.8',false]] as [string,boolean][])assert.equal(privateIpV6(ip),want,'v6 '+ip);
ok('privateIpV6 loopback, ULA, link-local, v4-mapped');
// privateHost
for(const[h,want]of[['localhost',true],['foo.localhost',true],['printer.local',true],['nas.internal',true],['10.0.0.5',true],['[::1]',true],['example.com',false],['8.8.8.8',false],['sub.example.co.uk',false]] as [string,boolean][])assert.equal(privateHost(h),want,'host '+h);
ok('privateHost literals and names');
// detectWidgetScript
const tag='<script src="https://app.example/widget.js" data-demo-token="tok123" defer></script>';
let r=detectWidgetScript('<html><body>'+tag+'</body></html>','tok123');
assert.deepEqual([r.found,r.tokenFound,r.tokenMatches],[true,'tok123',true]);
r=detectWidgetScript(tag,'other');
assert.deepEqual([r.found,r.tokenMatches],[true,false]);
r=detectWidgetScript(tag);
assert.equal(r.tokenMatches,null);
r=detectWidgetScript('<html><body><script src="https://cdn.example/app.js"></script></body></html>','tok123');
assert.equal(r.found,false);
r=detectWidgetScript('<script src="/widget.js?v=2" defer></script>','tok123');
assert.deepEqual([r.found,r.tokenFound,r.tokenMatches],[true,null,false]);
r=detectWidgetScript('<script src="/other.js"></script>'+tag,'tok123');
assert.equal(r.tokenMatches,true,'first widget.js tag wins');
r=detectWidgetScript("<script data-demo-token='tok123' src='/widget.js'></script>",'tok123');
assert.equal(r.tokenMatches,true,'attribute order independent');
ok('detectWidgetScript found/mismatch/missing/order cases');
console.log('verify-install-check: all unit tests passed');
