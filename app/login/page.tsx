"use client";
import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { browserAuth } from '../../lib/browser-auth';
export default function Login() {
 const router=useRouter();
 const [email,setEmail]=useState(''),[token,setToken]=useState('');
 const [message,setMessage]=useState(''),[busy,setBusy]=useState(false),[sent,setSent]=useState(false);
 async function send(e:React.FormEvent){
  e.preventDefault();setBusy(true);setMessage('');
  try {
   const auth=browserAuth();if(!auth){setMessage('Sign-in setup is being completed. Please check back shortly.');return;}
   const {error}=await auth.auth.signInWithOtp({email,options:{emailRedirectTo:window.location.origin+'/workspace',shouldCreateUser:true}});
   if(error){setMessage(error.message);return;}
   setSent(true);setMessage('If email delivery is available for this address, check your inbox for a sign-in link or code.');
  }catch{setMessage('Could not request a sign-in email. Try again later.');}finally{setBusy(false);}
 }
 async function verify(e:React.FormEvent){
  e.preventDefault();setBusy(true);setMessage('');
  try{
   const auth=browserAuth();if(!auth){setMessage('Sign-in setup is not ready yet.');return;}
   const {data,error}=await auth.auth.verifyOtp({email,token:token.trim(),type:'email'});
   if(error){setMessage(error.message);return;}
   if(data.session)router.push('/workspace');else setMessage('No session returned. Request a new sign-in email.');
  }catch{setMessage('Could not verify the code. Try again later.');}finally{setBusy(false);}
 }
 return <main className="mx-auto max-w-md p-8"><Link href="/">AutomatePal ↗</Link><p className="mt-12 text-xs uppercase tracking-widest text-blue-600">Sandbox studio</p><h1 className="my-4 text-3xl font-semibold">Your workspace starts here.</h1><p className="mb-7 text-sm leading-6 text-gray-500">Sign in by email. No password needed. This beta uses fictional data and the PayPal sandbox.</p><form onSubmit={send} className="space-y-4"><label className="block text-sm">Email<input type="email" required autoComplete="email" value={email} onChange={e=>{setEmail(e.target.value);setSent(false)}} className="mt-2 block w-full rounded-lg border p-3"/></label><button disabled={busy} className="w-full rounded-lg bg-blue-600 p-3 text-sm text-white disabled:opacity-50">{busy?'Working...':sent?'Resend sign-in email':'Email me a sign-in link'}</button></form>{sent&&<form onSubmit={verify} className="mt-7 space-y-3 border-t pt-5"><label className="block text-sm">Have a code instead?<input required inputMode="numeric" autoComplete="one-time-code" value={token} onChange={e=>setToken(e.target.value)} placeholder="Enter the code from your email" className="mt-2 block w-full rounded-lg border p-3"/></label><button disabled={busy} className="w-full rounded-lg border p-3 text-sm">Verify code</button></form>}<p role="status" className="my-5 text-sm leading-6">{message}</p><p className="mt-8 rounded-lg bg-gray-50 p-4 text-xs leading-5 text-gray-500">Email delivery is being configured. During the limited beta, only team addresses may receive sign-in emails. Public access is not ready until delivery is verified.</p><p className="mt-5 text-xs text-gray-400">GitHub sign-in is coming later. <Link href="/privacy" className="underline">Privacy</Link> · <Link href="/terms" className="underline">Beta terms</Link></p></main>;
}
