/* In-house SVG charts: line/area, sparkline, stacked bars, radial rings. Built from
   scratch - mebius.design freebies are purchase-licensed and bar public embedding, so
   NO code or assets were taken; only the chart-type vocabulary (line/area, rings,
   stacked bars, sparklines) is referenced. Real loaded-snapshot numbers only, never
   decorative fake data. CSS-only motion, replays on remount, reduced-motion safe. */

function smooth(pts:[number,number][]):string{
 if(!pts.length)return'';
 if(pts.length===1)return `M${pts[0][0]},${pts[0][1]} h0.1`;
 let d=`M${pts[0][0]},${pts[0][1]}`;
 for(let i=1;i<pts.length;i++){
  const [px,py]=pts[i-1],[cx,cy]=pts[i],dx=(cx-px)/3;
  d+=` C${px+dx},${py} ${cx-dx},${cy} ${cx},${cy}`;
 }
 return d;
}

const shortDay=(day:string)=>new Date(day+'T00:00:00Z').toLocaleDateString('en-US',{weekday:'short',timeZone:'UTC'});

export function LineArea({rows,primaryLabel,secondaryLabel,money}:{rows:{day:string,total:number,secondary?:number}[];primaryLabel:string;secondaryLabel?:string;money?:boolean}){
 const W=760,H=190,PT=18,PB=26;
 const hasSecond=secondaryLabel!=null;
 const max=Math.max(1,...rows.map(r=>Math.max(r.total,r.secondary??0)));
 const x=(i:number)=>rows.length===1?W/2:20+i*(W-40)/(rows.length-1);
 const y=(n:number)=>PT+(H-PT-PB)*(1-n/max);
 const pts=rows.map((r,i)=>[x(i),y(r.total)] as [number,number]);
 const pts2=hasSecond?rows.map((r,i)=>[x(i),y(r.secondary??0)] as [number,number]):[];
 const lineD=smooth(pts);
 const areaD=lineD+` L${x(rows.length-1)},${H-PB} L${x(0)},${H-PB} Z`;
 const peak=rows.reduce((a,b,i,arr)=>b.total>arr[a].total?i:a,0);
 const fmt=(n:number)=>money?`$${n.toFixed(2)}`:String(n);
 return <svg viewBox={`0 0 ${W} ${H}`} className="ap-chart" role="img" aria-label={`${primaryLabel} for the last ${rows.length} days. Highest day ${rows[peak].day} with ${fmt(rows[peak].total)}.`}>
  {[0.33,0.66].map(f=><line key={f} x1={20} x2={W-20} y1={PT+(H-PT-PB)*f} y2={PT+(H-PT-PB)*f} className="ap-line-grid"/>)}
  <path d={areaD} className="ap-line-area"/>
  {hasSecond&&<path d={smooth(pts2)} pathLength={1} className="ap-line-alt ap-line-draw"/>}
  <path d={lineD} pathLength={1} className="ap-line-main ap-line-draw"/>
  {pts.map((p,i)=><circle key={i} cx={p[0]} cy={p[1]} r={i===peak&&rows[peak].total>0?4.5:3} className={'ap-line-dot'+(i===peak&&rows[peak].total>0?' ap-line-dot-peak':'')}/>)}
  {rows.map((r,i)=>((i%Math.ceil(rows.length/6)===0)||i===rows.length-1)&&<text key={r.day} x={x(i)} y={H-8} textAnchor="middle" className="ap-chart-lab">{rows.length>10?r.day.slice(5):shortDay(r.day)}</text>)}
 </svg>;
}

export function Sparkline({values,label,alt}:{values:number[];label:string;alt?:boolean}){
 const W=96,H=30,P=3;
 const max=Math.max(1,...values);
 const x=(i:number)=>values.length===1?W/2:P+i*(W-2*P)/(values.length-1);
 const y=(n:number)=>P+(H-2*P)*(1-n/max);
 const pts=values.map((v,i)=>[x(i),y(v)] as [number,number]);
 const lineD=smooth(pts);
 const areaD=lineD+` L${x(values.length-1)},${H-P} L${x(0)},${H-P} Z`;
 return <svg viewBox={`0 0 ${W} ${H}`} className="ap-spark" role="img" aria-label={label}>
  <path d={areaD} className={'ap-spark-fill'+(alt?' ap-spark-fill-alt':'')}/>
  <path d={lineD} pathLength={1} className={'ap-spark-line ap-line-draw'+(alt?' ap-spark-alt':'')}/>
 </svg>;
}

export function StackedBars({rows,labels}:{rows:{day:string,segments:number[]}[];labels:string[]}){
 const W=760,H=210,PT=34,PB=30,bw=Math.min(34,(W-40)/rows.length-10);
 const max=Math.max(1,...rows.map(r=>r.segments.reduce((a,b)=>a+b,0)));
 const x=(i:number)=>20+i*((W-40)/rows.length)+((W-40)/rows.length-bw)/2;
 const h=(n:number)=>n/max*(H-PT-PB);
 const labelEvery=rows.length>10?Math.ceil(rows.length/6):1;
 const totals=rows.map(r=>r.segments.reduce((a,b)=>a+b,0));
 const busiest=rows.reduce((a,r,i)=>totals[i]>totals[a]?i:a,0);
 return <svg viewBox={`0 0 ${W} ${H}`} className="ap-chart" role="img" aria-label={`Stacked ${labels.join(' and ')} for the last ${rows.length} days. Busiest day ${rows[busiest].day} with ${totals[busiest]}.`}>
  {rows.map((r,i)=>{let base=0;return <g key={r.day}>
   {r.segments.map((v,si)=>{base+=v;const sh=Math.max(h(v),v>0?2:0);return v>0?<rect key={si} x={x(i)} y={H-PB-h(base)} width={bw} height={sh} rx={si===r.segments.length-1||!r.segments.slice(si+1).some(Boolean)?Math.min(9,bw/2):0} className={`ap-stack-seg ap-stack-${si}`} style={{animationDelay:Math.min(i*(rows.length>10?24:55)+si*70,700)+'ms'}}/>:null;})}
   {(i%labelEvery===0||i===rows.length-1)&&<text x={x(i)+bw/2} y={H-10} textAnchor="middle" className="ap-chart-lab">{rows.length>10?r.day.slice(5):shortDay(r.day)}</text>}
  </g>;})}
 </svg>;
}

export function RadialRings({rings}:{rings:{frac:number;label:string}[]}){
 const shown=rings.slice(0,3),C=(r:number)=>2*Math.PI*r;
 return <svg viewBox="0 0 120 120" width="112" height="112" role="img" aria-label={shown.map(r=>`${r.label} ${Math.round(Math.min(r.frac,1)*100)}% used`).join(', ')}>
  {shown.map((ring,i)=>{const R=46-i*13,len=Math.max(Math.min(ring.frac,1)*C(R)-1.5,0);return <g key={ring.label}>
   <circle cx="60" cy="60" r={R} className="ap-ring-track"/>
   {len>0&&<circle cx="60" cy="60" r={R} className={`ap-ring ap-ring-${i} ap-chart-sweep`} strokeDasharray={`${len} ${C(R)}`} style={{'--len':len,animationDelay:i*.18+'s'} as React.CSSProperties} transform="rotate(-90 60 60)"/>}
  </g>;})}
  <text x="60" y="65" textAnchor="middle" className="ap-chart-dnum">{Math.round(Math.min(shown[0]?.frac??0,1)*100)}%</text>
 </svg>;
}
