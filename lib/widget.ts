import{z}from'zod';import './zod-csp';
import{workingHours}from'./working-hours';
import{followUpList}from'./follow-ups';
const origin=z.string().max(200).refine(v=>{try{const u=new URL(v);return u.protocol==='https:'&&u.origin===v&&!u.username&&!u.password}catch{return false}},'Use an exact HTTPS origin, without a path');
const pagePath=z.string().min(1).max(200).regex(/^\/(?!\/)[^?#]*$/);
/* Starter questions for part of the site: the rule with the longest matching path prefix wins; pages with
   no rule use the default prompts. */
const pageStarter=z.object({path:pagePath,prompts:z.array(z.string().trim().min(3).max(100)).min(1).max(4)});
export const WIDGET_LANGUAGES=['auto','en','es','fr','de','pt','hi','te'] as const;
export function startersFor(page:string|null|undefined,rules:{path:string;prompts:string[]}[]|undefined,defaults:string[]):string[]{
 if(!page||!rules?.length)return defaults;
 const hit=rules.filter(r=>page===r.path||page.startsWith(r.path.endsWith('/')?r.path:r.path+'/')||r.path==='/').sort((a,b)=>b.path.length-a.path.length)[0];
 return hit?hit.prompts:defaults;
}
export const widgetSettings=z.object({label:z.string().trim().min(1).max(40),color:z.string().regex(/^#[a-fA-F0-9]{6}$/),initials:z.string().trim().min(1).max(3),prompts:z.array(z.string().trim().min(3).max(100)).max(4),allowedOrigins:z.array(origin).max(10).default([]),excludedPaths:z.array(z.string().min(1).max(200).regex(/^\/(?!\/)[^?#]*$/)).max(20).default([]),autoOpen:z.boolean().default(false),side:z.enum(['left','right']).default('right'),hideSources:z.boolean().default(false),hideOrder:z.boolean().default(false),hideContact:z.boolean().default(false),workingHours:workingHours.optional(),visitorChoice:z.boolean().default(true),followUps:followUpList.default([]),maxQuestions:z.number().int().min(1).max(50).optional(),pageStarters:z.array(pageStarter).max(10).default([]),language:z.enum(WIDGET_LANGUAGES).default('auto'),modelTier:z.enum(['fast','deep']).default('fast')});
export function widgetPageAllowed(origin:string,path:string,settings:z.infer<typeof widgetSettings>,appOrigin:string){return (origin===appOrigin||settings.allowedOrigins.includes(origin))&&!settings.excludedPaths.some(p=>path===p||path.startsWith(p.endsWith('/')?p:p+'/'));}
