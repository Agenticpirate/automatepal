import { runTool, runAgent } from '../lib/agent';
import { computeStats } from '../lib/store';
async function main() {
console.log('Negative amount rejected:', await runTool('create_checkout_order', {amount:-1}).then(()=>false,()=>true));
console.log('Real recipient rejected:', await runTool('create_and_send_invoice', {customer_email:'someone@gmail.com',item_name:'Test',unit_amount:1}).then(()=>false,()=>true));
console.log('PayPal catalog read:', JSON.stringify(await runTool('list_products_and_plans',{})).slice(0,300));
// Demo seeding is tested separately to keep reruns idempotent.
console.log('Real stats:', await computeStats());
console.log('Demo stats:', await computeStats('simulation'));
try { console.log('Agent:', JSON.stringify(await runAgent([], 'List my existing sandbox products and plans. Do not create anything.'))); } catch { console.log('Agent unavailable: model provider request failed.'); }
}
main().catch(e => { console.error(e.message); process.exitCode=1; });
