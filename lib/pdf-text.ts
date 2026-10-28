// Browser-only parsing. Never executes embedded PDF scripts, opens attachments or fetches URLs.
export async function extractPdf(file:File){
 if(file.size>2_000_000)throw Error('PDF preview limit: 2 MB.');
 const bytes=new Uint8Array(await file.arrayBuffer());if(new TextDecoder().decode(bytes.slice(0,5))!=='%PDF-')throw Error('Not a PDF file.');
 const pdfjs=await import('pdfjs-dist');pdfjs.GlobalWorkerOptions.workerSrc='/pdf.worker.min.mjs';
 const task=pdfjs.getDocument({data:bytes,disableFontFace:true,useSystemFonts:false,stopAtErrors:true});
 let timer:ReturnType<typeof setTimeout>|undefined;let expired=false;
 try{const doc=await Promise.race([task.promise,new Promise<never>((_,reject)=>{timer=setTimeout(()=>{expired=true;void task.destroy();reject(Error('PDF parsing timed out. Try a small text-based PDF.'));},15000);})]);
 if(doc.numPages>10)throw Error('PDF preview limit: 10 pages.');let text='',actualText='';for(let i=1;i<=doc.numPages;i++){if(expired)throw Error('PDF parsing timed out.');const page=await doc.getPage(i);const data=await page.getTextContent();const pageText=data.items.map(x=>'str'in x?x.str:'').join(' ');actualText+=pageText;text+='\n[Page '+i+']\n'+pageText;if(text.length>30000)throw Error('Extracted text exceeds 30 KB preview limit.');}
 if(actualText.trim().length<20)throw Error('No usable text. Scanned PDFs need OCR, which is not supported yet.');return text.trim();
 }finally{if(timer)clearTimeout(timer);await task.destroy();}
}
