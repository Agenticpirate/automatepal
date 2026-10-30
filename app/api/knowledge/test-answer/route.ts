import{demoLocked}from'../../../../lib/demo-open';
import{NextRequest,NextResponse}from'next/server';import{z}from'zod';
import{authenticate}from'../../../../lib/session';
import{validOrigin}from'../../../../lib/origin';
import{allowRequest}from'../../../../lib/rate-limit';
import{limitedJson}from'../../../../lib/limited-json';
import{answerKnowledge,embedKnowledge,safeKnowledge,instructionExtraction,KnowledgeSource}from'../../../../lib/knowledge';
import{rankChunks,parseVector,OwnerChunk}from'../../../../lib/owner-retrieval';
// Owner-only dashboard preview. Uses the owner's own published chunks via existing RLS reads.
// Nothing is recorded into knowledge_interactions: previews never enter analytics or the digest.
export async function POST(req:NextRequest){
  const ctx=await authenticate(req);
  if(!ctx){const d=demoLocked();if(d)return d;return NextResponse.json({error:'Please sign in.'},{status:401});}
  if(!validOrigin(req))return NextResponse.json({error:'Invalid origin'},{status:403});
  if(!allowRequest('test-answer:'+ctx.userId))return NextResponse.json({error:'Please wait a minute.'},{status:429});
  try{
    const b=z.object({question:z.string().trim().min(3).max(300)}).parse(await limitedJson(req,2000));
    safeKnowledge(b.question);
    if(instructionExtraction(b.question))return NextResponse.json({answer:'I can help with questions about the published information, but cannot share private instructions.',supported:false,sources:[],stages:['instruction_request_refused'],preview:true});
    const vector=await embedKnowledge(b.question,true);
    const{data,error}=await ctx.client.from('knowledge_chunks').select('id,document_id,content,embedding,model,knowledge_documents!inner(title,published,source_kind,applicability,effective_from,effective_until)').eq('knowledge_documents.published',true).limit(900);
    if(error)return NextResponse.json({error:'Knowledge unavailable. Preview not generated.'},{status:503});
    const chunks:OwnerChunk[]=[];
    for(const r of data??[]){
      const doc=(r as unknown as{knowledge_documents:{title:string;source_kind:string;applicability:string;effective_from:string|null;effective_until:string|null}}).knowledge_documents;
      const embedding=parseVector((r as {embedding:unknown}).embedding);
      if(!embedding)continue;
      chunks.push({id:(r as {id:string}).id,documentId:(r as {document_id:string}).document_id,title:doc.title,excerpt:(r as {content:string}).content,embedding,sourceKind:doc.source_kind==='owner_guidance'?'owner_guidance':'text',applicability:doc.applicability,effectiveFrom:doc.effective_from,effectiveUntil:doc.effective_until});
    }
    const ranked=rankChunks(chunks,vector);
    const stages:string[]=[];
    const answer=await answerKnowledge(b.question,ranked as KnowledgeSource[],s=>stages.push(s));
    return NextResponse.json({...answer,stages,retrieved:ranked.length,preview:true,note:'Dashboard preview over your published sources. Not recorded in analytics or the digest.'},{headers:{'Cache-Control':'no-store'}});
  }catch(e){
    if(e instanceof z.ZodError)return NextResponse.json({error:'Ask a question of 3 to 300 characters.'},{status:400});
    return NextResponse.json({error:'Preview failed. No source or setting was changed.'},{status:503});
  }
}
