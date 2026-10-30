import type {MetadataRoute} from 'next';
export const dynamic='force-dynamic';
export default function robots():MetadataRoute.Robots{
 if(process.env.NEXT_PUBLIC_DEMO_OPEN!=='false')return{rules:{userAgent:'*',disallow:'/'}};
 return{rules:{userAgent:'*',allow:'/',disallow:['/api/']},sitemap:'https://automatepal.onrender.com/sitemap.xml'};
}
