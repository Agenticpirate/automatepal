import{NextRequest,NextResponse}from'next/server';import{createHash}from'node:crypto';import{z}from'zod';
import{serviceClient}from'../../../../lib/service-db';import{authenticate}from'../../../../lib/session';import{validOrigin}from'../../../../lib/origin';
import{allowRequest}from'../../../../lib/rate-limit';import{limitedJson}from'../../../../lib/limited-json';import{WIDGET_KEY,CASE_TOKEN,clientIp}from'../../../../lib/widget-frame';import{LOGO_MAX_BYTES,LOGO_TYPES,logoMatches}from'../../../../lib/widget-logo';import{botParam,rpcBot}from'../../../../lib/bots';
/* Widget logo (db/056).
   GET ?key=pk_… or ?token=<case token>: the image, for the widget button and the /help header. Served with
   its stored type, nosniff and a CSP that allows nothing, so the bytes can only ever render as an image.
   POST {type,data}: managers upload PNG, JPEG or WebP up to 100 KB (base64). The magic bytes must match
   the type; SVG is refused because it can carry script. DELETE removes it. */
const imageHeaders=(type:string)=>({'Content-Type':type,'X-Content-Type-Options':'nosniff','Content-Security-Policy':"default-src 'none'; sandbox",'Cache-Control':'public, max-age=3600','Cross-Origin-Resource-Policy':'cross-origin','Referrer-Policy':'no-referrer'});
export async function GET(req:NextRequest){
 const q=req.nextUrl.searchParams,key=q.get('key'),token=q.get('token');
 if(!(key&&WIDGET_KEY.test(key))&&!(token&&CASE_TOKEN.test(token)))return new NextResponse(null,{status:404});
 if(!await allowRequest('widget-logo:'+clientIp(req.headers),Date.now(),120))return new NextResponse(null,{status:429});
 const client=serviceClient();if(!client)return new NextResponse(null,{status:503});
 const{data,error}=await client.rpc('widget_logo',{p_key:key&&WIDGET_KEY.test(key)?key:null,p_token_hash:token&&CASE_TOKEN.test(token)?createHash('sha256').update(token).digest('hex'):null});
 if(error||!data?.data||!(LOGO_TYPES as readonly string[]).includes(data.type))return new NextResponse(null,{status:404});
 return new NextResponse(Buffer.from(data.data,'base64'),{headers:imageHeaders(data.type)});
}
const upload=z.object({bot:z.string().uuid().optional(),type:z.enum(['image/png','image/jpeg','image/webp']),data:z.string().max(Math.ceil(LOGO_MAX_BYTES/3)*4).regex(/^[A-Za-z0-9+/]+=*$/)});
export async function POST(req:NextRequest){
 const ctx=await authenticate(req);if(!ctx)return NextResponse.json({error:'Please sign in.'},{status:401});
 if(!validOrigin(req))return NextResponse.json({error:'Invalid origin'},{status:403});
 if(!await allowRequest('widget-logo-upload:'+ctx.actorId))return NextResponse.json({error:'Please wait a minute.'},{status:429});
 let d:z.infer<typeof upload>;
 try{d=upload.parse(await limitedJson(req,150000));}catch{return NextResponse.json({error:'Use a PNG, JPEG or WebP image up to 100 KB.'},{status:400});}
 const bytes=new Uint8Array(Buffer.from(d.data,'base64'));
 if(bytes.length===0||bytes.length>LOGO_MAX_BYTES)return NextResponse.json({error:'Use a PNG, JPEG or WebP image up to 100 KB.'},{status:400});
 if(!logoMatches(d.type,bytes))return NextResponse.json({error:'That file is not a valid '+d.type.slice(6).toUpperCase()+' image.'},{status:400});
 const{data,error}=await ctx.client.rpc('set_widget_logo',{p_type:d.type,p_data:Buffer.from(bytes).toString('base64'),p_bot:rpcBot(botParam(d.bot,ctx.userId),ctx.userId)});
 if(error)return NextResponse.json({error:'Could not save the logo. Managers and above can change it.'},{status:403});
 return NextResponse.json({logoVersion:data,note:'Logo saved. It shows on the chat button and at the top of the chat.'});
}
export async function DELETE(req:NextRequest){
 const ctx=await authenticate(req);if(!ctx)return NextResponse.json({error:'Please sign in.'},{status:401});
 if(!validOrigin(req))return NextResponse.json({error:'Invalid origin'},{status:403});
 const{error}=await ctx.client.rpc('set_widget_logo',{p_type:null,p_data:null,p_bot:rpcBot(botParam(req.nextUrl.searchParams.get('bot'),ctx.userId),ctx.userId)});
 if(error)return NextResponse.json({error:'Could not remove the logo. Managers and above can change it.'},{status:403});
 return NextResponse.json({logoVersion:null,note:'Logo removed. The widget shows your initials again.'});
}
