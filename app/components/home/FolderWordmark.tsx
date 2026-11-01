'use client';
import {useEffect,useRef,type CSSProperties} from 'react';
import './folder-wordmark.css';

/* Footer sign-off: "Automate Pal" spelled in a pixel font where every pixel is a folder
   (after Clicky's footer). Folders near the pointer tip their front flap forward and a sheet
   of paper rises out; they settle shut as the pointer moves on, leaving a short wake.
   Decorative, rare (bottom of the marketing page), so it gets the delight budget.
   Motion is CSS transitions on transform, driven by a data attribute per folder, so a folder
   the pointer re-enters retargets instead of restarting. JS only measures distance, once per
   frame, and only while a mouse or pen is over the mark; touch gets a short tap burst. */

/* 7-row pixel font. Capitals use rows 0-6, lowercase rows 2-6. */
const GLYPHS:Record<string,string[]>={
 A:['.###.','#...#','#...#','#####','#...#','#...#','#...#'],
 u:['.....','.....','#...#','#...#','#...#','#..##','.##.#'],
 t:['.#..','.#..','####','.#..','.#..','.#..','..##'],
 o:['.....','.....','.###.','#...#','#...#','#...#','.###.'],
 m:['.......','.......','######.','#..#..#','#..#..#','#..#..#','#..#..#'],
 a:['.....','.....','.###.','....#','.####','#...#','.####'],
 e:['.....','.....','.###.','#...#','#####','#....','.###.'],
 P:['####.','#...#','#...#','####.','#....','#....','#....'],
 l:['##.','.#.','.#.','.#.','.#.','.#.','.##'],
};
const WORD='Automate Pal';
const ROWS=7;
/* Folder size in grid cells. Wider than a cell so neighbours overlap like a crowded desktop. */
const FW=1.6,FH=1.25;
/* Pointer reach, in cells. */
const REACH=2.3;

type Folder={x:number;y:number};
function layout(){
 const out:Folder[]=[];let col=0;
 for(const ch of WORD){
  if(ch===' '){col+=1;continue;}
  const g=GLYPHS[ch];
  g.forEach((row,y)=>[...row].forEach((px,x)=>{if(px==='#')out.push({x:col+x,y});}));
  col+=g[0].length+1;
 }
 const cols=col-1;
 /* Small fixed jitter so the grid reads hand-placed. Integer hash, so every JS engine
    (server and browser) produces the same layout. */
 const j=(n:number)=>((Math.imul(n+1,2654435761)>>>0)%1000)/1000-.5;
 const folders=out
  .map((f,i)=>({x:f.x+j(i)*.14,y:f.y+j(i+97)*.1}))
  /* Lower rows paint over upper ones, so each folder's tab sits on the one above it. */
  .sort((a,b)=>Math.round(a.y)-Math.round(b.y)||a.x-b.x);
 return {folders,span:cols+FW-1+.1,height:ROWS+FH-1+.1};
}
const {folders:FOLDERS,span:SPAN,height:HEIGHT}=layout();
/* Rounded so the style string the server sends is the one the browser keeps. */
const pct=(v:number)=>`${Math.round(v*1e5)/1e3}%`;

export default function FolderWordmark(){
 const ref=useRef<HTMLDivElement>(null);
 useEffect(()=>{
  const mark=ref.current;if(!mark)return;
  const els=[...mark.querySelectorAll<HTMLElement>('.fw-f')];
  const open=new Array<boolean>(els.length).fill(false);
  let frame=0,px=0,py=0,active=false,tapTimer=0;
  const apply=()=>{
   frame=0;
   const r=mark.getBoundingClientRect(),u=r.width/SPAN;
   const cx=(px-r.left)/u,cy=(py-r.top)/u,reach2=REACH*REACH;
   for(let i=0;i<els.length;i++){
    const f=FOLDERS[i],dx=f.x+FW/2-cx,dy=f.y+FH/2-cy;
    const next=active&&dx*dx+dy*dy<reach2;
    if(next!==open[i]){open[i]=next;if(next)els[i].dataset.open='';else delete els[i].dataset.open;}
   }
  };
  const queue=(e:PointerEvent,on:boolean)=>{px=e.clientX;py=e.clientY;active=on;if(!frame)frame=requestAnimationFrame(apply);};
  const move=(e:PointerEvent)=>{if(e.pointerType!=='touch')queue(e,true);};
  const leave=(e:PointerEvent)=>{if(e.pointerType!=='touch')queue(e,false);};
  /* Touch has no hover: a tap opens the folders under the finger, then lets them close. */
  const tap=(e:PointerEvent)=>{
   if(e.pointerType!=='touch')return;
   queue(e,true);clearTimeout(tapTimer);
   tapTimer=window.setTimeout(()=>{active=false;if(!frame)frame=requestAnimationFrame(apply);},650);
  };
  mark.addEventListener('pointermove',move,{passive:true});
  mark.addEventListener('pointerleave',leave,{passive:true});
  mark.addEventListener('pointerdown',tap,{passive:true});
  return()=>{
   mark.removeEventListener('pointermove',move);
   mark.removeEventListener('pointerleave',leave);
   mark.removeEventListener('pointerdown',tap);
   cancelAnimationFrame(frame);clearTimeout(tapTimer);
  };
 },[]);
 return <div ref={ref} className="fw-mark" role="img" aria-label="AutomatePal" style={{'--fw-span':SPAN,'--fw-w':FW,'--fw-h':FH,aspectRatio:`${SPAN} / ${HEIGHT}`} as CSSProperties}>
  {FOLDERS.map((f,i)=><span key={i} className="fw-f" style={{left:pct(f.x/SPAN),top:pct(f.y/HEIGHT)}}><i className="fw-p"/><i className="fw-fr"/></span>)}
 </div>;
}
