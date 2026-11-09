/* Word (.docx) to plain text, in the browser (Phase 3), like the PDF import: nothing is uploaded until the owner
   saves with consent. A .docx is a zip; this reads word/document.xml from the zip's central directory, inflates
   it with the platform's DecompressionStream (no dependency), and keeps paragraphs, line breaks and tabs.
   Caps: 2 MB file, 5 MB uncompressed XML (zip-bomb guard), 30,000 characters out. No macros, images or
   embedded objects are read. */
export const DOCX_MAX_BYTES = 2 * 1024 * 1024;
const XML_MAX_BYTES = 5 * 1024 * 1024;
export class DocxError extends Error {}
function u16(b: Uint8Array, o: number) { return b[o] | (b[o + 1] << 8); }
function u32(b: Uint8Array, o: number) { return (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0; }
async function inflate(data: Uint8Array, limit: number): Promise<Uint8Array> {
  const stream = new Blob([data as BlobPart]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  const reader = stream.getReader(), parts: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const {done, value} = await reader.read();
    if (done) break;
    total += value.length;
    if (total > limit) { await reader.cancel(); throw new DocxError('The document is too large once unpacked.'); }
    parts.push(value);
  }
  const out = new Uint8Array(total); let o = 0; for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}
/* The bytes of word/document.xml, or a DocxError. */
export async function docxDocumentXml(file: Uint8Array): Promise<string> {
  if (file.length > DOCX_MAX_BYTES) throw new DocxError('Use a Word file up to 2 MB.');
  if (file.length < 22 || u32(file, 0) !== 0x04034b50) throw new DocxError('This is not a Word (.docx) file.');
  let eocd = -1;
  for (let i = file.length - 22; i >= Math.max(0, file.length - 65557); i--) if (u32(file, i) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) throw new DocxError('The Word file is damaged.');
  const count = u16(file, eocd + 10), cdOffset = u32(file, eocd + 16);
  let p = cdOffset;
  for (let n = 0; n < count && p + 46 <= file.length; n++) {
    if (u32(file, p) !== 0x02014b50) break;
    const method = u16(file, p + 10), csize = u32(file, p + 20), usize = u32(file, p + 24), nameLen = u16(file, p + 28), extraLen = u16(file, p + 30), commentLen = u16(file, p + 32), local = u32(file, p + 42);
    const name = new TextDecoder().decode(file.subarray(p + 46, p + 46 + nameLen));
    if (name === 'word/document.xml') {
      if (usize > XML_MAX_BYTES) throw new DocxError('The document is too large once unpacked.');
      if (u32(file, local) !== 0x04034b50) throw new DocxError('The Word file is damaged.');
      const start = local + 30 + u16(file, local + 26) + u16(file, local + 28), data = file.subarray(start, start + csize);
      if (data.length !== csize) throw new DocxError('The Word file is damaged.');
      const xml = method === 0 ? data : method === 8 ? await inflate(data, XML_MAX_BYTES) : null;
      if (!xml) throw new DocxError('This Word file uses an unsupported compression.');
      return new TextDecoder().decode(xml);
    }
    p += 46 + nameLen + extraLen + commentLen;
  }
  throw new DocxError('No document text found. Is this a Word (.docx) file?');
}
const ENT: Record<string, string> = {amp: '&', lt: '<', gt: '>', quot: '"', apos: "'"};
/* WordprocessingML to text: paragraphs become lines, list items keep their text, tables become lines per row. */
export function docxXmlToText(xml: string, max = 30000): {text: string; truncated: boolean} {
  const body = xml.replace(/<w:(?:instrText|delText)[^>]*>[\s\S]*?<\/w:(?:instrText|delText)>/g, '')
    .replace(/<w:tab\/>/g, '\t').replace(/<w:(?:br|cr)\/?>/g, '\n').replace(/<\/w:p>/g, '\n').replace(/<\/w:tc>/g, '\t').replace(/<\/w:tr>/g, '\n')
    .replace(/<[^>]+>/g, '').replace(/&(#x?[0-9a-fA-F]+|amp|lt|gt|quot|apos);/g, (_, e: string) => e[0] === '#' ? String.fromCodePoint(parseInt(e.slice(e[1] === 'x' ? 2 : 1), e[1] === 'x' ? 16 : 10)) : ENT[e]);
  const text = body.split('\n').map(l => l.replace(/[ \t]+$/g, '').replace(/^\t+/, '')).join('\n').replace(/\n{3,}/g, '\n\n').trim();
  return {text: text.slice(0, max), truncated: text.length > max};
}
export async function extractDocx(file: File): Promise<string> {
  if (file.size > DOCX_MAX_BYTES) throw new DocxError('Use a Word file up to 2 MB.');
  const {text} = docxXmlToText(await docxDocumentXml(new Uint8Array(await file.arrayBuffer())));
  if (text.length < 20) throw new DocxError('No readable text found in this Word file.');
  return text;
}
