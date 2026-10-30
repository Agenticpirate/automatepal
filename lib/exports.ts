export type KnowledgeDoc={id:string;title:string;published:boolean;source_kind:string;applicability:string;effective_from:string|null;effective_until:string|null;updated_at:string;content:string};
export type QuestionRow={id:string;case_id:string|null;created_at:string;question:string;supported:boolean;feedback:number|null};
// Formula-injection guard: prefix cells starting with = + @ - tab CR so spreadsheet apps treat them as text.
export function csvCell(v:unknown){return '"'+String(v??'').replace(/^[=+@\-\t\r]/,"'$&").replaceAll('"','""')+'"';}
export function knowledgeCsv(rows:KnowledgeDoc[]){return ['Source,Full ID,Kind,Applicability,Published,Effective from,Effective until,Updated UTC,Characters',...rows.map(d=>[d.title,d.id,d.source_kind,d.applicability,d.published?'yes':'no',d.effective_from??'',d.effective_until??'',d.updated_at,String(d.content?.length??0)].map(csvCell).join(','))].join('\n');}
export function unansweredCsv(rows:QuestionRow[]){return ['Question,Full ID,Asked UTC,Case,Feedback',...rows.filter(q=>!q.supported).map(q=>[q.question,q.id,q.created_at,q.case_id??'',q.feedback??''].map(csvCell).join(','))].join('\n');}
export function downloadCsv(name:string,csv:string){const blob=new Blob([csv],{type:'text/csv;charset=utf-8'}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=name;a.click();URL.revokeObjectURL(url);}
