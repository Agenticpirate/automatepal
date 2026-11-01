import {createHash} from 'node:crypto';
import type {BillingIntent, BillingRecord} from './types';

// Lookup cache: in-process LRU, 500 entries, 60 s TTL. The key includes the verification id,
// so a hit can never cross customers or verifications.
const MAX = 500;
const TTL_MS = 60_000;
type Entry = {connectionId: string; at: number; records: BillingRecord[]};
const entries = new Map<string, Entry>();

export const cacheKey = (connectionId: string, verificationId: string, intent: BillingIntent) =>
  createHash('sha256').update(`${connectionId}|${verificationId}|${intent}`).digest('hex');

export function cacheGet(connectionId: string, verificationId: string, intent: BillingIntent, now: number): BillingRecord[] | null {
  const k = cacheKey(connectionId, verificationId, intent);
  const e = entries.get(k);
  if (!e) return null;
  if (now - e.at >= TTL_MS || e.connectionId !== connectionId) { entries.delete(k); return null; }
  entries.delete(k);
  entries.set(k, e); // refresh LRU position
  return e.records;
}

export function cacheSet(connectionId: string, verificationId: string, intent: BillingIntent, records: BillingRecord[], now: number) {
  const k = cacheKey(connectionId, verificationId, intent);
  entries.delete(k);
  while (entries.size >= MAX) entries.delete(entries.keys().next().value as string);
  entries.set(k, {connectionId, at: now, records});
}

// Disconnect or rotate clears every cached lookup for that connection.
export function invalidateConnection(connectionId: string) {
  for (const [k, e] of entries) if (e.connectionId === connectionId) entries.delete(k);
}
export const cacheSize = () => entries.size;
export function clearCache() { entries.clear(); }
