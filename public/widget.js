/* AutomatePal fictional sandbox billing add-on. Original code, MIT. */
(()=>{
 const script=document.currentScript,token=script?.getAttribute('data-demo-token');if(!script||!token||!/^[a-f0-9]{64}$/.test(token)||document.getElementById('automatepal-billing-widget'))return;
 const base=new URL(script.src).origin,key='automatepal-demo-'+token,side=script.getAttribute('data-side')==='left'?'left':'right';
 const host=document.createElement('div');host.id='automatepal-billing-widget';const root=host.attachShadow({mode:'open'});
 const button=document.createElement('button');button.textContent='Billing help · demo';button.setAttribute('aria-expanded','false');button.setAttribute('aria-controls','automatepal-panel');
 Object.assign(button.style,{position:'fixed',bottom:'20px',[side]:'20px',zIndex:'2147483000',border:'0',borderRadius:'12px',background:'#233de8',color:'#fff',padding:'15px 20px',font:'14px system-ui',cursor:'pointer',boxShadow:'0 8px 30px #0003'});
 const frame=document.createElement('iframe');frame.id='automatepal-panel';frame.title='AutomatePal fictional billing help';frame.referrerPolicy='no-referrer';frame.setAttribute('sandbox','allow-scripts allow-same-origin allow-forms');Object.assign(frame.style,{position:'fixed',bottom:'80px',[side]:'20px',width:'min(380px, calc(100vw - 40px))',height:'min(680px, calc(100vh - 110px))',zIndex:'2147483000',border:'1px solid #e1e4ed',borderRadius:'16px',background:'#fff',display:'none',boxShadow:'0 12px 50px #0002'});
 let loaded=false;function toggle(open){if(open&&!loaded){frame.src=base+'/help?token='+encodeURIComponent(token);loaded=true;}frame.style.display=open?'block':'none';button.setAttribute('aria-expanded',String(open));button.textContent=open?'Close billing help':'Billing help · demo';try{sessionStorage.setItem(key,open?'open':'closed')}catch{}}
 button.onclick=()=>toggle(frame.style.display==='none');root.append(frame,button);document.body.append(host);let open=false;try{open=sessionStorage.getItem(key)==='open'}catch{}toggle(open);
})();
