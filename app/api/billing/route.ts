import {NextRequest, NextResponse} from 'next/server';
import {z} from 'zod';
import {demoGate, demoLocked} from '../../../lib/demo-open';
import {authenticate, roleAtLeast} from '../../../lib/session';
import {validOrigin} from '../../../lib/origin';
import {allowRequest} from '../../../lib/rate-limit';
import {limitedJson} from '../../../lib/limited-json';
import {enabledDefinition, providerSummaries} from '../../../lib/billing/core/registry';
import {credentialAad, decryptCredential, encryptCredential, encryptionReady, needsRotation, proofHash, serverProof} from '../../../lib/billing/core/crypto';
import {invalidateConnection} from '../../../lib/billing/core/cache';
import {resetConnection} from '../../../lib/billing/core/breaker';
import {safeErrorMessage} from '../../../lib/billing/core/redact';
import {BillingError, type BillingMode, type ProviderDefinition} from '../../../lib/billing/core/types';
import {featureBlocked} from '../../../lib/plan-gate';

// Owner billing view and connect API. Read-only provider keys only; credentials are encrypted
// before they reach the database and are never returned to the browser or logged.
const NO_STORE = {'Cache-Control': 'no-store'};
const LIMITS = {workspacePer10Min: 60, workspacePerDay: 300, providerPer10Min: 30, caseFailedVerifications: 5, caseLookups: 30, verificationMinutes: 30};
const CONNECTION_COLUMNS = 'id,provider,mode,key_id,key_hint,account_label,config,status,last_checked_at,live_confirmed_at,created_at,updated_at';
const ENCRYPTION_MISSING = 'Set BILLING_ENCRYPTION_KEYS, BILLING_ENCRYPTION_ACTIVE_KID and BILLING_RPC_SECRET on the server before connecting a provider.';
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export async function GET(req: NextRequest) {
  const ctx = await authenticate(req);
  if (!ctx) { const d = demoGate(req, 'billing'); if (d) return d; return NextResponse.json({error: 'Please sign in.'}, {status: 401}); }
  // Separate fail-soft reads: an un-migrated database shows the view with nothing connected.
  const [conns, events, lookups] = await Promise.all([
    ctx.client.from('billing_connections').select(CONNECTION_COLUMNS).eq('user_id', ctx.userId).order('provider'),
    ctx.client.from('billing_connection_events').select('id,provider,mode,event,actor_id,created_at').eq('user_id', ctx.userId).order('created_at', {ascending: false}).limit(50),
    ctx.client.from('billing_lookups').select('id,case_id,provider,mode,kind,intent,outcome,record_kind,record_ref,record_status,amount_minor,currency,created_at').eq('user_id', ctx.userId).order('created_at', {ascending: false}).limit(100),
  ]);
  return NextResponse.json({
    providers: providerSummaries(),
    connections: (conns.data ?? []).map((c) => ({...c, needsRotation: needsRotation(c.key_id)})),
    events: events.data ?? [],
    lookups: lookups.data ?? [],
    available: !conns.error,
    role: ctx.role,
    encryptionReady: encryptionReady(),
    paymentExecution: false,
    limits: LIMITS,
  }, {headers: NO_STORE});
}

const provider = z.string().min(2).max(20);
const field = z.string().trim().max(600);
const Body = z.discriminatedUnion('action', [
  z.object({action: z.literal('connect'), provider, mode: z.enum(['test', 'live']), credentials: z.record(z.string(), field), config: z.record(z.string(), z.string().trim().max(100)).optional(), confirmLive: z.string().max(60).optional()}),
  z.object({action: z.literal('test'), provider}),
  z.object({action: z.literal('rotate'), provider}),
  z.object({action: z.literal('disconnect'), provider}),
]);

function pick(fields: {name: string}[], input: Record<string, string> | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  for (const f of fields) if (input?.[f.name]) out[f.name] = input[f.name];
  return out;
}
const adapterDeps = (connectionId: string, config: Record<string, string>) => ({fetch: (u: string, i: RequestInit) => fetch(u, i), now: Date.now, sleep, connectionId, config});

async function check(def: ProviderDefinition, cred: Record<string, string>, mode: BillingMode, config: Record<string, string>, connectionId: string) {
  try { return (await def.createAdapter(cred, mode, adapterDeps(connectionId, config)).testConnection()).warning; }
  catch (e) {
    if (e instanceof BillingError && e.code === 'auth_failed') throw new BillingError('auth_failed', {publicMessage: `${def.label} refused this key for ${mode === 'live' ? 'LIVE' : 'Test'} mode. Check the key, its read permissions and the selected mode.`});
    throw e;
  }
}

