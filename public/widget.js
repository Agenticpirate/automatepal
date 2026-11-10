/* AutomatePal support widget loader. Original code, MIT.
   Install: <script src="https://automatepal.com/widget.js" data-bot="pk_live_…" async></script>
   Where a tag manager or site builder drops data- attributes, the key can go in the URL instead
   (widget.js?bot=pk_live_…) or in window.AutomatePalConfig={bot:'pk_live_…'} set before the script.
   (data-demo-token="<64 hex>" still loads a one-hour owner demo). */
(async()=>{
 const script=document.currentScript||document.querySelector('script[src*="/widget.js"]');if(!script||!script.src)return;
 const cfg=window.AutomatePalConfig&&typeof window.AutomatePalConfig==='object'?window.AutomatePalConfig:{};
 const demoToken=script.getAttribute('data-demo-token'),botKey=script.getAttribute('data-bot')||new URL(script.src).searchParams.get('bot')||(typeof cfg.bot==='string'?cfg.bot:null);
 const keyMode=!!botKey&&/^pk_(live|test)_[A-Za-z0-9]{24}$/.test(botKey),demoMode=!keyMode&&!!demoToken&&/^[a-f0-9]{64}$/.test(demoToken);
 if((!keyMode&&!demoMode)||document.getElementById('automatepal-billing-widget'))return;
 const base=new URL(script.src).origin,id=keyMode?botKey:demoToken,key='automatepal-demo-'+id,sessionKey='automatepal-session-'+id;let settings;
 /* Public JS API (window.AutomatePal): open, close, toggle, reset, on, off. Defined before the settings load so
    a page can call it at once; calls made before the widget is ready apply when it mounts, and do nothing if
    the widget is not shown on this page. Event payloads carry the event type and a fixed label only: never
    message text, names, emails, order details, the key or a token. */
 const EVENTS=['open','close','message_sent','handoff_requested','lead_submitted'],listeners={};EVENTS.forEach(n=>listeners[n]=new Set());
 const pick={open:{trigger:['api','button','auto','proactive']},close:{trigger:['api','button','reset']},message_sent:{channel:['ai','person','request']},handoff_requested:{withinHours:[true,false]},lead_submitted:{}};
 function emit(type,detail){if(!EVENTS.includes(type))return;const payload={type};for(const[k,allowed]of Object.entries(pick[type]))if(detail&&allowed.includes(detail[k]))payload[k]=detail[k];Object.freeze(payload);
  for(const fn of[...listeners[type]]){try{fn(payload)}catch{}}try{window.dispatchEvent(new CustomEvent('automatepal:'+type,{detail:payload}))}catch{}}
 let ready=null;const queued=[];const call=(name,arg)=>ready?ready[name](arg):queued.push([name,arg]);
 const api={open:()=>call('open'),close:()=>call('close'),toggle:()=>call('toggle'),reset:()=>call('reset'),
  on:(type,fn)=>{if(!EVENTS.includes(type)||typeof fn!=='function')return()=>{};listeners[type].add(fn);return()=>listeners[type].delete(fn);},
  off:(type,fn)=>{if(EVENTS.includes(type))listeners[type].delete(fn);},events:Object.freeze([...EVENTS])};
 try{Object.defineProperty(window,'AutomatePal',{value:Object.freeze(api),configurable:true});}catch{}
 const path=encodeURIComponent(location.pathname),get=q=>fetch(base+'/api/widget?'+q+'&path='+path,{credentials:'omit',referrerPolicy:'no-referrer'});
 // Demo: the token is the conversation. Key: settings only; a conversation is opened on first use.
 let session=null,logoVersion=null;
 try{const r=await get(keyMode?'key='+encodeURIComponent(botKey):'token='+encodeURIComponent(demoToken));if(!r.ok)return;const d=await r.json();settings=d.settings;if(!settings)return;logoVersion=Number.isInteger(d.logoVersion)?d.logoVersion:null;if(demoMode)session={token:demoToken,frame:d.frame};}catch{return;}
 // Page rules are display controls; the server checks origin and path again before opening a conversation.
 if((settings.excludedPaths||[]).some(p=>location.pathname===p||location.pathname.startsWith(p.endsWith('/')?p:p+'/')))return;
 const store={read(){try{const v=JSON.parse(localStorage.getItem(sessionKey)||'null');return v&&/^[a-f0-9]{64}$/.test(v.token)&&Date.parse(v.expiresAt)>Date.now()+300000?v:null}catch{return null}},
  write(v){try{localStorage.setItem(sessionKey,JSON.stringify({token:v.token,expiresAt:v.expiresAt}))}catch{}},clear(){try{localStorage.removeItem(sessionKey)}catch{}}};
 // Reuse this visitor's conversation while it is valid (fresh frame grant), else open a new one.
 async function ensureSession(){
  if(session)return session;
  const saved=store.read();
  if(saved){try{const r=await get('token='+saved.token);if(r.ok){const d=await r.json();return session={token:saved.token,frame:d.frame};}}catch{}store.clear();}
  const r=await fetch(base+'/api/widget/session',{method:'POST',credentials:'omit',referrerPolicy:'no-referrer',headers:{'Content-Type':'application/json'},body:JSON.stringify({key:botKey,path:location.pathname})});
  if(!r.ok)throw Error('unavailable');const d=await r.json();store.write(d);return session={token:d.token,frame:d.frame};
 }
 const L={en:['Close','unavailable, try again'],es:['Cerrar','no disponible, inténtalo de nuevo'],fr:['Fermer','indisponible, réessayez'],de:['Schließen','nicht verfügbar, bitte erneut versuchen'],pt:['Fechar','indisponível, tente novamente'],hi:['बंद करें','उपलब्ध नहीं, फिर से कोशिश करें'],te:['మూసివేయండి','అందుబాటులో లేదు, మళ్ళీ ప్రయత్నించండి']};
 const lang=L[settings.language]?settings.language:(navigator.languages||[navigator.language||'en']).map(l=>String(l).toLowerCase().split('-')[0]).find(l=>L[l])||'en',[closeText,unavailableText]=L[lang];
 const side=settings.side==='left'?'left':'right',label=settings.label||'Site help',suffix=demoMode?' · demo':'';
 const host=document.createElement('div');host.id='automatepal-billing-widget';const root=host.attachShadow({mode:'open'});
 const button=document.createElement('button'),text=document.createElement('span');text.textContent=label+suffix;button.append(text);
 if(logoVersion){const img=document.createElement('img');img.alt='';img.width=20;img.height=20;img.referrerPolicy='no-referrer';img.src=base+'/api/widget/logo?'+(keyMode?'key='+encodeURIComponent(botKey):'token='+encodeURIComponent(demoToken))+'&v='+logoVersion;Object.assign(img.style,{width:'20px',height:'20px',objectFit:'contain',borderRadius:'4px',marginRight:'8px',verticalAlign:'middle'});img.onerror=()=>img.remove();button.prepend(img);}button.setAttribute('aria-expanded','false');button.setAttribute('aria-controls','automatepal-panel');
 const color=/^#[a-fA-F0-9]{6}$/.test(settings.color)?settings.color:'#233de8',rgb=[1,3,5].map(i=>parseInt(color.slice(i,i+2),16)/255).map(n=>n<=0.04045?n/12.92:((n+0.055)/1.055)**2.4),fg=rgb[0]*.2126+rgb[1]*.7152+rgb[2]*.0722>.179?'#111':'#fff';
 Object.assign(button.style,{position:'fixed',bottom:'20px',[side]:'20px',zIndex:'2147483000',border:'0',borderRadius:'12px',background:color,color:fg,padding:'15px 20px',font:'14px system-ui',cursor:'pointer',boxShadow:'0 8px 30px #0003'});
 const frame=document.createElement('iframe');frame.id='automatepal-panel';frame.title=demoMode?'AutomatePal fictional site support':label+' chat';frame.referrerPolicy='no-referrer';frame.setAttribute('sandbox','allow-scripts allow-same-origin allow-forms');Object.assign(frame.style,{position:'fixed',bottom:'80px',[side]:'20px',width:'min(380px, calc(100vw - 40px))',height:'min(680px, calc(100vh - 110px))',zIndex:'2147483000',border:'1px solid #e1e4ed',borderRadius:'16px',background:'#fff',display:'none',boxShadow:'0 12px 50px #0002'});
 // The panel reports chat events to this page only (targetOrigin is this page's origin); payloads are re-built
 // from the allow-list above, so nothing else the frame sends is passed on.
 let loaded=false,loading=null;const isOpen=()=>frame.style.display!=='none';
 async function load(){
  const s=await ensureSession(),f=s.frame,q=new URLSearchParams({token:s.token,embed:location.origin,page:location.pathname.slice(0,200)});
  if(f&&f.origin===location.origin){q.set('fexp',String(f.exp));q.set('fsig',f.sig);}
  frame.src=base+'/help?'+q.toString();loaded=true;
 }
 function toggle(open,trigger){const was=isOpen();if(open)hideNote();
  if(open&&!loaded){loading=loading||load().catch(()=>{loading=null;text.textContent=label+' · '+unavailableText;frame.style.display='none';button.setAttribute('aria-expanded','false');});}
  frame.style.display=open?'block':'none';button.setAttribute('aria-expanded',String(open));text.textContent=open?closeText+' '+label:label+suffix;try{sessionStorage.setItem(key,open?'open':'closed')}catch{}if(trigger&&open!==was)emit(open?'open':'close',{trigger});}
 /* Proactive message (owner rule for this path, longest prefix wins): a note beside the button after a delay,
    once per browser session, only while the panel is closed. Plain text. Clicking it opens the chat. */
 let note=null,noteTimer=null;const noteKey='automatepal-note-'+id;
 function hideNote(){if(noteTimer){clearTimeout(noteTimer);noteTimer=null;}if(note){note.remove();note=null;}}
 function showNote(message){if(isOpen()||note)return;try{sessionStorage.setItem(noteKey,'1')}catch{}
  note=document.createElement('div');note.id='automatepal-note';Object.assign(note.style,{position:'fixed',bottom:'80px',[side]:'20px',zIndex:'2147483000',maxWidth:'min(280px, calc(100vw - 40px))',display:'flex',alignItems:'flex-start',gap:'4px',background:'#fff',color:'#0A1B3D',border:'1px solid #e1e4ed',borderRadius:'14px',boxShadow:'0 8px 30px #0002',padding:'6px',font:'14px/1.45 system-ui'});
  const go=document.createElement('button'),x=document.createElement('button');go.type=x.type='button';go.textContent=message;x.textContent='\u00d7';x.setAttribute('aria-label',closeText);
  Object.assign(go.style,{flex:'1',border:'0',background:'transparent',color:'inherit',font:'inherit',textAlign:'start',padding:'8px 10px',cursor:'pointer',borderRadius:'10px'});
  Object.assign(x.style,{border:'0',background:'transparent',color:'#4A5878',font:'18px/1 system-ui',width:'32px',height:'32px',cursor:'pointer',borderRadius:'8px',flex:'none'});
  go.onclick=()=>toggle(true,'proactive');x.onclick=hideNote;note.append(go,x);root.append(note);}
 function scheduleNote(){const rules=Array.isArray(settings.proactive)?settings.proactive:[],p=location.pathname;
  const rule=rules.filter(r=>r&&typeof r.path==='string'&&typeof r.message==='string'&&(p===r.path||p.startsWith(r.path.endsWith('/')?r.path:r.path+'/')||r.path==='/')).sort((a,b)=>b.path.length-a.path.length)[0];
  if(!rule||isOpen())return;try{if(sessionStorage.getItem(noteKey))return}catch{}
  noteTimer=setTimeout(()=>{noteTimer=null;showNote(rule.message.slice(0,140));},Math.min(120,Math.max(0,Number(rule.delaySeconds)||0))*1000);}
 window.addEventListener('message',e=>{if(!loaded||e.source!==frame.contentWindow||e.origin!==base)return;const d=e.data;if(!d||typeof d!=='object'||d.source!=='automatepal-help'||!['message_sent','handoff_requested','lead_submitted'].includes(d.event))return;emit(d.event,d);});
 button.onclick=()=>toggle(!isOpen(),'button');root.append(frame,button);document.body.append(host);let open=!!settings.autoOpen,restored=false;try{const saved=sessionStorage.getItem(key);if(saved!==null){open=saved==='open';restored=true;}}catch{}toggle(open,open&&!restored?'auto':null);scheduleNote();
 ready={open:()=>toggle(true,'api'),close:()=>toggle(false,'api'),toggle:()=>toggle(!isOpen(),'api'),
  // Reset: close the panel, forget the open state and start a fresh panel on the next open. With a key it
  // also forgets this visitor's conversation, so the next open starts a new one. Questions already sent stay
  // recorded for the owner.
  reset:()=>{hideNote();toggle(false,'reset');frame.src='about:blank';loaded=false;loading=null;if(keyMode){session=null;store.clear();}try{sessionStorage.removeItem(key)}catch{}}};
 for(const[name]of queued.splice(0))ready[name]();
})();
