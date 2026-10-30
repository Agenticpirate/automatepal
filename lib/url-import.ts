// Public-URL import helpers. Pure functions, unit-tested without network.
import {privateHost,privateIpV4,privateIpV6} from './install-check';

export function robotsAllowed(robots:string,path:string):boolean{
 // Minimal robots.txt: honors Disallow lines in User-agent: * and User-agent: automatepal groups. Longest-match prefix wins; allow beats disallow at equal length.
 const groups=robots.split(/\n\s*\n/).map(g=>g.split('\n').map(l=>l.trim()));
 let best:{len:number;allow:boolean}|null=null;
 for(const lines of groups){
  const agents=lines.filter(l=>/^user-agent:/i.test(l)).map(l=>l.slice(12).trim().toLowerCase());
  if(!agents.length||!agents.some(a=>a==='*'||a==='automatepal'))continue;
  for(const l of lines){
   const m=/^(dis)?allow:\s*(\S*)$/i.exec(l);
   if(!m||!m[2])continue;
   const rule=m[2];
   if(path.startsWith(rule)&&(!best||rule.length>best.len||(rule.length===best.len&&!m[1])))best={len:rule.length,allow:!m[1]};
  }
 }
 return best?best.allow:true;
}
export function htmlToText(html:string,max=30000):{text:string;truncated:boolean}{
 let s=html.replace(/<script[\s\S]*?<\/script>/gi,' ').replace(/<style[\s\S]*?<\/style>/gi,' ').replace(/<noscript[\s\S]*?<\/noscript>/gi,' ').replace(/<!--[\s\S]*?-->/g,' ');
 s=s.replace(/<\/(p|div|li|h[1-6]|tr|section|article|br|ul|ol|table)>/gi,'\n').replace(/<[^>]+>/g,' ');
 s=s.replace(/&nbsp;/gi,' ').replace(/&amp;/gi,'&').replace(/&lt;/gi,'<').replace(/&gt;/gi,'>').replace(/&quot;/gi,'"').replace(/&#39;|&apos;/gi,"'");
 s=s.split('\n').map(l=>l.replace(/\s+/g,' ').trim()).filter(Boolean).join('\n');
 const chars=[...s];
 return {text:chars.slice(0,max).join(''),truncated:chars.length>max};
}
export function pageTitle(html:string):string{
 const m=/<title[^>]*>([\s\S]*?)<\/title>/i.exec(html);
 return (m?htmlToText(m[1],120).text:'').slice(0,120);
}
export function importUrlProblem(raw:string):string|null{
 let u:URL;
 try{u=new URL(raw);}catch{return 'Enter a full https:// URL.';}
 if(u.protocol!=='https:'&&u.protocol!=='http:')return 'Only http and https URLs can be imported.';
 if(u.username||u.password)return 'URLs with credentials cannot be imported.';
 if(privateHost(u.hostname))return 'Private or local addresses cannot be imported.';
 return null;
}
export function resolvedAddrsProblem(addrs:{address:string;family:number}[]):string|null{
 if(!addrs.length)return 'That address did not resolve.';
 for(const a of addrs){if(a.family===6?privateIpV6(a.address):privateIpV4(a.address))return 'That address resolves to a private network and cannot be imported.';}
 return null;
}
