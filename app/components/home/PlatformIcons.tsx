/* Draw-on line icons for the platform cards (section 04) and their small inline marks.
   Geometry from Lucide (ISC license, lucide.dev), the same shapes the cards used before,
   rebuilt as single paths so each stroke can draw on. Motion lives in platform.css. */
import {D,Dot,Glyph} from './draw';
import './platform.css';

export type PlatformIcon='quote'|'inbox'|'usercheck'|'sliders'|'filetext'|'appwindow'|'barchart'|'code';

const ICONS:Record<PlatformIcon,React.ReactNode>={
 quote:<>
  <D d="M3 21c3 0 7-1 7-8V5c0-1.25-.756-2.017-2-2H4c-1.25 0-2 .75-2 1.972V11c0 1.25.75 2 2 2 1 0 1 0 1 1v1c0 1-1 2-2 2s-1 .008-1 1.031V20c0 1 0 1 1 1z" c="w"/>
  <D d="M15 21c3 0 7-1 7-8V5c0-1.25-.757-2.017-2-2h-4c-1.25 0-2 .75-2 1.972V11c0 1.25.75 2 2 2h.75c0 2.25.25 4-2.75 4v3c0 1 0 1 1 1z" n={1} c="w"/>
 </>,
 inbox:<>
  <D d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"/>
  <D d="M22 12h-6l-2 3h-4l-2-3H2" n={1}/>
  <Dot x={12} y={8.5} c="h" r={1.4}/>
 </>,
 usercheck:<>
  <D d="M2 21a8 8 0 0 1 13.292-6"/>
  <D d="M15 8a5 5 0 1 1-10 0a5 5 0 1 1 10 0" n={1}/>
  <D d="m16 19 2 2 4-4" n={2} c="w"/>
 </>,
 sliders:<>
  <D d="M21 4h-7"/><D d="M10 4H3"/><D d="M21 12h-9" n={1}/><D d="M8 12H3" n={1}/><D d="M21 20h-5" n={2}/><D d="M12 20H3" n={2}/>
  <g className="a r"><D d="M14 2v4" n={3}/></g>
  <g className="a l"><D d="M8 10v4" n={3}/></g>
  <g className="a r"><D d="M16 18v4" n={3}/></g>
 </>,
 filetext:<>
  <D d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/>
  <D d="M14 2v4a2 2 0 0 0 2 2h4" n={1}/>
  <D d="M10 9H8" n={2} c="w"/><D d="M16 13H8" n={3} c="w"/><D d="M16 17H8" n={4} c="w"/>
 </>,
 appwindow:<>
  <D d="M4 4h16a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z"/>
  <D d="M2 8h20" n={1}/>
  <D d="M6 4v4" n={2} c="w"/><D d="M10 4v4" n={2} c="w"/>
  <Dot x={17} y={15} c="h" r={1.6}/>
 </>,
 barchart:<>
  <D d="M3 3v18h18"/>
  <D d="M8 17v-3" n={1} c="a"/><D d="M13 17V5" n={2} c="a"/><D d="M18 17V9" n={3} c="a"/>
 </>,
 code:<>
  <g className="a r"><D d="m16 18 6-6-6-6"/></g>
  <g className="a l"><D d="m8 6-6 6 6 6" n={1}/></g>
 </>,
};

export function PlatformGlyph({name,size=16}:{name:PlatformIcon;size?:number}){
 return <Glyph name={name} size={size} sw={2}>{ICONS[name]}</Glyph>;
}
/* Inline marks used inside the card visuals. */
export const CheckMark=({n=0}:{n?:number})=><Glyph name="tick" size={12} sw={3}><D d="M20 6 9 17l-5-5" n={n}/></Glyph>;
export const ClockMark=()=><Glyph name="clock" size={12} sw={2.4}><D d="M22 12a10 10 0 1 1-20 0a10 10 0 1 1 20 0"/><g className="hand"><D d="M12 6v6l4 2" n={1}/></g></Glyph>;
export const VerifiedMark=()=><Glyph name="verified" size={12} sw={2.4}><D d="M22 12a10 10 0 1 1-20 0a10 10 0 1 1 20 0"/><D d="m9 12 2 2 4-4" n={1}/></Glyph>;
