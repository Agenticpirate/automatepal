import type {MetadataRoute} from 'next';
export default function sitemap():MetadataRoute.Sitemap{return['','/pricing','/privacy','/terms','/status','/contact'].map(path=>({url:'https://automatepal.onrender.com'+path}));}
