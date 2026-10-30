// Install verification helpers. Pure functions, unit-tested without network.
export function privateIpV4(ip:string):boolean{
  const p=ip.split('.').map(Number);
  if(p.length!==4||p.some(n=>!Number.isInteger(n)||n<0||n>255))return true;
  const[a,b]=p;
  if(a===0||a===10||a===127)return true;
  if(a===100&&b>=64&&b<=127)return true;
  if(a===169&&b===254)return true;
  if(a===172&&b>=16&&b<=31)return true;
  if(a===192&&(b===0||b===168))return true;
  if(a===198&&(b===18||b===19))return true;
  if(a>=224)return true;
  return false;
}
export function privateIpV6(ip:string):boolean{
  const s=ip.toLowerCase();
  if(s==='::1'||s==='::')return true;
  if(/^f[cd]/.test(s))return true;          // unique local fc00::/7
  if(/^fe[89ab]/.test(s))return true;       // link-local fe80::/10
  if(s.includes('.')){const v4=s.split(':').pop()??'';return privateIpV4(v4);} // v4-mapped
  return false;
}
export function privateHost(host:string):boolean{
  const h=host.toLowerCase().replace(/\.$/,'');
  if(!h||h==='localhost'||h.endsWith('.localhost')||h.endsWith('.local')||h.endsWith('.internal')||h.endsWith('.home'))return true;
  if(/^\d+\.\d+\.\d+\.\d+$/.test(h))return privateIpV4(h);
  if(h.includes(':'))return privateIpV6(h.replace(/[[\]]/g,''));
  return false;
}
export type InstallHit={found:boolean;scriptSrc:string|null;tokenFound:string|null;tokenMatches:boolean|null};
export function detectWidgetScript(html:string,expectedToken?:string):InstallHit{
  const re=/<script\b[^>]*>/gi;
  let m:RegExpExecArray|null;
  while((m=re.exec(html))){
    const tag=m[0];
    const src=/\bsrc\s*=\s*["']([^"']*\/widget\.js[^"']*)["']/i.exec(tag)?.[1];
    if(!src)continue;
    const token=/\bdata-demo-token\s*=\s*["']([^"']+)["']/i.exec(tag)?.[1]??null;
    return{found:true,scriptSrc:src.slice(0,300),tokenFound:token,tokenMatches:expectedToken?token===expectedToken:null};
  }
  return{found:false,scriptSrc:null,tokenFound:null,tokenMatches:null};
}
