/* In-house SVG charts for the owner overview. Style referenced from mebius.design freebies
   (their license is purchase-based and bars redistribution/public embedding, so NO code or
   assets were taken - geometry and layout built from scratch). Real snapshot numbers only.
   Motion: CSS-only, replays on remount (keyed by the 7/30 window), reduced-motion safe. */

export function TrendChart({rows}:{rows:{day:string,total:number,unanswered:number}[]}){
 const W=760,H=210,PT=34,PB=30,bw=Math.min(34,(W-40)/rows.length-10);
 const max=Math.max(1,...rows.map(r=>r.total));
 const peak=rows.reduce((a,b,i,arr)=>b.total>arr[a].total?i:a,0);
 const x=(i:number)=>20+i*((W-40)/rows.length)+((W-40)/rows.length-bw)/2;
 const h=(n:number)=>n/max*(H-PT-PB);
 const peakY=H-PB-h(rows[peak].total);
 const short=(day:string)=>new Date(day+'T00:00:00Z').toLocaleDateString('en-US',{weekday:'short',timeZone:'UTC'});
 const labelEvery=rows.length>10?Math.ceil(rows.length/6):1;
 const barDelay=(i:number)=>Math.min(i*(rows.length>10?24:55),600);
 return <svg viewBox={`0 0 ${W} ${H}`} className="ap-chart" role="img" aria-label={`Question volume for the last ${rows.length} days. Busiest day ${rows[peak].day} with ${rows[peak].total} queries.`}>
  {rows[peak].total>0&&<>
   <line x1={20} x2={W-20} y1={peakY} y2={peakY} className="ap-chart-guide"/>
   <g className="ap-chart-chip"><rect x={Math.min(Math.max(x(peak)+bw/2-86,20),W-220)} y={Math.max(peakY-36,4)} width="200" height="30" rx="15"/><text x={Math.min(Math.max(x(peak)+bw/2+14,106),W-120)} y={Math.max(peakY-16,24)} textAnchor="middle">{rows[peak].day.slice(5)} · {rows[peak].total} {rows[peak].total===1?'query':'queries'}</text></g>
  </>}
  {rows.map((r,i)=>{const bh=Math.max(h(r.total),3),uh=r.unanswered?Math.max(h(r.unanswered),0):0;return <g key={r.day}>
   <rect x={x(i)} y={H-PB-bh} width={bw} height={bh} rx={Math.min(9,bw/2)} className={'ap-chart-bar'+(i===peak&&r.total>0?' ap-chart-bar-peak':'')} style={{animationDelay:barDelay(i)+'ms'}}/>
   {uh>0&&<rect x={x(i)} y={H-PB-bh} width={bw} height={Math.min(uh,bh)} rx={Math.min(9,bw/2)} className="ap-chart-bar-un" style={{animationDelay:barDelay(i)+70+'ms'}}/>}
   {(i%labelEvery===0||i===rows.length-1)&&<text x={x(i)+bw/2} y={H-10} textAnchor="middle" className="ap-chart-lab">{rows.length>10?r.day.slice(5):short(r.day)}</text>}
  </g>;})}
 </svg>;
}

export function SplitDonut({answered,unanswered}:{answered:number,unanswered:number}){
 const total=answered+unanswered,R=30,C=2*Math.PI*R;
 const aFrac=total?answered/total:0,uFrac=total?unanswered/total:0;
 const aLen=Math.max(aFrac*C-1.5,0),uLen=Math.max(uFrac*C-1.5,0);
 return <svg viewBox="0 0 72 72" width="64" height="64" role="img" aria-label={total?`${answered} of ${total} questions answered, ${unanswered} unanswered`:'No questions in this window'}>
  <circle cx="36" cy="36" r={R} className="ap-chart-dtrack"/>
  {total>0&&<>
   {answered>0&&<circle cx="36" cy="36" r={R} className="ap-chart-danswered ap-chart-sweep" strokeDasharray={`${aLen} ${C}`} style={{'--len':aLen} as React.CSSProperties} transform="rotate(-90 36 36)"/>}
   {unanswered>0&&<circle cx="36" cy="36" r={R} className="ap-chart-dun ap-chart-sweep" strokeDasharray={`${uLen} ${C}`} style={{'--len':uLen,animationDelay:'.35s'} as React.CSSProperties} transform={`rotate(${aFrac*360-90} 36 36)`}/>}
  </>}
  <text x="36" y="40" textAnchor="middle" className="ap-chart-dnum">{total}</text>
 </svg>;
}

export function UsageRing({used,limit,label}:{used:number,limit:number,label:string}){
 const R=30,C=2*Math.PI*R,frac=Math.min(limit>0?used/limit:0,1),len=Math.max(frac*C-1.5,0);
 return <svg viewBox="0 0 72 72" width="52" height="52" role="img" aria-label={`${label}: ${used} of ${limit} used`}>
  <circle cx="36" cy="36" r={R} className="ap-chart-dtrack"/>
  {len>0&&<circle cx="36" cy="36" r={R} className="ap-chart-danswered ap-chart-sweep" strokeDasharray={`${len} ${C}`} style={{'--len':len} as React.CSSProperties} transform="rotate(-90 36 36)"/>}
  <text x="36" y="40" textAnchor="middle" className="ap-chart-dnum" style={{fontSize:15}}>{Math.round(frac*100)}%</text>
 </svg>;
}
