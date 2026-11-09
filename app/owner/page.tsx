'use client';
import {modeText} from '../../lib/app-mode';
/* Owner overview, A3 layout (Nov 1 2026): KPI row with period-over-period change, funnel,
   category donut, question trend, status split, budget, knowledge gaps and a searchable,
   paged conversations/questions table. Own implementation of a common admin-dashboard layout;
   no BoardUI code, CSS, markup, copy or numbers used. Real loaded-snapshot data only. */
import DeskShell from '../components/DeskShell';
import DashShell,{DashNotif,DIcon} from '../components/DashShell';
import Gauge from '../components/Gauge';
import {DeltaChip,FunnelBars,CategoryDonut,SegmentBar} from './charts';
import {LineArea,Sparkline,RadialRings} from '../components/charts';
import {useEffect,useMemo,useState} from 'react';
import Link from 'next/link';
import {authHeaders} from '../../lib/browser-auth';
import Alerts from './alerts';
import EmailSettings from './email-settings';
import SlackSettings from './slack-settings';
import PushSettings from './push-settings';
import InsightTopics from './insight-topics';
import {ticketLabel} from '../../lib/tickets';
import {unansweredCsv,downloadCsv} from '../../lib/exports';
import {clusterQuestions} from '../../lib/cluster';
import './owner-dash.css';
import {BotFilter,useBotFilter,withBot} from '../components/BotPicker';

type Ticket={id:string;created_at:string;order_label:string;inbox_state:string;ticket_status:string;priority:string;category:string;assigned_to_owner:boolean};
type Query={id:string;case_id:string;created_at:string;question:string;supported:boolean;feedback:number|null};
type Req={id:string;case_id:string;created_at:string;kind:string;status:string};
type Insight={case_id:string;topic:string;sentiment:'positive'|'neutral'|'negative';outcome:'resolved'|'unresolved'|'escalated';labeled_at:string};
type Open={case_id:string;day:string;source:string;opens:number};
type Data={insights?:Insight[];opens?:Open[];insightSettings?:{topics:string[]|null;enabled:boolean};asOf:string;tickets:Ticket[];queries:Query[];requests:Req[];usage:{utcDay:string;answersToday:number;dailyLimit:number;sources:number;sourceLimit:number;pageUnits:number;pageLimit:number;plan?:string;monthUsed?:number;monthLimit?:number};truncated:Record<string,boolean>;coverage:string};
type Range=7|30|90;
const DAY=86400000,PAGE=10;
const STATUS_ORDER=['new','open','in_progress','pending','resolved','closed'];
const nice=(s:string)=>{const t=(s||'general').replace(/_/g,' ');return t.charAt(0).toUpperCase()+t.slice(1);};
function countBy<T>(items:T[],key:(x:T)=>string,order:string[]=[]){const m=new Map<string,number>();for(const x of items){const k=key(x)||'general';m.set(k,(m.get(k)??0)+1);}const rank=(k:string)=>{const i=order.indexOf(k);return i<0?order.length:i;};return [...m.entries()].sort((a,b)=>rank(a[0])-rank(b[0])||b[1]-a[1]).map(([k,value])=>({key:k,label:nice(k),value}));}

/* Opens the custom-response form on Knowledge with the question filled in. */
const answerHref=(q:string)=>'/knowledge?answer='+encodeURIComponent(q.slice(0,300))+'#custom-responses';
const needsAttention=(t:Ticket)=>!['resolved','closed'].includes(t.ticket_status)&&(t.inbox_state==='attention'||['high','urgent'].includes(t.priority)||['refund','handoff'].includes(t.category));

