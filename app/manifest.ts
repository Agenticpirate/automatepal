import type {MetadataRoute} from 'next';
// Icons for Android home screen shortcuts and browsers that read the web manifest.
export default function manifest():MetadataRoute.Manifest{
 return{
  name:'AutomatePal',
  short_name:'AutomatePal',
  description:'Source-backed support and owner review. Fictional-data preview, no live payments.',
  start_url:'/',
  display:'browser',
  background_color:'#041A52',
  theme_color:'#041A52',
  icons:[
   {src:'/icon-192.png',sizes:'192x192',type:'image/png',purpose:'any'},
   {src:'/icon-512.png',sizes:'512x512',type:'image/png',purpose:'any'},
  ],
 };
}
