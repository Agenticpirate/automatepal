import{NextRequest,NextResponse}from'next/server';import{randomBytes,createHash}from'node:crypto';import{z}from'zod';
import{widgetSettings,widgetPageAllowed}from'../../../../lib/widget';import{serviceClient}from'../../../../lib/service-db';
import{allowRequest}from'../../../../lib/rate-limit';import{limitedJson}from'../../../../lib/limited-json';
import{WIDGET_KEY,signFrame,clientIp}from'../../../../lib/widget-frame';
/* POST {key, path}: opens one visitor conversation for a permanent widget key (db/055 widget_open_session).
   Called by widget.js from the merchant's page the first time a visitor opens the panel; the visitor keeps
   the returned 24-hour token in localStorage and reuses it. Checks, in order: key shape, a browser Origin
   that is this app or one of the owner's allowed origins (and not an excluded path), 5 new conversations per
   minute per visitor IP and 300 per minute per key, then the database's 5000 per workspace per UTC day.
   The token is returned once; only its sha256 is stored. */
const cors=(origin:string)=>({'Access-Control-Allow-Origin':origin,'Vary':'Origin','Cache-Control':'no-store','Referrer-Policy':'no-referrer'});
const body=z.object({key:z.string().regex(WIDGET_KEY),path:z.string().max(200).default('/')});
export async function OPTIONS(req:NextRequest){
 const origin=req.headers.get('origin');if(!origin)return new NextResponse(null,{status:204});
 return new NextResponse(null,{status:204,headers:{...cors(origin),'Access-Control-Allow-Methods':'POST','Access-Control-Allow-Headers':'Content-Type','Access-Control-Max-Age':'600'}});
}
export async function POST(req:NextRequest){
 const origin=req.headers.get('origin');
 if(!origin)return NextResponse.json({error:'Open the chat from the website it is installed on.'},{status:403});
 let d:z.infer<typeof body>;
 try{d=body.parse(await limitedJson(req,1000));}catch{return NextResponse.json({error:'Invalid request.'},{status:400,headers:cors(origin)});}
 const ip=clientIp(req.headers);
 if(!await allowRequest('widget-session-ip:'+ip,Date.now(),5)||!await allowRequest('widget-session-key:'+d.key,Date.now(),300))
  return NextResponse.json({error:'Too many new chats. Try again in a minute.'},{status:429,headers:{...cors(origin),'Retry-After':'60'}});
 const client=serviceClient();if(!client)return NextResponse.json({error:'Widget service not configured.'},{status:503,headers:cors(origin)});
 const view=await client.rpc('widget_key_view',{p_key:d.key});
 if(view.error||!view.data)return NextResponse.json({error:'This chat is not available.'},{status:404,headers:cors(origin)});
 const parsed=widgetSettings.safeParse({...view.data,...view.data.controls});
 if(!parsed.success||!widgetPageAllowed(origin,d.path,parsed.data,req.nextUrl.origin))return NextResponse.json({error:'Chat is not enabled on this site.'},{status:403,headers:cors(origin)});
 const token=randomBytes(32).toString('hex');
 const opened=await client.rpc('widget_open_session',{p_key:d.key,p_token_hash:createHash('sha256').update(token).digest('hex')});
 if(opened.error)return NextResponse.json({error:/Daily/.test(opened.error.message)?'Chat is busy right now. Please try again later.':'Could not start a chat.'},{status:opened.error.message.includes('Daily')?429:503,headers:cors(origin)});
 if(!opened.data)return NextResponse.json({error:'This chat is not available.'},{status:404,headers:cors(origin)});
 return NextResponse.json({token,expiresAt:opened.data.expiresAt,frame:await signFrame(token,origin)},{headers:cors(origin)});
}
