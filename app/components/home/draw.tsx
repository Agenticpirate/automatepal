/* Shared primitives for the home page's draw-on line icons (Lottie-style, no runtime).
   Every stroke uses pathLength=1 so CSS can draw it on with stroke-dashoffset 1 -> 0.
   Classes (styled in draw.css): .d stroked path (--k orders strokes within an icon),
   .p filled dot, .h hover-only mark hidden at rest, .a / .w parts a section animates. */
import type {CSSProperties,ReactNode} from 'react';
import './draw.css';

const k=(n:number)=>({'--k':n} as CSSProperties);
export function D({d,n=0,c=''}:{d:string;n?:number;c?:string}){return <path d={d} pathLength={1} className={'d'+(c?' '+c:'')} style={k(n)}/>;}
export function Dot({x,y,n=0,c='p',r=1}:{x:number;y:number;n?:number;c?:string;r?:number}){return <circle cx={x} cy={y} r={r} className={c} style={k(n)}/>;}
export function Glyph({name,size=20,sw,children}:{name?:string;size?:number;sw?:number;children:ReactNode}){
 return <svg className="hm-ico" data-ico={name} viewBox="0 0 24 24" width={size} height={size} style={sw?{strokeWidth:sw}:undefined} aria-hidden="true" focusable="false">{children}</svg>;
}
