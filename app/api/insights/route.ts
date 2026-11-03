import {NextRequest,NextResponse} from 'next/server';
import {z} from 'zod';
import {authenticate,roleAtLeast} from '../../../lib/session';
import {validOrigin} from '../../../lib/origin';
import {allowRequest} from '../../../lib/rate-limit';
import {limitedJson} from '../../../lib/limited-json';
import {demoGate,demoLocked} from '../../../lib/demo-open';
/* AI conversation insights settings (db/051): the owner-editable topic list ("other" is always added) and an
   on/off switch. Labels are written by the scheduled job, inside the daily model spend cap. */
const noStore={'Cache-Control':'no-store'};
const DEFAULT_TOPICS=['Billing','Shipping','Refunds','Account','Product','Technical issue'];
const topic=z.string().trim().min(2).max(40).regex(/^[\p{L}\p{N}][\p{L}\p{N} &/'(),.-]*$/u).refine(t=>t.toLowerCase()!=='other');
const body=z.object({topics:z.array(topic).min(1).max(12).refine(t=>new Set(t.map(x=>x.toLowerCase())).size===t.length,'duplicate'),enabled:z.boolean()}).strict();
export async function GET(req:NextRequest){
 const c=await authenticate(req);if(!c){const d=demoGate(req,'insights');if(d)return d;return NextResponse.json({error:'Please sign in.'},{status:401});}
 const r=await c.client.from('insight_settings').select('topics,enabled,updated_at').eq('user_id',c.userId).maybeSingle();
 if(r.error)return NextResponse.json({error:'Insights are not enabled on this database yet.'},{status:503,headers:noStore});
 return NextResponse.json({topics:r.data?.topics??DEFAULT_TOPICS,enabled:r.data?.enabled??true,canEdit:roleAtLeast(c.role,'manager')},{headers:noStore});
}
export async function POST(req:NextRequest){
 const c=await authenticate(req);if(!c){const d=demoLocked();if(d)return d;return NextResponse.json({error:'Please sign in.'},{status:401});}
 if(!validOrigin(req))return NextResponse.json({error:'Invalid origin'},{status:403});
 if(!roleAtLeast(c.role,'manager'))return NextResponse.json({error:'Only managers, admins and the owner can change insight topics.'},{status:403});
 if(!allowRequest('insights:'+c.actorId))return NextResponse.json({error:'Please wait a minute.'},{status:429});
 let b:z.infer<typeof body>;try{b=body.parse(await limitedJson(req,2000));}catch{return NextResponse.json({error:'Give 1 to 12 different topics of 2 to 40 letters, digits or spaces. "Other" is added for you.'},{status:400});}
 const r=await c.client.rpc('set_insight_settings',{p_topics:b.topics,p_enabled:b.enabled});
 if(r.error||r.data!==true)return NextResponse.json({error:'Topics not saved.'},{status:400});
 return NextResponse.json({note:b.enabled?'Topics saved. New labels use them from the next scheduled run.':'AI labelling is off. Existing labels stay until conversations are deleted.'},{headers:noStore});
}
