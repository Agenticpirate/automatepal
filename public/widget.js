/* AutomatePal fictional support preview. Original code, MIT. */
(async()=>{
 const script=document.currentScript,token=script?.getAttribute('data-demo-token');if(!script||!token||!/^[a-f0-9]{64}$/.test(token)||document.getElementById('automatepal-billing-widget'))return;
 const base=new URL(script.src).origin,key='automatepal-demo-'+token;let settings;
 /* Public JS API (window.AutomatePal): open, close, toggle, reset, on, off. Defined before the settings load so
    a page can call it at once; calls made before the widget is ready apply when it mounts, and do nothing if
    the widget is not shown on this page. Event payloads carry the event type and a fixed label only: never
    message text, names, emails, order details or the demo token. */
 const EVENTS=['open','close','message_sent','handoff_requested','lead_submitted'],listeners={};EVENTS.forEach(n=>listeners[n]=new Set());
 const pick={open:{trigger:['api','button','auto']},close:{trigger:['api','button','reset']},message_sent:{channel:['ai','person','request']},handoff_requested:{withinHours:[true,false]},lead_submitted:{}};
 function emit(type,detail){if(!EVENTS.includes(type))return;const payload={type};for(const[k,allowed]of Object.entries(pick[type]))if(detail&&allowed.includes(detail[k]))payload[k]=detail[k];Object.freeze(payload);
  for(const fn of[...listeners[type]]){try{fn(payload)}catch{}}try{window.dispatchEvent(new CustomEvent('automatepal:'+type,{detail:payload}))}catch{}}
 let ready=null;const queued=[];const call=(name,arg)=>ready?ready[name](arg):queued.push([name,arg]);
 const api={open:()=>call('open'),close:()=>call('close'),toggle:()=>call('toggle'),reset:()=>call('reset'),
  on:(type,fn)=>{if(!EVENTS.includes(type)||typeof fn!=='function')return()=>{};listeners[type].add(fn);return()=>listeners[type].delete(fn);},
  off:(type,fn)=>{if(EVENTS.includes(type))listeners[type].delete(fn);},events:Object.freeze([...EVENTS])};
 try{Object.defineProperty(window,'AutomatePal',{value:Object.freeze(api),configurable:true});}catch{}
 try{const r=await fetch(base+'/api/widget?token='+encodeURIComponent(token)+'&path='+encodeURIComponent(location.pathname),{credentials:'omit',referrerPolicy:'no-referrer'});if(!r.ok)return;settings=(await r.json()).settings;if(!settings)return;}catch{return;}
 // Page rules are display controls, not authentication for demo token holders.
 if((settings.excludedPaths||[]).some(p=>location.pathname===p||location.pathname.startsWith(p.endsWith('/')?p:p+'/')))return;
 const side=settings.side==='left'?'left':'right',label=settings.label||'Site help';
 const host=document.createElement('div');host.id='automatepal-billing-widget';const root=host.attachShadow({mode:'open'});
 const button=document.createElement('button');button.textContent=label+' · demo';button.setAttribute('aria-expanded','false');button.setAttribute('aria-controls','automatepal-panel');
 const color=/^#[a-fA-F0-9]{6}$/.test(settings.color)?settings.color:'#233de8',rgb=[1,3,5].map(i=>parseInt(color.slice(i,i+2),16)/255).map(n=>n<=0.04045?n/12.92:((n+0.055)/1.055)**2.4),fg=rgb[0]*.2126+rgb[1]*.7152+rgb[2]*.0722>.179?'#111':'#fff';
 Object.assign(button.style,{position:'fixed',bottom:'20px',[side]:'20px',zIndex:'2147483000',border:'0',borderRadius:'12px',background:color,color:fg,padding:'15px 20px',font:'14px system-ui',cursor:'pointer',boxShadow:'0 8px 30px #0003'});
 const frame=document.createElement('iframe');frame.id='automatepal-panel';frame.title='AutomatePal fictional site support';frame.referrerPolicy='no-referrer';frame.setAttribute('sandbox','allow-scripts allow-same-origin allow-forms');Object.assign(frame.style,{position:'fixed',bottom:'80px',[side]:'20px',width:'min(380px, calc(100vw - 40px))',height:'min(680px, calc(100vh - 110px))',zIndex:'2147483000',border:'1px solid #e1e4ed',borderRadius:'16px',background:'#fff',display:'none',boxShadow:'0 12px 50px #0002'});
 // The panel reports chat events to this page only (targetOrigin is this page's origin); payloads are re-built
 // from the allow-list above, so nothing else the frame sends is passed on.
 let loaded=false;const isOpen=()=>frame.style.display!=='none';
 function toggle(open,trigger){const was=isOpen();if(open&&!loaded){frame.src=base+'/help?token='+encodeURIComponent(token)+'&embed='+encodeURIComponent(location.origin);loaded=true;}frame.style.display=open?'block':'none';button.setAttribute('aria-expanded',String(open));button.textContent=open?'Close '+label:label+' · demo';try{sessionStorage.setItem(key,open?'open':'closed')}catch{}if(trigger&&open!==was)emit(open?'open':'close',{trigger});}
 window.addEventListener('message',e=>{if(!loaded||e.source!==frame.contentWindow||e.origin!==base)return;const d=e.data;if(!d||typeof d!=='object'||d.source!=='automatepal-help'||!['message_sent','handoff_requested','lead_submitted'].includes(d.event))return;emit(d.event,d);});
 button.onclick=()=>toggle(!isOpen(),'button');root.append(frame,button);document.body.append(host);let open=!!settings.autoOpen,restored=false;try{const saved=sessionStorage.getItem(key);if(saved!==null){open=saved==='open';restored=true;}}catch{}toggle(open,open&&!restored?'auto':null);
 ready={open:()=>toggle(true,'api'),close:()=>toggle(false,'api'),toggle:()=>toggle(!isOpen(),'api'),
  // Reset: close the panel, forget the open state and start a fresh panel on the next open. Questions already
  // sent stay recorded for the owner; the one-hour demo link is unchanged.
  reset:()=>{toggle(false,'reset');frame.src='about:blank';loaded=false;try{sessionStorage.removeItem(key)}catch{}}};
 for(const[name]of queued.splice(0))ready[name]();
})();