function buildNotifs(d:Data):DashNotif[]{
 const out:DashNotif[]=[];
 for(const t of d.tickets)if(needsAttention(t))out.push({id:'t-'+t.id,kind:'error',title:'Ticket needs intervention',body:`${ticketLabel(t.id)} · ${t.order_label} · ${t.ticket_status} / ${t.priority} / ${t.category}`,ts:t.created_at});
 for(const r of d.requests)if(r.status==='pending_review')out.push({id:'r-'+r.id,kind:'info',title:r.kind==='refund_request'?'Refund review pending':r.kind==='human_handoff'?'Human handoff pending':'Review request pending',body:`${r.case_id?ticketLabel(r.case_id):'Demo request'} · ${(r.kind??'review_request').replace(/_/g,' ')}`,ts:r.created_at});
 for(const q of d.queries){
  if(q.feedback===-1)out.push({id:'q-'+q.id,kind:'error',title:'Negative feedback on an answer',body:q.question.slice(0,140),ts:q.created_at});
  else if(!q.supported)out.push({id:'q-'+q.id,kind:'info',title:'Unanswered question',body:q.question.slice(0,140),ts:q.created_at});
  else out.push({id:'q-'+q.id,kind:'success',title:'Answered from sources',body:q.question.slice(0,140),ts:q.created_at});
 }
 return out.sort((a,b)=>Date.parse(b.ts)-Date.parse(a.ts)).slice(0,25);
}

function inWindow<T extends {created_at:string}>(items:T[],from:number,to:number){return items.filter(x=>{const t=Date.parse(x.created_at);return t>=from&&t<to;});}

