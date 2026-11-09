import {modeText} from '../lib/app-mode';
import type {MetadataRoute} from 'next';
// Icons for Android home screen shortcuts and browsers that read the web manifest.
export default function manifest():MetadataRoute.Manifest{
 return{
  name:'AutomatePal',
  short_name:'AutomatePal',
  description:'Source-backed support and owner review. '+modeText('Fictional-data preview, no live payments.','Read-only billing, no live payments.'),
  // Installed from the dashboard it opens the Tickets inbox as an app; iOS needs this for push notifications.
  start_url:'/tickets',
  scope:'/',
  display:'standalone',
  background_color:'#041A52',
  theme_color:'#041A52',
  icons:[
   {src:'/icon-192.png',sizes:'192x192',type:'image/png',purpose:'any'},
   {src:'/icon-512.png',sizes:'512x512',type:'image/png',purpose:'any'},
  ],
 };
}
