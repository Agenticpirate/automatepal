/* Animated line icons for the add-ons grid. Geometry from Lucide (ISC license, lucide.dev).
   Generic glyphs only: no third-party logos. Helpers come from draw.tsx (base styles and keyframes
   in draw.css). Classes, with add-on motion in addons.css:
   .d  stroked path, drawn on when the grid scrolls into view; --k orders strokes within one icon
   .p  filled dot, pops in after the strokes
   .a  the part that moves on card hover (each icon has its own motion)
   .w  secondary marks (bell waves, call waves) that redraw on hover
   .h  hover-only mark, hidden at rest */
import {D,Dot,Glyph} from './draw';

export type AddOnIcon='team'|'api'|'webhook'|'csv'|'lead'|'billing'|'email'|'digest'|'automation'|'channel'|'chat'|'helpdesk'|'ticket'|'inbox'|'messenger'|'whatsapp';

const ICONS:Record<AddOnIcon,React.ReactNode>={
 team:<>
  <D d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/>
  <D d="M13 7a4 4 0 1 1-8 0a4 4 0 1 1 8 0" n={1}/>
  <g className="a"><D d="M22 21v-2a4 4 0 0 0-3-3.87" n={2}/><D d="M16 3.13a4 4 0 0 1 0 7.75" n={3}/></g>
 </>,
 api:<>
  <g className="a l"><D d="m6 8-4 4 4 4"/></g>
  <g className="a r"><D d="m18 16 4-4-4-4" n={1}/></g>
  <D d="m14.5 4-5 16" n={2} c="w"/>
 </>,
 webhook:<>
  <D d="M18 16.98h-5.99c-1.1 0-1.95.94-2.48 1.9A4 4 0 0 1 2 17c.01-.7.2-1.4.57-2" c="w"/>
  <D d="m6 17 3.13-5.78c.53-.97.1-2.18-.5-3.1a4 4 0 1 1 6.89-4.06" n={1} c="w"/>
  <D d="m12 6 3.13 5.73C15.66 12.7 16.9 13 18 13a4 4 0 0 1 0 8" n={2} c="w"/>
 </>,
 csv:<>
  <D d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/>
  <D d="M14 2v4a2 2 0 0 0 2 2h4" n={1}/>
  <g className="a"><D d="M12 18v-6" n={2}/><D d="m9 15 3 3 3-3" n={3}/></g>
 </>,
 lead:<>
  <D d="M22 13V6a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2v12c0 1.1.9 2 2 2h8"/>
  <D d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7" n={1}/>
  <D d="m16 19 2 2 4-4" n={2} c="w"/>
 </>,
 billing:<>
  <D d="M4 2v20l2-1 2 1 2-1 2 1 2-1 2 1 2-1 2 1V2l-2 1-2-1-2 1-2-1-2 1-2-1-2 1Z"/>
  <D d="M16 8h-6a2 2 0 1 0 0 4h4a2 2 0 1 1 0 4H8" n={1} c="w"/>
  <D d="M12 17.5v-11" n={2} c="w"/>
 </>,
 email:<>
  <g className="a"><D d="M3.262 15.326A1 1 0 0 0 4 17h16a1 1 0 0 0 .74-1.673C19.41 13.956 18 12.499 18 8A6 6 0 0 0 6 8c0 4.499-1.411 5.956-2.738 7.326"/><D d="M10.268 21a2 2 0 0 0 3.464 0" n={1}/></g>
  <D d="M22 8c0-2.3-.8-4.3-2-6" n={2} c="w"/>
  <D d="M4 2C2.8 3.7 2 5.7 2 8" n={2} c="w"/>
 </>,
 digest:<>
  <D d="M8 2v4"/><D d="M16 2v4"/>
  <D d="M5 4h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z" n={1}/>
  <D d="M3 10h18" n={2}/>
  <Dot x={8} y={14} n={0}/><Dot x={12} y={14} n={1}/><Dot x={16} y={14} n={2}/>
  <Dot x={8} y={18} n={3}/><Dot x={12} y={18} n={4}/><Dot x={16} y={18} n={5}/>
 </>,
 automation:<>
  <D d="M5 3h4a2 2 0 0 1 2 2v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z"/>
  <D d="M7 11v4a2 2 0 0 0 2 2h4" n={1} c="w"/>
  <g className="a"><D d="M15 13h4a2 2 0 0 1 2 2v4a2 2 0 0 1-2 2h-4a2 2 0 0 1-2-2v-4a2 2 0 0 1 2-2z" n={2}/></g>
 </>,
 channel:<>
  <D d="M4 9h16" c="w"/><D d="M4 15h16" n={1} c="w"/><D d="M10 3 8 21" n={2} c="w"/><D d="M16 3l-2 18" n={3} c="w"/>
 </>,
 chat:<>
  <D d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
  <D d="M13 8H7" n={1} c="w"/><D d="M17 12H7" n={2} c="w"/>
 </>,
 helpdesk:<>
  <D d="M3 11h3a2 2 0 0 1 2 2v3a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-5Zm0 0a9 9 0 1 1 18 0m0 0v5a2 2 0 0 1-2 2h-1a2 2 0 0 1-2-2v-3a2 2 0 0 1 2-2h3Z"/>
  <D d="M21 16v2a4 4 0 0 1-4 4h-5" n={1} c="w"/>
 </>,
 ticket:<>
  <D d="M2 9a3 3 0 0 1 0 6v2a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-2a3 3 0 0 1 0-6V7a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2Z"/>
  <g className="a"><D d="M9 12h6" n={1}/><D d="M12 9v6" n={2}/></g>
 </>,
 inbox:<>
  <D d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"/>
  <D d="M22 12h-6l-2 3h-4l-2-3H2" n={1}/>
  <Dot x={12} y={8.5} c="h" r={1.3}/>
 </>,
 messenger:<>
  <D d="M7.9 20A9 9 0 1 0 4 16.1L2 22Z"/>
  <Dot x={8} y={12} n={0}/><Dot x={12} y={12} n={1}/><Dot x={16} y={12} n={2}/>
 </>,
 whatsapp:<>
  <g className="a"><D d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"/></g>
  <D d="M14.05 6A5 5 0 0 1 18 10" n={1} c="w"/>
  <D d="M14.05 2a9 9 0 0 1 8 7.94" n={2} c="w"/>
 </>,
};

export function AddOnGlyph({name}:{name:AddOnIcon}){
 return <Glyph name={name}>{ICONS[name]}</Glyph>;
}
