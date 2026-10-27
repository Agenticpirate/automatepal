const windows = new Map<string, {count:number; until:number}>();
// Per-process abuse guard. A distributed limit is required before scaling.
export function allowRequest(userId:string) {
  const now=Date.now();
  if(windows.size>5000) for(const [k,v] of windows) if(v.until<now) windows.delete(k);
  let window=windows.get(userId);
  if(!window || window.until<now) { window={count:0,until:now+60000};windows.set(userId,window); }
  window.count++;return window.count<=6;
}
