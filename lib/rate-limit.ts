const windows = new Map<string, {count:number; until:number}>();
// Bounded per-process guard. Persisted knowledge quotas remain the costly-call boundary.
export function allowRequest(userId:string,now=Date.now()) {
 if(userId.length>256)return false;
 if(windows.size>=5000){for(const [k,v] of windows)if(v.until<=now)windows.delete(k);}
 let window=windows.get(userId);
 if(!window||window.until<=now){
  if(!window&&windows.size>=5000)return false;
  window={count:0,until:now+60000};windows.set(userId,window);
 }
 window.count++;return window.count<=6;
}
