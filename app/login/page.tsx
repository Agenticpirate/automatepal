"use client";
import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { browserAuth } from '../../lib/browser-auth';
export default function Login() {
  const router = useRouter();
  const [email,setEmail]=useState(''); const [password,setPassword]=useState('');
  const [message,setMessage]=useState(''); const [busy,setBusy]=useState(false);
  const [signUp,setSignUp]=useState(false);
  async function submit(e:React.FormEvent) {
    e.preventDefault(); setBusy(true); setMessage('');
    const auth = browserAuth();
    if (!auth) {setMessage('Account setup is not ready yet.');setBusy(false);return;}
    const result = signUp ? await auth.auth.signUp({email,password}) : await auth.auth.signInWithPassword({email,password});
    setBusy(false);
    if(result.error) {setMessage(result.error.message);return;}
    if(result.data.session) router.push('/workspace');
    else setMessage('Check your email to confirm your account, then sign in.');
  }
  async function github() {
    const auth=browserAuth();if(!auth){setMessage('Account setup is not ready yet.');return;}
    const {error}=await auth.auth.signInWithOAuth({provider:'github',options:{redirectTo:window.location.origin+'/workspace'}});
    if(error)setMessage(error.message);
  }
  return <main className="mx-auto max-w-md p-8"><Link href="/">AutomatePal</Link><h1 className="my-6 text-3xl font-semibold">{signUp?'Create your workspace':'Welcome back'}</h1><p className="mb-5 text-gray-500">Sandbox beta. No real payments or customer email.</p><button onClick={github} className="mb-4 w-full rounded bg-black p-3 text-white">Continue with GitHub</button><p className="mb-4 text-xs text-gray-500">GitHub sign-in is being configured. Email signup is limited to beta team members until email delivery is enabled.</p><form onSubmit={submit} className="space-y-4"><label className="block">Email<input type="email" required value={email} onChange={e=>setEmail(e.target.value)} className="mt-1 block w-full rounded border p-3" /></label><label className="block">Password<input type="password" minLength={12} required autoComplete={signUp?'new-password':'current-password'} value={password} onChange={e=>setPassword(e.target.value)} className="mt-1 block w-full rounded border p-3" /></label><button disabled={busy} className="w-full rounded bg-black p-3 text-white">{busy?'Working…':signUp?'Create account':'Sign in'}</button></form><p role="status" className="my-4">{message}</p><button onClick={()=>setSignUp(!signUp)} className="text-sm underline">{signUp?'Already have an account?':'Create an account'}</button></main>;
}
