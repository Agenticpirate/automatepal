/* API-side plan check for features whose database path already needs a server-only proof (billing-provider
   connections, db/044), so the gate cannot live in SQL. Other gates are in the database (db/057). */
import {NextResponse} from 'next/server';
import type {SupabaseClient} from '@supabase/supabase-js';
import {PLANS, planWith, type Feature} from './plans';
export async function featureBlocked(client: SupabaseClient, feature: Feature, label: string): Promise<NextResponse | null> {
  const r = await client.rpc('my_plan');
  if (r.error || !r.data) return NextResponse.json({error: 'Plan information is not available. Try again in a minute.'}, {status: 503});
  if ((r.data.limits?.features as string[] | undefined)?.includes(feature)) return null;
  return NextResponse.json({error: `${label} is included from the ${PLANS[planWith(feature)].name} plan. Upgrade on the Plan page.`, upgrade: planWith(feature)}, {status: 402});
}
