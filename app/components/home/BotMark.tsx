'use client';
import {useId} from 'react';

/* In-house AutomatePal assistant mascot (SVG, brand palette): white glossy helmet, dark visor
   with smiling eyes, pink antenna, pink/blue ear pods. `typing` pulses the antenna. */
export function BotMark({size=40,typing=false,className=''}:{size?:number;typing?:boolean;className?:string}){
 const u=useId().replace(/:/g,'');
 const id=(n:string)=>`${n}-${u}`;
 return <svg className={'hm-bot '+(typing?'hm-bot-typing ':'')+className} width={size} height={size} viewBox="0 0 64 64" aria-hidden="true">
  <defs>
   <linearGradient id={id('shell')} x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#FFFFFF"/><stop offset=".55" stopColor="#F6F0FF"/><stop offset="1" stopColor="#E3EAFF"/></linearGradient>
   <linearGradient id={id('rim')} x1="0" y1="1" x2="1" y2="0"><stop offset="0" stopColor="#FF5FA8"/><stop offset=".5" stopColor="#C46BFF"/><stop offset="1" stopColor="#3D8BFF"/></linearGradient>
   <linearGradient id={id('earL')} x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#FF7AB8"/><stop offset="1" stopColor="#8A3FE0"/></linearGradient>
   <linearGradient id={id('earR')} x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#56A8FF"/><stop offset="1" stopColor="#1F3FD0"/></linearGradient>
   <radialGradient id={id('visor')} cx=".5" cy=".3" r=".8"><stop offset="0" stopColor="#2457E0"/><stop offset=".55" stopColor="#0A2577"/><stop offset="1" stopColor="#030B2E"/></radialGradient>
   <radialGradient id={id('ball')} cx=".35" cy=".3" r=".75"><stop offset="0" stopColor="#FFD6EA"/><stop offset=".45" stopColor="#FF6FAF"/><stop offset="1" stopColor="#DE237A"/></radialGradient>
   <linearGradient id={id('dome')} x1="0" y1="0" x2="1" y2="0"><stop offset="0" stopColor="#3D6BFF"/><stop offset="1" stopColor="#8E4BFF"/></linearGradient>
   <filter id={id('glow')} x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="1.1" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
  </defs>
  <rect x="5" y="27" width="9" height="16" rx="4.5" fill={`url(#${id('earL')})`}/>
  <rect x="50" y="27" width="9" height="16" rx="4.5" fill={`url(#${id('earR')})`}/>
  <path d="M19 19.5C21.5 13.5 27 11 33 11s10.5 2.2 12.5 8.5z" fill={`url(#${id('dome')})`}/>
  <path d="M41.5 17.5c1.6-3.9 3.4-6.2 5.6-7.6" stroke="#F4ECFF" strokeWidth="3.4" strokeLinecap="round" fill="none"/>
  <g className="hm-bot-ball"><circle cx="47.5" cy="8.5" r="5" fill={`url(#${id('ball')})`}/><circle cx="46" cy="7" r="1.5" fill="#fff" opacity=".75"/></g>
  <rect x="11" y="16" width="42" height="38" rx="17" fill={`url(#${id('shell')})`} stroke={`url(#${id('rim')})`} strokeWidth="2.2"/>
  <rect x="16" y="22" width="32" height="26" rx="11" fill={`url(#${id('visor')})`} stroke="#5B8CFF" strokeOpacity=".65" strokeWidth="1.2"/>
  <path d="M21 27.5c3-2.4 7-3.3 12-3.2" stroke="#fff" strokeOpacity=".28" strokeWidth="2" strokeLinecap="round" fill="none"/>
  <g filter={`url(#${id('glow')})`} stroke="#fff" strokeWidth="3" strokeLinecap="round" fill="none"><path d="M21.6 38q3.4-5.2 6.8 0"/><path d="M35.6 38q3.4-5.2 6.8 0"/></g>
 </svg>;
}

/* Visitor profile avatar: navy gradient disc with a person silhouette and a pink ring. */
export function ProfileMark({size=28}:{size?:number}){
 const u=useId().replace(/:/g,'');
 return <svg className="hm-profile" width={size} height={size} viewBox="0 0 32 32" aria-hidden="true">
  <defs>
   <linearGradient id={`pf-${u}`} x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#2457E0"/><stop offset="1" stopColor="#041A52"/></linearGradient>
   <clipPath id={`pc-${u}`}><circle cx="16" cy="16" r="14.5"/></clipPath>
  </defs>
  <circle cx="16" cy="16" r="15.25" fill="#fff" stroke="#FD91CC" strokeWidth="1.5"/>
  <g clipPath={`url(#pc-${u})`}><circle cx="16" cy="16" r="14.5" fill={`url(#pf-${u})`}/><circle cx="16" cy="12.6" r="5" fill="#fff" opacity=".95"/><path d="M5.5 32c.6-6.6 4.8-11.2 10.5-11.2S25.9 25.4 26.5 32z" fill="#fff" opacity=".95"/></g>
 </svg>;
}
