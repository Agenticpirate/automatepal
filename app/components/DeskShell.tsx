'use client';
import Link from 'next/link';import {usePathname} from 'next/navigation';import DemoBanner from './DemoBanner';
/* One brand theme everywhere: no light/dark switching. Widget-mode pages bring their own header,
   so only the service-desk app mode renders the top bar. */
export default function DeskShell({children,widget=false}:{children:React.ReactNode;widget?:boolean}){const path=usePathname();
return <div className={'desk-ui '+(widget?'desk-widget':'desk-app')}><DemoBanner/>{!widget&&<div className="desk-topbar"><Link href="/owner" className="desk-brand">AutomatePal<span> / service desk</span></Link><nav aria-label="Service desk">{[['/owner','Overview'],['/tickets','Tickets'],['/support','Widget studio']].map(([href,label])=><Link key={href} href={href} aria-current={path===href?'page':undefined}>{label}</Link>)}</nav></div>}{children}</div>;}