export async function POST(req: NextRequest) {
  const ctx = await authenticate(req);
  if (!ctx) { const d = demoLocked(); if (d) return d; return NextResponse.json({error: 'Please sign in.'}, {status: 401}); }
  if (!validOrigin(req)) return NextResponse.json({error: 'Invalid origin'}, {status: 403});
  if (!await allowRequest('billing:' + ctx.actorId)) return NextResponse.json({error: 'Please wait a minute.'}, {status: 429});
  if (!roleAtLeast(ctx.role, 'admin')) return NextResponse.json({error: 'Only workspace admins and the owner can manage billing connections.'}, {status: 403});
  try {
    const b = Body.parse(await limitedJson(req, 4000));
    const def = enabledDefinition(b.provider);
    if (!def) throw Error('That provider is not available.');
    if (!encryptionReady()) throw Error(ENCRYPTION_MISSING);
    const id = def.id;
    if (b.action === 'connect') {
      const gate = await featureBlocked(ctx.client, 'billing_support', 'Billing support for your customers'); if (gate) return gate;
      const cred = pick(def.credentialFields, b.credentials);
      const config = pick(def.configFields ?? [], b.config);
      const v = def.validateCredential(b.mode, cred, config);
      if (!v.ok) throw new BillingError(v.code, {publicMessage: v.message});
      if (b.mode === 'live') {
        if (ctx.role !== 'owner') throw Error('Only the workspace owner can connect LIVE mode.');
        if (b.confirmLive !== 'CONNECT LIVE ' + id.toUpperCase()) throw Error(`Type CONNECT LIVE ${id.toUpperCase()} to confirm LIVE mode.`);
      }
      const checkWarning = await check(def, cred, b.mode, config, `connect:${ctx.userId}:${id}`);
      const {blob, keyId} = encryptCredential(JSON.stringify(cred), credentialAad(ctx.userId, id, b.mode));
      const saved = await ctx.client.rpc('save_billing_connection', {p_provider: id, p_mode: b.mode, p_ciphertext: blob, p_key_id: keyId, p_proof_hash: proofHash(serverProof()), p_key_hint: v.keyHint, p_label: null, p_config: config, p_live_confirm: b.mode === 'live'});
      if (saved.error || !saved.data) throw Error('Connection not saved. Apply migration 044 and check your role.');
      invalidateConnection(String(saved.data)); resetConnection(String(saved.data));
      return NextResponse.json({note: `${def.label} connected in ${b.mode === 'live' ? 'LIVE' : 'Test'} mode. Read-only lookups only; no money moves.`, ...(v.warning || checkWarning ? {warning: [v.warning, checkWarning].filter(Boolean).join(' ')} : {})}, {headers: NO_STORE});
    }
    const secret = await ctx.client.rpc('billing_connection_secret', {p_provider: id, p_proof: serverProof()});
    if (b.action === 'disconnect') {
      const del = await ctx.client.rpc('delete_billing_connection', {p_provider: id});
      if (del.error || !del.data) throw Error('Connection not found.');
      if (secret.data?.id) { invalidateConnection(secret.data.id); resetConnection(secret.data.id); }
      return NextResponse.json({note: `${def.label} disconnected. The stored key was deleted; lookup history stays as metadata.`}, {headers: NO_STORE});
    }
    if (secret.error || !secret.data) throw Error('Connection not found.');
    const s = secret.data as {id: string; ciphertext: string; key_id: string; mode: BillingMode; config: Record<string, string>};
    const plain = decryptCredential(s.ciphertext, credentialAad(ctx.userId, id, s.mode));
    if (b.action === 'test') {
      let warning: string | undefined;
      try { warning = await check(def, JSON.parse(plain), s.mode, s.config ?? {}, s.id); } catch (e) { await ctx.client.rpc('record_billing_check', {p_provider: id, p_ok: false}); throw e; }
      await ctx.client.rpc('record_billing_check', {p_provider: id, p_ok: true});
      return NextResponse.json({note: `${def.label} read check passed. No write call was made.`, ...(warning ? {warning} : {})}, {headers: NO_STORE});
    }
    const {blob, keyId} = encryptCredential(plain, credentialAad(ctx.userId, id, s.mode));
    const rot = await ctx.client.rpc('rotate_billing_connection', {p_provider: id, p_ciphertext: blob, p_key_id: keyId});
    if (rot.error || !rot.data) throw Error('Rotation not saved.');
    invalidateConnection(s.id);
    return NextResponse.json({note: `${def.label} key re-encrypted with key id ${keyId}.`}, {headers: NO_STORE});
  } catch (e) {
    const message = e instanceof z.ZodError ? 'Check the request fields.' : e instanceof BillingError ? safeErrorMessage(e) : e instanceof Error && /^(That provider|Set BILLING|Only the workspace|Type CONNECT LIVE|Connection not|Rotation not|Stored credential|Billing encryption)/.test(e.message) ? e.message : 'Billing request failed.';
    return NextResponse.json({error: message}, {status: 400, headers: NO_STORE});
  }
}
