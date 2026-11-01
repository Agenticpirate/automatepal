import {createCipheriv, createDecipheriv, createHash, createHmac, randomBytes} from 'node:crypto';
import type {BillingScope} from './types';

// Credentials at rest: AES-256-GCM, random 12-byte IV, AAD "{workspaceId}:{provider}:{mode}:v2".
// Blob: v2.<kid>.<iv>.<tag>.<ct> (base64url). Keys: BILLING_ENCRYPTION_KEYS="k1:<b64 32 bytes>[,k2:...]",
// active key: BILLING_ENCRYPTION_ACTIVE_KID. Decrypt uses the blob's kid, so old blobs keep working
// after the active key changes until they are rotated.
const NOT_CONFIGURED = 'Billing encryption is not configured on the server.';
const KID = /^[a-z0-9]{1,16}$/;
const b64u = (b: Buffer) => b.toString('base64url');

function keyring(): Map<string, Buffer> {
  const raw = process.env.BILLING_ENCRYPTION_KEYS ?? '';
  const ring = new Map<string, Buffer>();
  for (const part of raw.split(',').map((s) => s.trim()).filter(Boolean)) {
    const i = part.indexOf(':');
    if (i < 1) throw Error(NOT_CONFIGURED);
    const kid = part.slice(0, i);
    const key = Buffer.from(part.slice(i + 1), 'base64');
    if (!KID.test(kid) || key.length !== 32 || ring.has(kid)) throw Error(NOT_CONFIGURED);
    ring.set(kid, key);
  }
  if (!ring.size) throw Error(NOT_CONFIGURED);
  return ring;
}

export function activeKeyId(): string {
  const kid = process.env.BILLING_ENCRYPTION_ACTIVE_KID ?? '';
  if (!KID.test(kid) || !keyring().has(kid)) throw Error(NOT_CONFIGURED);
  return kid;
}

export function needsRotation(kid: string | null | undefined): boolean {
  try { return kid !== activeKeyId(); } catch { return false; }
}

export function encryptionReady(): boolean {
  try { activeKeyId(); return !!rpcSecret(); } catch { return false; }
}

export function encryptCredential(plain: string, aad: string): {blob: string; keyId: string} {
  const kid = activeKeyId();
  const key = keyring().get(kid)!;
  const iv = randomBytes(12);
  const c = createCipheriv('aes-256-gcm', key, iv);
  c.setAAD(Buffer.from(aad, 'utf8'));
  const ct = Buffer.concat([c.update(plain, 'utf8'), c.final()]);
  return {blob: ['v2', kid, b64u(iv), b64u(c.getAuthTag()), b64u(ct)].join('.'), keyId: kid};
}

export function decryptCredential(blob: string, aad: string): string {
  const parts = String(blob).split('.');
  if (parts.length !== 5 || parts[0] !== 'v2') throw Error('Stored credential is unreadable.');
  const [, kid, iv, tag, ct] = parts;
  const key = keyring().get(kid);
  if (!key) throw Error('Stored credential uses an unknown key id.');
  try {
    const d = createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'base64url'));
    d.setAAD(Buffer.from(aad, 'utf8'));
    d.setAuthTag(Buffer.from(tag, 'base64url'));
    return Buffer.concat([d.update(Buffer.from(ct, 'base64url')), d.final()]).toString('utf8');
  } catch {
    throw Error('Stored credential is unreadable.');
  }
}

export const credentialAad = (workspaceId: string, provider: string, mode: string) => `${workspaceId}:${provider}:${mode}:v2`;
export const keyIdOf = (blob: string) => String(blob).split('.')[1] ?? '';

function rpcSecret(): string {
  const s = process.env.BILLING_RPC_SECRET ?? '';
  if (s.length < 32) throw Error(NOT_CONFIGURED);
  return s;
}
// Ciphertext RPCs return secrets only with this proof. The DB stores sha256(proof).
export function serverProof(): string {
  return createHmac('sha256', rpcSecret()).update('automatepal-billing-rpc-v1').digest('hex');
}
export const proofHash = (proof: string) => createHash('sha256').update(proof).digest('hex');

// Verification scope is sealed with the same keyring so the DB never stores record ids or
// customer ids in plaintext (and never stores the email at all).
export const scopeAad = (caseHash: string, provider: string) => `scope:${caseHash}:${provider}:v2`;
export function sealScope(scope: BillingScope, caseHash: string): {sealed: string} {
  return {sealed: encryptCredential(JSON.stringify(scope), scopeAad(caseHash, scope.provider)).blob};
}
export function openScope(sealed: unknown, caseHash: string, provider: string): BillingScope | null {
  const blob = typeof sealed === 'object' && sealed && 'sealed' in sealed ? String((sealed as {sealed: unknown}).sealed) : '';
  if (!blob) return null;
  try {
    const s = JSON.parse(decryptCredential(blob, scopeAad(caseHash, provider))) as BillingScope;
    return s.provider === provider && Array.isArray(s.recordIds) ? s : null;
  } catch { return null; }
}