export default function Owner(){const botFilter=useBotFilter();
 const[d,setD]=useState<Data|null>(null),[notice,setNotice]=useState('Loading owner overview...'),[days,setDays]=useState<Range>(7),[q,setQ]=useState('');
 const[tab,setTab]=useState<'conversations'|'questions'>('conversations'),[donut,setDonut]=useState<'topics'|'category'>('topics'),[status,setStatus]=useState('all'),[page,setPage]=useState(0);
 function read(){authHeaders().then(headers=>fetch(withBot('/api/owner-overview',botFilter),{headers})).then(r=>r.json()).then(x=>{if(x.error)throw Error(x.error);setD(x);setNotice('Snapshot '+x.asOf);}).catch(()=>{setD(null);setNotice('Overview unavailable. Sign in or retry when the service recovers.');});}
 // read() always uses the current bot filter; reload when the filter changes.
 // eslint-disable-next-line react-hooks/exhaustive-deps
 useEffect(()=>{read();},[botFilter]);

 const v=useMemo(()=>{
  if(!d)return null;
  const end=Date.parse(d.asOf)+1,start=end-days*DAY,prevStart=start-days*DAY;
  const oldest=Math.min(...[...d.queries,...d.tickets,...d.requests].map(x=>Date.parse(x.created_at)),end);
  const anyTruncated=Object.values(d.truncated??{}).some(Boolean);
  const hasPrev=!anyTruncated||oldest<=prevStart;
  const cur={q:inWindow(d.queries,start,end),t:inWindow(d.tickets,start,end),r:inWindow(d.requests,start,end)};
  const prv={q:inWindow(d.queries,prevStart,start),t:inWindow(d.tickets,prevStart,start),r:inWindow(d.requests,prevStart,start)};
  const convos=(w:typeof cur)=>new Set([...w.q.map(x=>x.case_id),...w.t.map(x=>x.id)].filter(Boolean)).size;
  const rate=(qs:Query[])=>qs.length?Math.round(100*qs.filter(x=>x.supported).length/qs.length):0;
  const kind=(rs:Req[],k:string)=>rs.filter(r=>r.kind===k).length;
  const dayList=Array.from({length:days},(_,i)=>new Date(end-1-(days-1-i)*DAY).toISOString().slice(0,10));
  const perDay=<T extends {created_at:string}>(items:T[],keep:(x:T)=>boolean=()=>true)=>dayList.map(day=>items.filter(x=>keep(x)&&x.created_at.startsWith(day)).length);
  const trend=dayList.map(day=>{const qs=cur.q.filter(x=>x.created_at.startsWith(day));return {day,total:qs.length,answered:qs.filter(x=>x.supported).length,unanswered:qs.filter(x=>!x.supported).length};});
  const casesWith=(qs:Query[],keep:(x:Query)=>boolean)=>new Set(qs.filter(keep).map(x=>x.case_id)).size;
  const casesReq=(k:string)=>new Set(cur.r.filter(r=>r.kind===k).map(r=>r.case_id)).size;
  const kpis=[
   {label:'Conversations',icon:'widget' as const,value:String(convos(cur)),now:convos(cur),prev:hasPrev?convos(prv):null,series:dayList.map(day=>new Set([...cur.q.filter(x=>x.created_at.startsWith(day)).map(x=>x.case_id),...cur.t.filter(x=>x.created_at.startsWith(day)).map(x=>x.id)]).size)},
   {label:'AI-answered rate',icon:'info' as const,value:cur.q.length?rate(cur.q)+'%':'No questions',now:rate(cur.q),prev:hasPrev&&prv.q.length&&cur.q.length?rate(prv.q):null,points:true,series:trend.map(r=>r.answered)},
   {label:'Handoffs to a person',icon:'tickets' as const,value:String(kind(cur.r,'human_handoff')),now:kind(cur.r,'human_handoff'),prev:hasPrev?kind(prv.r,'human_handoff'):null,lowerIsBetter:true,series:perDay(cur.r,r=>r.kind==='human_handoff')},
   {label:'Leads captured',icon:'status' as const,value:String(kind(cur.r,'lead_callback')),now:kind(cur.r,'lead_callback'),prev:hasPrev?kind(prv.r,'lead_callback'):null,series:perDay(cur.r,r=>r.kind==='lead_callback')},
  ];
  /* Widget opens (db/051) and AI labels for conversations active in this range. */
  const startDay=new Date(start).toISOString().slice(0,10);
  const openedCases=new Set((d.opens??[]).filter(o=>o.day>=startDay).map(o=>o.case_id));
  const activeCases=new Set([...cur.q.map(x=>x.case_id),...cur.t.map(x=>x.id),...openedCases]);
  const labels=(d.insights??[]).filter(x=>activeCases.has(x.case_id));
  const topics=countBy(labels,x=>x.topic).map(p=>({...p,label:p.key==='other'?'Other':p.key}));
  const sentiments=['positive','neutral','negative'].map(k=>({key:k,label:nice(k),value:labels.filter(x=>x.sentiment===k).length}));
  const outcomes=['resolved','unresolved','escalated'].map(k=>({key:k,label:nice(k),value:labels.filter(x=>x.outcome===k).length}));
  const funnel={steps:[
   openedCases.size?{label:'Widget opened',value:Math.max(openedCases.size,casesWith(cur.q,()=>true))}:{label:'Conversations',value:convos(cur)},
   {label:'Asked a question',value:casesWith(cur.q,()=>true)},
   {label:'Got a sourced answer',value:casesWith(cur.q,x=>x.supported)},
   {label:'Rated helpful',value:casesWith(cur.q,x=>x.feedback===1)},
  ],sides:[{label:'Asked for a person',value:casesReq('human_handoff')},{label:'Left contact details',value:casesReq('lead_callback')},{label:'Refund review requested',value:casesReq('refund_request')}]};
  const byCat=countBy(cur.t,t=>t.category),categories=byCat.length>6?[...byCat.slice(0,5),{key:'other',label:'Other',value:byCat.slice(5).reduce((n,p)=>n+p.value,0)}]:byCat;
  const statuses=countBy(d.tickets,t=>t.ticket_status,STATUS_ORDER);
  const week={answered:cur.q.filter(x=>x.supported).length,unanswered:cur.q.filter(x=>!x.supported).length,reviews:cur.r.length,leads:kind(cur.r,'lead_callback'),rated:cur.q.filter(x=>x.feedback===1||x.feedback===-1).length,helpful:cur.q.filter(x=>x.feedback===1).length,total:cur.q.length};
  const prevTotal=prv.q.length;
  return {kpis,funnel,opensRecorded:openedCases.size>0,topics,sentiments,outcomes,labeled:labels.length,categories,statuses,trend,week,prevTotal,hasPrev,attention:d.tickets.filter(needsAttention),themes:clusterQuestions(d.queries.filter(x=>!x.supported)),queue:{refunds:d.requests.filter(r=>r.status==='pending_review'&&r.kind==='refund_request').length,taken:d.tickets.filter(t=>t.inbox_state==='taken_over').length,unassigned:d.tickets.filter(t=>!t.assigned_to_owner&&!['closed','resolved'].includes(t.ticket_status)).length,negative:d.queries.filter(x=>x.feedback===-1).length}};
 },[d,days]);

 const needle=q.trim().toLowerCase(),match=(...s:string[])=>!needle||s.join(' ').toLowerCase().includes(needle);
 const rows=useMemo(()=>{
  if(!d)return [];
  if(tab==='conversations')return d.tickets.filter(t=>(status==='all'||t.ticket_status===status)&&match(t.id,ticketLabel(t.id),t.order_label,t.ticket_status,t.priority,t.category));
  return d.queries.filter(x=>(status==='all'||(status==='answered'?x.supported:!x.supported))&&match(x.question,x.case_id,ticketLabel(x.case_id)));
 // eslint-disable-next-line react-hooks/exhaustive-deps
 },[d,tab,status,needle]);
 const pages=Math.max(1,Math.ceil(rows.length/PAGE)),cur=Math.min(page,pages-1),shown=rows.slice(cur*PAGE,cur*PAGE+PAGE);
 const pct=d?d.usage.monthLimit?Math.min(100,Math.round(100*(d.usage.monthUsed??0)/d.usage.monthLimit)):d.usage.dailyLimit>0?Math.min(100,Math.round(100*d.usage.answersToday/d.usage.dailyLimit)):0:0;
 const fmtDate=(s:string)=>new Date(s).toLocaleDateString('en-US',{month:'short',day:'2-digit',year:'numeric',timeZone:'UTC'});

 return <DeskShell widget><DashShell crumb="Overview" notifications={d?buildNotifs(d):[]} search={q} onSearch={s=>{setQ(s);setPage(0);}}><main className="ap-dash-headrow" style={{display:'contents'}}>
 <header className="ap-od-head">
  <div>
   <p className="ap-dash-kicker">{modeText('Owner overview / fictional data','Owner overview')}</p>
   <h1 className="ap-dash-h1"><span className="ap-dash-ln"><span>Know what needs you.</span></span></h1>
   <p className="ap-dash-sub">A private snapshot of your conversations, answers, queue and budget. Nothing here sends a customer reply or moves money.</p>
  </div>
  <div className="ap-od-actions">
   <span className="ap-dash-toggle" role="group" aria-label="Date range">{([7,30,90] as const).map(n=><button key={n} aria-pressed={days===n} onClick={()=>{setDays(n);setPage(0);}}>{n} days</button>)}</span>
   <BotFilter/>
   <button onClick={read} className="ap-dash-btn"><DIcon name="refresh" size={13}/>Refresh snapshot</button>
  </div>
  <p role="status" className="ap-dash-muted ap-od-notice">{notice}</p>
 </header>
 {d&&v&&<>
 <div className="ap-dash-card ap-od-strip">
  <p className="ap-dash-muted" style={{margin:0}}>Last {days} days (from the loaded snapshot): <strong>{v.week.answered} answered</strong> · <strong>{v.week.unanswered} unanswered</strong> · <strong>{v.week.reviews} review requests</strong> ({v.week.leads} follow-ups) · {v.week.total?Math.round(100*v.week.answered/v.week.total)+'% answered':'no questions yet'} · {v.week.rated?Math.round(100*v.week.helpful/v.week.rated)+'% of '+v.week.rated+' ratings helpful':'no ratings yet'}</p>
 </div>

 <section className="ap-dash-kpis ap-od-kpis" aria-label="Key numbers">{v.kpis.map((k,i)=><article key={k.label} className="ap-dash-kpi ap-od-kpi" style={{animationDelay:`${.06*i}s`}}>
  <h3><DIcon name={k.icon} size={13}/>{k.label}</h3>
  <p>{k.value}</p>
  <div className="ap-od-kpi-foot"><DeltaChip now={k.now} prev={k.prev} lowerIsBetter={k.lowerIsBetter} points={k.points}/><Sparkline key={'s'+days} values={k.series} alt={k.lowerIsBetter} label={`${k.label} per day over the last ${days} days`}/></div>
 </article>)}</section>
 <p className="ap-dash-muted ap-od-coverage">Change compares with the {days} days before. {v.hasPrev?'':'The loaded snapshot does not reach back far enough for every comparison. '}{d.coverage}{Object.values(d.truncated).some(Boolean)&&' One or more lists are truncated.'}</p>

 <div className="ap-od-grid">
  <section className="ap-dash-card ap-od-span2">
   <div className="ap-od-cardhead"><h2 className="ap-dash-h2">Conversation funnel</h2><span className="ap-dash-badge ap-dash-b-mut">{days} days</span></div>
   <p className="ap-dash-muted ap-od-desc">How far conversations got. Each step counts conversations, not messages.{v.opensRecorded?' Widget opened counts conversations whose widget or help page was opened in this range.':' Widget opens are counted from now on; none are recorded in this range yet.'}</p>
   {v.funnel.steps[0].value?<FunnelBars steps={v.funnel.steps} sides={v.funnel.sides}/>:<p className="ap-dash-empty ap-od-empty">Not enough data yet. Conversations in this range will show here.</p>}
  </section>
  <section className="ap-dash-card">
   <div className="ap-od-cardhead"><h2 className="ap-dash-h2">{v.topics.length&&donut==='topics'?'Conversation topics':'Tickets by category'}</h2>{v.topics.length>0&&<span className="ap-dash-toggle" role="group" aria-label="Breakdown"><button aria-pressed={donut==='topics'} onClick={()=>setDonut('topics')}>AI topics</button><button aria-pressed={donut==='category'} onClick={()=>setDonut('category')}>Ticket category</button></span>}</div>
   {v.topics.length&&donut==='topics'?<>
    <p className="ap-dash-muted ap-od-desc">Topics an AI model gave {v.labeled} conversation{v.labeled===1?'':'s'} in this range, from your topic list. Labels can be wrong; they are for trends, not decisions.</p>
    <CategoryDonut parts={v.topics.length>6?[...v.topics.slice(0,5),{key:'rest',label:'Other topics',value:v.topics.slice(5).reduce((n,p)=>n+p.value,0)}]:v.topics} label="Conversation topics"/>
    <p className="ap-dash-muted" style={{margin:'10px 0 4px'}}>Sentiment</p><SegmentBar parts={v.sentiments} label="Conversation sentiment"/>
    <p className="ap-dash-muted" style={{margin:'10px 0 4px'}}>Outcome</p><SegmentBar parts={v.outcomes} label="Conversation outcome"/>
   </>:<>
   <p className="ap-dash-muted ap-od-desc">Tickets opened in this range, by the category the escalation rules set.{v.topics.length?'':' AI topics appear here once conversations are labelled.'}</p>
   {v.categories.length?<CategoryDonut parts={v.categories} label="Tickets by category"/>:<p className="ap-dash-empty ap-od-empty">No tickets opened in this range.</p>}</>}
  </section>

  <section className="ap-dash-card ap-od-span2">
   <div className="ap-od-cardhead"><h2 className="ap-dash-h2">Question trend</h2><span className="ap-od-total"><strong>{v.week.total}</strong> questions{v.hasPrev&&<> <DeltaChip now={v.week.total} prev={v.prevTotal}/></>}</span></div>
   <p className="ap-dash-muted ap-od-desc">{days} UTC days, loaded rows only. Blue is every question, pink is the ones answered from your sources.</p>
   <LineArea key={'flow'+days} rows={v.trend.map(r=>({day:r.day,total:r.total,secondary:r.answered}))} primaryLabel="Questions per day" secondaryLabel="Answered per day"/>
   <div className="ap-od-legend ap-od-legend-row ap-od-linelegend"><span><i style={{background:'#09318D'}}/>All questions</span><span><i style={{background:'#FD91CC'}}/>Answered from sources</span></div>
   <details className="ap-od-details"><summary>Daily rows</summary>
    <ol className="ap-dash-trend">{v.trend.map(r=><li key={r.day} className="ap-dash-row" style={{flexDirection:'row',justifyContent:'space-between'}}><span>{r.day}</span><span>{r.total} {r.total===1?'query':'queries'} · {r.unanswered} unanswered</span></li>)}</ol>
   </details>
  </section>
  <section className="ap-dash-card">
   <div className="ap-od-cardhead"><h2 className="ap-dash-h2">{d.usage.monthLimit?'Plan usage':'Preview budget'}</h2></div>
   <div className="ap-od-budget"><Gauge value={pct} color="#09318D" label={`${pct} percent of ${d.usage.monthLimit?'this month\'s AI answers':'today\'s answer attempt limit'} used`}/><RadialRings rings={[{frac:d.usage.monthLimit?d.usage.monthUsed!/d.usage.monthLimit:d.usage.dailyLimit>0?d.usage.answersToday/d.usage.dailyLimit:0,label:'answers'},{frac:d.usage.sourceLimit>0?d.usage.sources/d.usage.sourceLimit:0,label:'sources'},{frac:d.usage.pageLimit>0?d.usage.pageUnits/d.usage.pageLimit:0,label:'page units'}]}/></div>
   <p className="ap-dash-sub" style={{margin:'10px 0 0'}}>{d.usage.monthLimit?<>{d.usage.monthUsed}/{d.usage.monthLimit} AI answers this month ({d.usage.plan} plan)</>:<>{d.usage.answersToday}/{d.usage.dailyLimit} answer attempts on {d.usage.utcDay} UTC</>}</p>
   <p className="ap-dash-sub" style={{margin:'4px 0 0'}}>{d.usage.sources}/{d.usage.sourceLimit} sources · {d.usage.pageUnits}/{d.usage.pageLimit} page units</p>
   <p className="ap-dash-muted" style={{marginTop:8}}>Rings show answers, sources and page units from the outside in. Refused and unsupported questions count too.{d.usage.monthLimit?' Limits come from your plan; see the Plan page.':' Limits are not paid entitlements.'}</p>
  </section>

  <section className="ap-dash-card">
   <div className="ap-od-cardhead"><h2 className="ap-dash-h2">Ticket status</h2><span className="ap-od-total"><strong>{d.tickets.length}</strong> loaded</span></div>
   <p className="ap-dash-muted ap-od-desc">Every loaded ticket by its current status.</p>
   <SegmentBar parts={v.statuses} label="Tickets by status"/>
   <ul className="ap-od-queue" aria-label="Queue">
    <li><span>Refund reviews pending</span><strong>{v.queue.refunds}</strong></li>
    <li><span>Taken over by a person</span><strong>{v.queue.taken}</strong></li>
    <li><span>Unassigned and open</span><strong>{v.queue.unassigned}</strong></li>
    <li className={v.queue.negative?'ap-od-queue-alert':''}><span>Negative feedback</span><strong>{v.queue.negative}</strong></li>
   </ul>
  </section>
  <section className="ap-dash-card ap-od-attn">
   <div className="ap-od-cardhead"><h2 className="ap-dash-h2">Needs intervention</h2><span className={'ap-dash-badge '+(v.attention.length?'ap-dash-b-err':'ap-dash-b-ok')}>{v.attention.length}</span></div>
   <p className="ap-dash-muted ap-od-desc">Unresolved tickets flagged for attention, high or urgent priority, or a refund or handoff category.</p>
   {!v.attention.length&&<p className="ap-dash-sub" style={{marginTop:10}}>No matching tickets in the loaded snapshot. New here? <Link href="/setup" style={{color:'#09318D',textDecoration:'underline'}}>Finish Quick setup</Link> to create your first test.</p>}
   <div>{v.attention.filter(t=>match(t.id,t.order_label,t.ticket_status,t.priority,t.category)).slice(0,6).map(t=><div key={t.id} className="ap-dash-row"><div style={{display:'flex',alignItems:'center',gap:9,flexWrap:'wrap'}}><Link href={'/tickets?ticket='+t.id}>{ticketLabel(t.id)}</Link><span>{t.order_label}</span><span className={'ap-dash-badge '+(['high','urgent'].includes(t.priority)?'ap-dash-b-err':'ap-dash-b-info')}>{t.priority}</span></div><small>{t.ticket_status} · {t.category} · {t.inbox_state==='taken_over'?'AI paused':'Review needed'}</small></div>)}</div>
   {v.attention.length>6&&<Link href="/tickets" className="ap-od-more">View all {v.attention.length} in Tickets</Link>}
  </section>
  <section className="ap-dash-card">
   <div className="ap-od-cardhead"><h2 className="ap-dash-h2">Unanswered themes</h2></div>
   <p className="ap-dash-muted ap-od-desc">Knowledge gaps: unanswered questions grouped by shared words. One new source can cover a whole group. Rough word matching, not a model judgment.</p>
   {!v.themes.length&&<p className="ap-dash-muted" style={{marginTop:8}}>No unanswered questions in the loaded snapshot.</p>}
   <div>{v.themes.slice(0,5).map(c=><div key={c.sample} className="ap-dash-row ap-od-gap"><div style={{display:'flex',alignItems:'center',gap:9,minWidth:0}}><span className="ap-dash-badge ap-dash-b-mut">{c.size} {c.size===1?'time':'times'}:</span>{' '}<span style={{fontSize:12,overflowWrap:'anywhere'}}>{c.sample}</span></div><Link className="ap-dash-btn ap-dash-btn-ghost ap-od-open" href={answerHref(c.sample)} aria-label={'Write an answer: '+c.sample}>Write an answer</Link></div>)}</div>
   {v.themes.length>0&&<Link href="/knowledge" className="ap-od-more">Write an answer in Knowledge</Link>}
  </section>
 </div>

 <section className="ap-dash-card ap-od-table" aria-labelledby="ap-od-table-h">
  <div className="ap-od-tablehead">
   <div><h2 id="ap-od-table-h" className="ap-dash-h2">{tab==='conversations'?'Conversations':'Questions'}</h2><p className="ap-dash-muted" style={{margin:'4px 0 0'}}>{rows.length} {rows.length===1?'result':'results'}{needle?` for "${q.trim()}"`:''}. Use the search box at the top to filter.</p></div>
   <div className="ap-od-tools">
    <span className="ap-dash-toggle" role="group" aria-label="Table view"><button aria-pressed={tab==='conversations'} onClick={()=>{setTab('conversations');setStatus('all');setPage(0);}}>Conversations</button><button aria-pressed={tab==='questions'} onClick={()=>{setTab('questions');setStatus('all');setPage(0);}}>Questions</button></span>
    <label className="ap-od-filter"><span className="ap-od-sr">Filter by status</span><select className="ap-dash-select" value={status} onChange={e=>{setStatus(e.target.value);setPage(0);}}>
     <option value="all">All statuses</option>
     {tab==='conversations'?(v?.statuses??[]).map(s=><option key={s.key} value={s.key}>{s.label}</option>):<><option value="answered">Answered</option><option value="unanswered">Unanswered</option></>}
    </select></label>
    <button disabled={!d.queries.length} onClick={()=>downloadCsv(modeText('automatepal-fictional-unanswered.csv','automatepal-unanswered.csv'),unansweredCsv(d.queries))} className="ap-dash-btn ap-dash-btn-ghost">Export unanswered questions CSV</button>
   </div>
  </div>
  {!shown.length?<p className="ap-dash-empty ap-od-empty">{rows.length===0&&!needle&&status==='all'?(tab==='conversations'?'No conversations yet.':'No questions yet.'):'Nothing matches this search or filter.'}</p>:
  <table className="ap-od-tbl">
   <thead>{tab==='conversations'?<tr><th scope="col">Ticket</th><th scope="col">Order</th><th scope="col">Status</th><th scope="col">Category</th><th scope="col">Priority</th><th scope="col">Opened</th><th scope="col"><span className="ap-od-sr">Actions</span></th></tr>:<tr><th scope="col">Question</th><th scope="col">Ticket</th><th scope="col">Result</th><th scope="col">Feedback</th><th scope="col">Asked</th><th scope="col"><span className="ap-od-sr">Actions</span></th></tr>}</thead>
   <tbody>{tab==='conversations'?(shown as Ticket[]).map(t=><tr key={t.id}>
    <td data-label="Ticket"><Link href={'/tickets?ticket='+t.id}>{ticketLabel(t.id)}</Link></td>
    <td data-label="Order" className="ap-od-wrap">{t.order_label}</td>
    <td data-label="Status"><span className={'ap-dash-badge '+(['resolved','closed'].includes(t.ticket_status)?'ap-dash-b-ok':needsAttention(t)?'ap-dash-b-err':'ap-dash-b-info')}>{nice(t.ticket_status)}</span></td>
    <td data-label="Category">{nice(t.category)}</td>
    <td data-label="Priority">{t.priority}</td>
    <td data-label="Opened">{fmtDate(t.created_at)}</td>
    <td data-label="Actions"><Link className="ap-dash-btn ap-dash-btn-ghost ap-od-open" href={'/tickets?ticket='+t.id}>Open</Link></td>
   </tr>):(shown as Query[]).map(x=><tr key={x.id}>
    <td data-label="Question" className="ap-od-wrap">{x.question}</td>
    <td data-label="Ticket">{x.case_id?<Link href={'/tickets?ticket='+x.case_id}>{ticketLabel(x.case_id)}</Link>:'-'}</td>
    <td data-label="Result"><span className={'ap-dash-badge '+(x.supported?'ap-dash-b-ok':'ap-dash-b-err')}>{x.supported?'supported':'unanswered'}</span></td>
    <td data-label="Feedback">{x.feedback===1?'helpful':x.feedback===-1?<span className="ap-dash-badge ap-dash-b-err">negative feedback</span>:'none'}</td>
    <td data-label="Asked">{fmtDate(x.created_at)}</td>
    <td data-label="Actions">{x.supported?(x.case_id?<Link className="ap-dash-btn ap-dash-btn-ghost ap-od-open" href={'/tickets?ticket='+x.case_id}>Open</Link>:null):<Link className="ap-dash-btn ap-dash-btn-ghost ap-od-open" href={answerHref(x.question)}>Write an answer</Link>}</td>
   </tr>)}</tbody>
  </table>}
  {rows.length>PAGE&&<nav className="ap-od-pager" aria-label="Table pages"><button className="ap-dash-btn ap-dash-btn-ghost" disabled={cur===0} onClick={()=>setPage(cur-1)}>Previous</button><span>Page {cur+1} of {pages}</span><button className="ap-dash-btn ap-dash-btn-ghost" disabled={cur>=pages-1} onClick={()=>setPage(cur+1)}>Next</button></nav>}
 </section>
 <InsightTopics topics={d.insightSettings?.topics??null} enabled={d.insightSettings?.enabled??true} available={!!d.insightSettings}/>
 <Alerts/>
 <EmailSettings/>
 <PushSettings/>
 <SlackSettings/></>}</main></DashShell></DeskShell>;
}
