const STOP=new Set('a an the is are was were do does did i you your my we they it this that what when where which how can could should would to of in on for with and or not any there their our me him her them his its at by from as be have has had will'.split(' '));
export function words(q:string){return new Set(q.toLowerCase().replace(/[^a-z0-9\s]/g,' ').split(/\s+/).filter(w=>w.length>2&&!STOP.has(w)));}
function overlap(a:Set<string>,b:Set<string>){let n=0;for(const w of a)if(b.has(w))n++;return n/Math.max(1,Math.min(a.size,b.size));}
export type Cluster<T>={size:number;sample:string;items:T[]};
// Greedy word-overlap clustering; small inputs only (the owner snapshot caps at 1000 rows).
export function clusterQuestions<T extends {question:string}>(rows:T[],threshold=0.5):Cluster<T>[]{
  const ws=rows.map(r=>words(r.question));
  const used=new Array(rows.length).fill(false);
  const out:Cluster<T>[]=[];
  for(let i=0;i<rows.length;i++){
    if(used[i]||!ws[i].size)continue;
    const items=[rows[i]];used[i]=true;
    for(let j=i+1;j<rows.length;j++){
      if(used[j]||!ws[j].size)continue;
      if(overlap(ws[i],ws[j])>=threshold){items.push(rows[j]);used[j]=true;}
    }
    out.push({size:items.length,sample:rows[i].question,items});
  }
  return out.sort((a,b)=>b.size-a.size);
}
