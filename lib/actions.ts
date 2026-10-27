import { randomUUID } from 'node:crypto';
import { requestContext } from './session';
export const MUTATIONS = new Set(['create_product','create_plan','create_checkout_order','simulate_subscriber_activity']);
export async function proposeAction(tool:string,args:Record<string,unknown>) {
  const ctx=requestContext.getStore();
  if(!ctx) throw new Error('Sign in to review actions');
  const action={id:randomUUID(),user_id:ctx.userId,tool,args,status:'pending'};
  const {error}=await ctx.client.from('action_proposals').insert(action);
  if(error) throw new Error('Could not save action for review');
  return {id:action.id,tool,args,status:'pending',note:'Review and confirm this exact action before it runs.'};
}
