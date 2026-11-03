import type {Metadata} from 'next';
/* Shared metadata for the /legal pages. */
export function legalMeta(path:string,title:string,description:string):Metadata{
 return{title,description,alternates:{canonical:path},robots:{index:true,follow:true},
  openGraph:{title:title+' | AutomatePal',description,url:path,images:[{url:'/opengraph-image',width:1200,height:630,alt:'AutomatePal legal and trust'}]},
  twitter:{card:'summary_large_image',title:title+' | AutomatePal',description,images:['/opengraph-image']}};
}
