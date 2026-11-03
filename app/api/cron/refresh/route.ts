import {NextRequest,NextResponse} from 'next/server';
import {cronAuthorized,runScheduledJobs} from '../../../../lib/cron';
import {serviceClient} from '../../../../lib/service-db';
/* Hourly scheduled work (see lib/cron.ts). Authenticated by `Authorization: Bearer <CRON_SECRET>`, compared
   in constant time. Responds with counts only: no workspace ids, URLs or text. */
export const dynamic='force-dynamic';
export const maxDuration=60;
const noStore={'Cache-Control':'no-store'};
export async function POST(req:NextRequest){
 if(!cronAuthorized(req.headers.get('authorization')))return NextResponse.json({error:'Unauthorized'},{status:401,headers:noStore});
 const client=serviceClient();
 if(!client)return NextResponse.json({error:'Scheduled jobs need SUPABASE_SERVICE_ROLE_KEY on the server.'},{status:503,headers:noStore});
 const jobs=await runScheduledJobs(client);
 const ok=Object.values(jobs).every(j=>j.ok);
 return NextResponse.json({ok,jobs,ranAt:new Date().toISOString()},{status:ok?200:207,headers:noStore});
}
export function GET(){return NextResponse.json({error:'Use POST with the cron bearer token.'},{status:405,headers:{...noStore,Allow:'POST'}});}
