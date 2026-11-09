import {NextRequest,NextResponse} from 'next/server';
import {z} from 'zod';
import {authenticate,roleAtLeast} from '../../../lib/session';
import {validOrigin} from '../../../lib/origin';
import {allowRequest} from '../../../lib/rate-limit';
import {limitedJson} from '../../../lib/limited-json';
import {demoGate,demoLocked} from '../../../lib/demo-open';
import {emailTransport} from '../../../lib/email';
/* Owner email notifications (db/048): which automatic emails are on, and the latest sends (metadata only:
   type, status and time; the recipient is stored only as a hash and is not returned). Managers can read;
   admins and the owner can change. */
const noStore={'Cache-Control':'no-store'};
const DEFAULTS={owner_alerts:true,weekly_digest:true,new_leads:true};
const body=z.object({owner_alerts:z.boolean(),weekly_digest:z.boolean(),new_leads:z.boolean()}).strict();
export async function GET(req:NextRequest){
 const c=await authenticate(req);if(!c){const d=demoGate(req,'email-settings');if(d)return d;return NextResponse.json({error:'Please sign in.'},{status:401});}
 if(!roleAtLeast(c.role,'manager'))return NextResponse.json({error:'Only managers, admins and the owner can see email settings.'},{status:403,headers:noStore});
 const [s,l]=await Promise.all([c.client.from('email_settings').select('owner_alerts,weekly_digest,new_leads,updated_at').eq('user_id',c.userId).maybeSingle(),c.client.from('email_log').select('id,created_at,email_type,status').eq('user_id',c.userId).order('created_at',{ascending:false}).limit(20)]);
 if(s.error||l.error)return NextResponse.json({error:'Email settings are not enabled on this database yet.'},{status:503,headers:noStore});
 return NextResponse.json({settings:s.data??DEFAULTS,log:l.data,transport:emailTransport(),canEdit:roleAtLeast(c.role,'admin'),
  caps:'Per workspace per UTC day: 20 owner alerts, 20 new-lead emails, 20 invites, 50 visitor replies, 100 in total; one weekly digest every 6 days.'},{headers:noStore});
}
export async function POST(req:NextRequest){
 const c=await authenticate(req);if(!c){const d=demoLocked();if(d)return d;return NextResponse.json({error:'Please sign in.'},{status:401});}
 if(!validOrigin(req))return NextResponse.json({error:'Invalid origin'},{status:403});
 if(!roleAtLeast(c.role,'admin'))return NextResponse.json({error:'Only admins and the owner can change email settings.'},{status:403});
 if(!await allowRequest('email-settings:'+c.actorId))return NextResponse.json({error:'Please wait a minute.'},{status:429});
 let b:z.infer<typeof body>;try{b=body.parse(await limitedJson(req,1000));}catch{return NextResponse.json({error:'Check the fields and try again.'},{status:400});}
 const r=await c.client.rpc('set_email_settings',{p_owner_alerts:b.owner_alerts,p_weekly_digest:b.weekly_digest,p_new_leads:b.new_leads});
 if(r.error||r.data!==true)return NextResponse.json({error:'Email settings were not saved.'},{status:400});
 return NextResponse.json({note:'Email settings saved.'},{headers:noStore});
}
