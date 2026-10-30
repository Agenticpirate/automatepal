// Owner playground retrieval: mirrors db/010 support_knowledge_vectors
// (cosine similarity >= 0.72, top 4) over the owner's own published chunks,
// using existing RLS reads only. No schema or permission changes.
export type OwnerChunk={id:string;documentId:string;title:string;excerpt:string;embedding:number[];sourceKind?:'text'|'owner_guidance';applicability?:string;effectiveFrom?:string|null;effectiveUntil?:string|null};
export const OWNER_RETRIEVAL_THRESHOLD=0.72;
export const OWNER_RETRIEVAL_LIMIT=4;
export function cosine(a:number[],b:number[]):number{
  if(a.length!==b.length||!a.length)return -1;
  let dot=0,na=0,nb=0;
  for(let i=0;i<a.length;i++){const x=a[i],y=b[i];if(!Number.isFinite(x)||!Number.isFinite(y))return -1;dot+=x*y;na+=x*x;nb+=y*y;}
  if(!na||!nb)return -1;
  return dot/(Math.sqrt(na)*Math.sqrt(nb));
}
export function rankChunks(chunks:OwnerChunk[],query:number[],threshold=OWNER_RETRIEVAL_THRESHOLD,limit=OWNER_RETRIEVAL_LIMIT){
  return chunks.map(c=>({...c,score:cosine(c.embedding,query)}))
    .filter(c=>c.score>=threshold)
    .sort((a,b)=>b.score-a.score)
    .slice(0,limit)
    .map(c=>{const{embedding,...rest}=c;void embedding;return rest;});
}
export function parseVector(value:unknown):number[]|null{
  if(Array.isArray(value)&&value.every(n=>typeof n==='number'))return value as number[];
  if(typeof value==='string'){try{const v=JSON.parse(value);return Array.isArray(v)&&v.every(n=>typeof n==='number')?v:null;}catch{return null;}}
  return null;
}
