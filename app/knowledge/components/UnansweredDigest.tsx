"use client";
import{useState}from'react';
import{authHeaders}from'../../../lib/browser-auth';
import type{UnansweredDigest as Digest}from'../../../lib/unanswered-digest';
export default function UnansweredDigest({onPrepare}:{onPrepare:(question:string)=>void}){
  const[digest,setDigest]=useState<Digest|null>(null);
  const[status,setStatus]=useState<'idle'|'loading'|'error'>('idle');
  const[coverage,setCoverage]=useState('');
  async function load(){
    setStatus('loading');
    try{
      const r=await fetch('/api/knowledge/analytics',{headers:await authHeaders()});
      const d=await r.json();
      if(!r.ok||d.error||!d.digest){setDigest(null);setStatus('error');return;}
      setDigest(d.digest);
      setCoverage((d.coverage??'')+(d.truncated?' More rows omitted.':''));
      setStatus('idle');
    }catch{setDigest(null);setStatus('error');}
  }
  return <section className="my-8 rounded-xl border p-6">
    <h2 className="text-xl font-semibold">Questions the demo could not answer</h2>
    <p className="my-3 text-xs leading-5 text-gray-500">Groups identical unanswered questions from the last {digest?.windowDays??7} days of recorded demo traffic, within the latest 1000 rows. Unanswered can also mean a temporary provider outage, a refusal, an unfinished reservation or an abstention - the reason is not stored, so treat groups as review leads, not proof of missing knowledge.</p>
    <button disabled={status==='loading'} onClick={load} className="rounded-lg border px-4 py-3 text-sm">{status==='loading'?'Loading…':digest?'Refresh digest':'Load digest'}</button>
    {status==='error'&&<p role="alert" className="mt-4 text-sm">Could not load the digest. Previous numbers were cleared rather than shown stale.</p>}
    {digest&&<div className="mt-4">
      <p className="text-xs text-gray-500">Window {new Date(digest.windowStart).toLocaleString()} to {new Date(digest.generatedAt).toLocaleString()} · {digest.rowsConsidered} recorded questions in window · {digest.unansweredInWindow} unanswered · {digest.groups.length+digest.omittedGroups} distinct groups{digest.omittedGroups?` · top ${digest.groups.length} shown, ${digest.omittedGroups} omitted`:''}{digest.excludedInvalid?` · ${digest.excludedInvalid} rows with invalid or future timestamps excluded`:''}. {coverage}</p>
      {digest.groups.length===0&&<p className="mt-4 rounded-xl border border-dashed p-8 text-sm text-gray-400">No unanswered demo questions in this window.</p>}
      {digest.groups.map(g=><div key={g.key} className="mt-4 border-t pt-3 text-sm">
        <p>{g.question}</p>
        <p className="mt-1 text-xs text-gray-500">Asked {g.count} time{g.count===1?'':'s'} · latest {new Date(g.latestAt).toLocaleString()}{g.negative?` · ${g.negative} negative feedback`:''}</p>
        <button className="mt-3 rounded-lg border px-3 py-2 text-xs" onClick={()=>onPrepare(g.question)}>Prepare Q&amp;A</button>
      </div>)}
    </div>}
  </section>;
}
