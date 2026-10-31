import type {MetadataRoute} from 'next';
import {SITE_URL} from '../lib/site';
export const dynamic='force-dynamic';
// Same rules in open-demo and locked mode: crawl public pages and icons, never the API.
// Demo app surfaces stay out of search through their X-Robots-Tag noindex headers (next.config.ts),
// which crawlers can only see if the HTML routes are crawlable.
export default function robots():MetadataRoute.Robots{
 return{rules:{userAgent:'*',allow:'/',disallow:['/api/']},sitemap:SITE_URL+'/sitemap.xml'};
}
