/* Widget logo checks (db/056, app/api/widget/logo). Raster only: SVG can carry script. */
export const LOGO_MAX_BYTES=100*1024;
export const LOGO_TYPES=['image/png','image/jpeg','image/webp'] as const;
const MAGIC={'image/png':[0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a],'image/jpeg':[0xff,0xd8,0xff]} as const;
// The file's first bytes must match the declared type.
export function logoMatches(type:string,bytes:Uint8Array):boolean{
 if(type==='image/webp')return bytes.length>12&&String.fromCharCode(...bytes.slice(0,4))==='RIFF'&&String.fromCharCode(...bytes.slice(8,12))==='WEBP';
 const magic=MAGIC[type as keyof typeof MAGIC];return !!magic&&bytes.length>magic.length&&magic.every((b,i)=>bytes[i]===b);
}
