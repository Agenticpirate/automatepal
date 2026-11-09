import {NextRequest,NextResponse} from 'next/server';
import {z} from 'zod';
import {authenticate,roleAtLeast} from '../../../../lib/session';
import {validOrigin} from '../../../../lib/origin';
import {allowRequest} from '../../../../lib/rate-limit';
import {limitedJson} from '../../../../lib/limited-json';
import {demoGate,demoLocked} from '../../../../lib/demo-open';
import {importUrlProblem} from '../../../../lib/url-import';
/* Scheduled website refresh (db/050): the schedule, the last run, and the review queue of changed, new and
   removed pages. Managers and up. Nothing here publishes: the owner applies a change through the normal
   consent-checked Knowledge save, then marks it applied, or dismisses it. */
const noStore={'Cache-Control':'no-store'};
export async function GET(req:NextRequest){
 const c=await authenticate(req);if(!c){const d=demoGate(req,'knowledge-refresh');if(d)return d;return NextResponse.json({error:'Please sign in.'},{status:401});}
 if(!roleAtLeast(c.role,'manager'))return NextResponse.json({error:'Only managers, admins and the owner can manage scheduled refresh.'},{status:403,headers:noStore});
 const [s,i]=await Promise.all([c.client.from('refresh_settings').select('frequency,sitemap_url,last_run_at,next_due_at,last_summary').eq('user_id',c.userId).maybeSingle(),
  c.client.from('knowledge_refresh_items').select('id,document_id,url,kind,title,content,detected_at').eq('user_id',c.userId).eq('status','pending').order('detected_at',{ascending:false}).limit(100)]);
 if(s.error||i.error)return NextResponse.json({error:'Scheduled refresh is not enabled on this database yet.'},{status:503,headers:noStore});
 const ids=(i.data??[]).map(x=>x.document_id).filter(Boolean) as string[];
 const docs=ids.length?await c.client.from('knowledge_documents').select('id,title,published,updated_at').eq('user_id',c.userId).in('id',ids):{data:[],error:null};
 const byId=new Map((docs.data??[]).map(d=>[d.id as string,d]));
 return NextResponse.json({settings:s.data??{frequency:'off',sitemap_url:null,last_run_at:null,next_due_at:null,last_summary:null},
  items:(i.data??[]).map(x=>({...x,document:x.document_id?byId.get(x.document_id)??null:null})),
  limits:'Each run re-checks up to 15 saved pages, least recently checked first, so every saved page takes its turn. It proposes up to 5 sitemap pages that were not in an earlier read; dismissed pages are not proposed again. A saved page is proposed for removal only when it answers 404 or 410, or when a fully read sitemap no longer lists it (only pages on the same host as the sitemap); a dismissed removal is not proposed again. The same robots.txt, private-address and size checks as an import apply.'},{headers:noStore});
}
const Action=z.discriminatedUnion('action',[
 z.object({action:z.literal('settings'),frequency:z.enum(['off','monthly','weekly','daily']),sitemapUrl:z.string().trim().max(500).nullable().optional()}),
 z.object({action:z.literal('resolve'),id:z.string().uuid(),status:z.enum(['applied','dismissed'])}),
]);
export async function POST(req:NextRequest){
 const c=await authenticate(req);if(!c){const d=demoLocked();if(d)return d;return NextResponse.json({error:'Please sign in.'},{status:401});}
 if(!validOrigin(req))return NextResponse.json({error:'Invalid origin'},{status:403});
 if(!roleAtLeast(c.role,'manager'))return NextResponse.json({error:'Only managers, admins and the owner can manage scheduled refresh.'},{status:403});
 if(!await allowRequest('refresh:'+c.actorId))return NextResponse.json({error:'Please wait a minute.'},{status:429});
 let b:z.infer<typeof Action>;try{b=Action.parse(await limitedJson(req,2000));}catch{return NextResponse.json({error:'Check the fields and try again.'},{status:400});}
 if(b.action==='settings'){
  const url=b.sitemapUrl?b.sitemapUrl:null;
  if(url){const problem=/^https:\/\//.test(url)?importUrlProblem(url):'Use an https:// sitemap URL.';if(problem)return NextResponse.json({error:problem},{status:400});}
  const r=await c.client.rpc('set_refresh_settings',{p_frequency:b.frequency,p_sitemap_url:url});
  if(r.error||r.data!==true)return NextResponse.json({error:'Schedule not saved. Check the sitemap URL.'},{status:400});
  return NextResponse.json({note:b.frequency==='off'?'Scheduled refresh is off.':`Saved. Your website sources are re-checked ${b.frequency}; changes wait here for your review and nothing is published automatically.`},{headers:noStore});
 }
 const r=await c.client.rpc('resolve_refresh_item',{p_id:b.id,p_status:b.status});
 if(r.error)return NextResponse.json({error:'Change not updated.'},{status:400});
 return NextResponse.json({note:r.data?(b.status==='applied'?'Marked as applied.':'Dismissed. The saved source is unchanged.'):'That change was already handled.'},{headers:noStore});
}
