"use client";
import { useState } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { useRouter } from 'next/navigation';
import DeskShell from '../components/DeskShell';
import { browserAuth } from '../../lib/browser-auth';
export default function Login() {
 const router=useRouter();
 const [email,setEmail]=useState(''),[token,setToken]=useState('');
 const [message,setMessage]=useState(''),[busy,setBusy]=useState(false),[sent,setSent]=useState(false);
 async function google(){
  setBusy(true);setMessage('');
  try{const auth=browserAuth();if(!auth){setMessage('Google sign-in setup is being completed.');return;}
   const {error}=await auth.auth.signInWithOAuth({provider:'google',options:{redirectTo:window.location.origin+'/workspace'}});
   if(error)setMessage(error.message);
  }catch{setMessage('Could not start Google sign-in. Try again later.');}finally{setBusy(false);}
 }
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
 return <DeskShell widget><main className="ap-public ap-auth"><div className="ap-auth-band"><nav className="ap-auth-nav" aria-label="Sign in"><Link href="/" className="ap-mark"><Image src="/automatepal-mark.svg" alt="" width={34} height={34} className="ap-logo"/>AutomatePal</Link><Link href="/" className="ap-auth-back">Back to home ↗</Link></nav><section className="ap-auth-card"><p className="ap-kicker">Sandbox studio</p><h1>Your workspace starts here.</h1><p className="ap-auth-intro">Sign in with Google, or use email during the limited beta. This beta uses fictional data and the PayPal sandbox.</p><button onClick={google} disabled={busy} className="ap-auth-google">Continue with Google</button><p className="ap-auth-or">or use email</p><form onSubmit={send}><label>Email<input type="email" required autoComplete="email" value={email} onChange={e=>{setEmail(e.target.value);setSent(false)}}/></label><button disabled={busy} className="ap-auth-submit">{busy?'Working...':sent?'Resend sign-in email':'Email me a sign-in link'}</button></form>{sent&&<form onSubmit={verify} className="ap-auth-verify"><label>Have a code instead?<input required inputMode="numeric" autoComplete="one-time-code" value={token} onChange={e=>setToken(e.target.value)} placeholder="Enter the code from your email"/></label><button disabled={busy} className="ap-auth-ghost">Verify code</button></form>}<p role="status" className="ap-auth-message">{message}</p><p className="ap-auth-note">Google sign-in is available in this sandbox beta. Email sign-in delivery is limited to approved team addresses. Public users should use Google; this is not a production billing service.</p><p className="ap-auth-foot">GitHub sign-in is coming later. <Link href="/privacy">Privacy</Link> · <Link href="/terms">Beta terms</Link></p></section></div></main></DeskShell>;
}
