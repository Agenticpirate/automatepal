/* AutomatePal fictional support preview. Original code, MIT. */
(async()=>{
 const script=document.currentScript,token=script?.getAttribute('data-demo-token');if(!script||!token||!/^[a-f0-9]{64}$/.test(token)||document.getElementById('automatepal-billing-widget'))return;
 const base=new URL(script.src).origin,key='automatepal-demo-'+token;let settings;
 try{const r=await fetch(base+'/api/widget?token='+encodeURIComponent(token)+'&path='+encodeURIComponent(location.pathname),{credentials:'omit',referrerPolicy:'no-referrer'});if(!r.ok)return;settings=(await r.json()).settings;if(!settings)return;}catch{return;}
 // Page rules are display controls, not authentication for demo token holders.
 if((settings.excludedPaths||[]).some(p=>location.pathname===p||location.pathname.startsWith(p.endsWith('/')?p:p+'/')))return;
 const side=settings.side==='left'?'left':'right',label=settings.label||'Site help';
 const host=document.createElement('div');host.id='automatepal-billing-widget';const root=host.attachShadow({mode:'open'});
 const button=document.createElement('button');button.textContent=label+' · demo';button.setAttribute('aria-expanded','false');button.setAttribute('aria-controls','automatepal-panel');
 const color=/^#[a-fA-F0-9]{6}$/.test(settings.color)?settings.color:'#233de8',rgb=[1,3,5].map(i=>parseInt(color.slice(i,i+2),16)/255).map(n=>n<=0.04045?n/12.92:((n+0.055)/1.055)**2.4),fg=rgb[0]*.2126+rgb[1]*.7152+rgb[2]*.0722>.179?'#111':'#fff';
 Object.assign(button.style,{position:'fixed',bottom:'20px',[side]:'20px',zIndex:'2147483000',border:'0',borderRadius:'12px',background:color,color:fg,padding:'15px 20px',font:'14px system-ui',cursor:'pointer',boxShadow:'0 8px 30px #0003'});
 const frame=document.createElement('iframe');frame.id='automatepal-panel';frame.title='AutomatePal fictional site support';frame.referrerPolicy='no-referrer';frame.setAttribute('sandbox','allow-scripts allow-same-origin allow-forms');Object.assign(frame.style,{position:'fixed',bottom:'80px',[side]:'20px',width:'min(380px, calc(100vw - 40px))',height:'min(680px, calc(100vh - 110px))',zIndex:'2147483000',border:'1px solid #e1e4ed',borderRadius:'16px',background:'#fff',display:'none',boxShadow:'0 12px 50px #0002'});
 let loaded=false;function toggle(open){if(open&&!loaded){frame.src=base+'/help?token='+encodeURIComponent(token);loaded=true;}frame.style.display=open?'block':'none';button.setAttribute('aria-expanded',String(open));button.textContent=open?'Close '+label:label+' · demo';try{sessionStorage.setItem(key,open?'open':'closed')}catch{}}
 button.onclick=()=>toggle(frame.style.display==='none');root.append(frame,button);document.body.append(host);let open=!!settings.autoOpen;try{const saved=sessionStorage.getItem(key);if(saved!==null)open=saved==='open';}catch{}toggle(open);
})();
