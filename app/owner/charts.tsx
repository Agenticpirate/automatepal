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
 return <svg viewBox={`0 0 ${W} ${H}`} className="ap-chart" role="img" aria-label={`Question volume for the last ${rows.length} days. Busiest day ${rows[peak].day} with ${rows[peak].total} ${rows[peak].total===1?'query':'queries'}.`}>
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

/* A3 admin dashboard pieces (Nov 1 2026). Own implementation of a common dashboard layout;
   no BoardUI code, CSS, markup or copy used. Real snapshot numbers only. */

export function DeltaChip({now,prev,lowerIsBetter,unit='%',points}:{now:number;prev:number|null;lowerIsBetter?:boolean;unit?:string;points?:boolean}){
 if(prev===null)return <span className="ap-od-delta ap-od-delta-na" title="Not enough earlier data in the loaded snapshot">no prior data</span>;
 if(!points&&prev===0)return <span className={'ap-od-delta '+(now>0?(lowerIsBetter?'ap-od-delta-bad':'ap-od-delta-good'):'ap-od-delta-flat')}>{now>0?'new':'no change'}</span>;
 const change=points?Math.round(now-prev):Math.round(100*(now-prev)/prev);
 const cls=change===0?'ap-od-delta-flat':(change>0)!==!!lowerIsBetter?'ap-od-delta-good':'ap-od-delta-bad';
 const sign=change>0?'+':change<0?'\u2212':'';
 return <span className={'ap-od-delta '+cls} aria-label={`${change===0?'No change':(change>0?'Up ':'Down ')+Math.abs(change)+(points?' points':' percent')} versus the previous period`}>{change>0?'\u2191':change<0?'\u2193':'\u2192'} {sign}{Math.abs(change)}{points?' pts':unit}</span>;
}

export function FunnelBars({steps,sides}:{steps:{label:string;value:number}[];sides:{label:string;value:number}[]}){
 const top=Math.max(1,steps[0]?.value??0);
 return <div className="ap-od-funnel">
  <ol aria-label="Conversation funnel">{steps.map((s,i)=>{const prev=i?steps[i-1].value:0,share=i?(prev?Math.round(100*s.value/prev):0):100;return <li key={s.label}>
   <div className="ap-od-funnel-head"><span>{s.label}</span><strong>{s.value.toLocaleString('en-US')}</strong></div>
   <div className="ap-od-funnel-track"><span className={'ap-od-funnel-bar ap-od-funnel-'+i} style={{width:`${Math.max(s.value?3:0,100*s.value/top)}%`,animationDelay:i*90+'ms'}}/></div>
   <small>{i?`${share}% of the previous step`:'Every conversation in this range'}</small>
  </li>;})}</ol>
  <ul className="ap-od-funnel-sides" aria-label="Other outcomes">{sides.map(s=><li key={s.label}><span>{s.label}</span><strong>{s.value.toLocaleString('en-US')}</strong></li>)}</ul>
 </div>;
}

const SEG_COLORS=['#041A52','#09318D','#FD91CC','#7D9BE0','#F7B8DB','#B8C2D9'];

export function CategoryDonut({parts,label}:{parts:{label:string;value:number}[];label:string}){
 const total=parts.reduce((n,p)=>n+p.value,0),R=44,C=2*Math.PI*R;let acc=0;
 const shown=parts.filter(p=>p.value>0);
 const top=shown.reduce<{label:string;value:number}|null>((a,b)=>!a||b.value>a.value?b:a,null);
 return <div className="ap-od-donut">
  <svg viewBox="0 0 120 120" width="132" height="132" role="img" aria-label={total?`${label}: `+shown.map(p=>`${p.label} ${p.value}`).join(', '):`${label}: no conversations in this range`}>
   <circle cx="60" cy="60" r={R} className="ap-chart-dtrack" style={{strokeWidth:14}}/>
   {total>0&&shown.map((p)=>{const i=parts.indexOf(p),len=Math.max(p.value/total*C-(shown.length>1?2:0),0),rot=acc/total*360-90;acc+=p.value;return <circle key={p.label} cx="60" cy="60" r={R} fill="none" stroke={SEG_COLORS[i%SEG_COLORS.length]} strokeWidth="14" strokeDasharray={`${len} ${C}`} transform={`rotate(${rot} 60 60)`} className="ap-chart-sweep" style={{'--len':len,animationDelay:i*.08+'s'} as React.CSSProperties}/>;})}
   <text x="60" y="58" textAnchor="middle" className="ap-chart-dnum" style={{fontSize:20}}>{total}</text>
   <text x="60" y="74" textAnchor="middle" className="ap-chart-lab" style={{opacity:1}}>total</text>
  </svg>
  <div>
   {top&&total>0&&<p className="ap-od-callout"><strong>{Math.round(100*top.value/total)}%</strong> {top.label.toLowerCase()}</p>}
   <ul className="ap-od-legend">{parts.map((p,i)=><li key={p.label}><i style={{background:SEG_COLORS[i%SEG_COLORS.length]}}/><span>{p.label}</span><strong>{p.value}</strong></li>)}</ul>
  </div>
 </div>;
}

export function SegmentBar({parts,label}:{parts:{label:string;value:number}[];label:string}){
 const total=parts.reduce((n,p)=>n+p.value,0);
 return <div className="ap-od-seg">
  <div className="ap-od-seg-bar" role="img" aria-label={total?`${label}: `+parts.map(p=>`${p.label} ${p.value}`).join(', '):`${label}: none`}>
   {total>0?parts.map((p,i)=>p.value>0&&<span key={p.label} style={{flexGrow:p.value,background:SEG_COLORS[i%SEG_COLORS.length],animationDelay:i*70+'ms'}}/>):<span className="ap-od-seg-empty"/>}
  </div>
  <ul className="ap-od-legend ap-od-legend-row">{parts.map((p,i)=><li key={p.label}><i style={{background:SEG_COLORS[i%SEG_COLORS.length]}}/><span>{p.label}</span><strong>{p.value}</strong></li>)}</ul>
 </div>;
}
