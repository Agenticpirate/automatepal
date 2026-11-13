import {modeText} from '../../lib/app-mode';
import type {Metadata} from 'next';
const title=modeText('Demo pricing','Pricing');
const description=modeText('Compare fictional Starter, Growth and Scale monthly or annual plans with a $1 three-day trial. Local preview only, no checkout or live charges.','AutomatePal pricing: Free, Starter, Growth and Scale plans for AI customer support that shows its work. Monthly or yearly, $1 three-day trial, cancel any time.');
const ogAlt=modeText('AutomatePal fictional-data preview, no live payments','AutomatePal: AI support that shows its work');
export const metadata:Metadata={title,description,alternates:{canonical:'/pricing'},robots:{index:true,follow:true},
 openGraph:{images:[{url:'/opengraph-image',width:1200,height:630,alt:ogAlt}],title:`${title} | AutomatePal`,description,url:'/pricing'},
 twitter:{card:'summary_large_image',images:['/opengraph-image'],title:`${title} | AutomatePal`,description}};
export default function Layout({children}:{children:React.ReactNode}){return children;}
