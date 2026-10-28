import { NextRequest } from 'next/server';
export function validOrigin(req:NextRequest){
 const origin=req.headers.get('origin');
 if(!origin)return true; // Non-browser callers still require a verified bearer token.
 const expected=process.env.APP_URL||process.env.RENDER_EXTERNAL_URL;
 if(expected){try{return origin===new URL(expected).origin;}catch{return false;}}
 return process.env.NODE_ENV!=='production'&&origin===req.nextUrl.origin;
}
