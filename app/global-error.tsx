'use client';

/* Last-resort screen when the root layout itself fails. It replaces <html>, so styles are inline. */
export default function GlobalError({error,reset}:{error:Error&{digest?:string};reset:()=>void}){
 return <html lang="en"><body style={{margin:0,minHeight:'100vh',display:'grid',placeItems:'center',background:'#F4F6FB',color:'#0A1B3D',fontFamily:'system-ui,-apple-system,Segoe UI,sans-serif'}}>
  <main role="alert" style={{maxWidth:480,padding:24,textAlign:'center'}}>
   <h1 style={{margin:0,fontSize:30,color:'#041A52',letterSpacing:'-.02em'}}>AutomatePal is having trouble</h1>
   <p style={{margin:'12px 0 0',lineHeight:1.6,color:'#33415E'}}>The page could not load. Nothing was sent or charged. Try again in a moment.</p>
   {error.digest&&<p style={{margin:'10px 0 0',fontFamily:'ui-monospace,monospace',fontSize:13,color:'#5B6A88'}}>Reference {error.digest}</p>}
   <p style={{margin:'22px 0 0'}}>
    <button type="button" onClick={reset} style={{padding:'10px 18px',borderRadius:999,border:0,background:'#041A52',color:'#fff',fontWeight:600,fontSize:14,cursor:'pointer'}}>Try again</button>
    {' '}<a href="/status" style={{marginLeft:8,color:'#09318D',fontWeight:600,fontSize:14}}>Service status</a>
   </p>
  </main>
 </body></html>;
}
