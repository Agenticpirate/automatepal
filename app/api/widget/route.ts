import{NextRequest,NextResponse}from'next/server';import{createClient}from'@supabase/supabase-js';import{createHash}from'node:crypto';import{widgetSettings,widgetPageAllowed}from'../../../lib/widget';
import{serviceClient}from'../../../lib/service-db';import{allowRequest}from'../../../lib/rate-limit';import{WIDGET_KEY,CASE_TOKEN,signFrame,clientIp}from'../../../lib/widget-frame';
/* Widget settings for one page load. Two ways in:
   - ?key=pk_… (permanent install): settings for an active key, read with the service role. No conversation
     exists yet; widget.js asks /api/widget/session for one when the visitor first opens the panel.
   - ?token=<case token> (one-hour demo, or a visitor's saved conversation): settings through the case, plus
     a signed frame grant (lib/widget-frame.ts) so /help may be framed by this page's origin.
   Either way the page's Origin must be this app or one of the owner's allowed origins, and excluded paths
   get nothing. */
const headers=(origin:string)=>({'Access-Control-Allow-Origin':origin,'Vary':'Origin','Cache-Control':'no-store','Referrer-Policy':'no-referrer'});
const unavailable=()=>NextResponse.json({error:'Unavailable'},{status:404});
export async function GET(req:NextRequest){
 const q=req.nextUrl.searchParams,token=q.get('token')??'',key=q.get('key')??'',origin=req.headers.get('origin')??req.nextUrl.origin,path=q.get('path')??'/';
 if(path.length>200)return unavailable();
 if(key){
  if(!WIDGET_KEY.test(key))return unavailable();
  if(!await allowRequest('widget-load:'+clientIp(req.headers),Date.now(),60))return NextResponse.json({error:'Rate limited'},{status:429});
  const client=serviceClient();if(!client)return NextResponse.json({error:'Widget service not configured.'},{status:503});
  const{data,error}=await client.rpc('widget_key_view',{p_key:key});if(error||!data)return unavailable();
  const parsed=widgetSettings.safeParse({...data,...data.controls});
  if(!parsed.success||!widgetPageAllowed(origin,path,parsed.data,req.nextUrl.origin))return NextResponse.json({error:'Widget not enabled for this page.'},{status:403});
  return NextResponse.json({settings:parsed.data,mode:data.mode},{headers:headers(origin)});
 }
 if(!CASE_TOKEN.test(token))return unavailable();
 const client=createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!,process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,{auth:{persistSession:false}});
 const{data,error}=await client.rpc('support_case_view',{p_hash:createHash('sha256').update(token).digest('hex')});if(error||!data)return unavailable();
 const parsed=widgetSettings.safeParse({...data.branding,...data.controls});
 if(!parsed.success||!widgetPageAllowed(origin,path,parsed.data,req.nextUrl.origin))return NextResponse.json({error:'Widget not enabled for this page.'},{status:403});
 return NextResponse.json({settings:parsed.data,expiresAt:data.expiresAt,frame:await signFrame(token,origin)},{headers:headers(origin)});
}
