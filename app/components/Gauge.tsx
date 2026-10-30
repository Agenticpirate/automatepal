/* Reusable 40-tick semicircle gauge (Convix pattern). value 0-100. */
export default function Gauge({value,color='#FD91CC',label}:{value:number;color?:string;label:string}){
  const ticks=Array.from({length:40},(_,i)=>{
    const a=Math.PI+(i/39)*Math.PI;
    const active=i<Math.round(value/100*40);
    const r=80,cx=100,cy=100;
    const x1=cx+Math.cos(a)*(r-10),y1=cy+Math.sin(a)*(r-10);
    const x2=cx+Math.cos(a)*r,y2=cy+Math.sin(a)*r;
    return <line key={i} x1={x1} y1={y1} x2={x2} y2={y2} stroke={active?color:'#D8DEE9'} strokeWidth={2.5} strokeLinecap="round"/>;
  });
  return <div style={{width:'min(220px,60vw)',flexShrink:0}} role="img" aria-label={label}>
    <svg viewBox="0 0 200 120" style={{display:'block',width:'100%',height:'auto'}}>{ticks}<text x={100} y={110} textAnchor="middle" fontSize={22} fontWeight={600} fill="#0A1B3D">{value}%</text></svg>
  </div>;
}
