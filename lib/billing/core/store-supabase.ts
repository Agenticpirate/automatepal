import type {SupabaseClient} from '@supabase/supabase-js';
import type {BillingContext, BillingStatus, BillingStore, ReserveResult} from './store';

// BillingStore over the 044 visitor RPCs (anon client, keyed by the case token hash).
// Fail soft: an un-migrated database (RPC missing) reads as "no billing connection".
export function supabaseBillingStore(client: SupabaseClient): BillingStore {
  return {
    async status(caseHash) {
      const {data, error} = await client.rpc('support_billing_status', {p_hash: caseHash});
      return error || !data ? null : (data as BillingStatus);
    },
    async context(caseHash, proof) {
      const {data, error} = await client.rpc('support_billing_context', {p_hash: caseHash, p_proof: proof});
      if (error || !data || !data.workspaceId) return null;
      return data as BillingContext;
    },
    async reserve(caseHash, proof, kind, provider, intent) {
      const {data, error} = await client.rpc('support_billing_reserve', {p_hash: caseHash, p_proof: proof, p_kind: kind, p_provider: provider, p_intent: intent});
      if (error || !data) return {id: null, mode: null, refused: 'not_connected'};
      return data as ReserveResult;
    },
    async finish(caseHash, proof, lookupId, outcome, meta, scope) {
      const {data, error} = await client.rpc('support_billing_finish', {
        p_hash: caseHash, p_proof: proof, p_lookup: lookupId, p_outcome: outcome, p_record_kind: meta.recordKind, p_record_ref: meta.recordRef,
        p_record_status: meta.recordStatus, p_amount_minor: meta.amountMinor, p_currency: meta.currency, p_scope: scope,
      });
      return error || !data ? {ok: false, expiresAt: null} : (data as {ok: boolean; expiresAt: string | null});
    },
    async refundRequest(caseHash, lookupId, message) {
      const {data, error} = await client.rpc('support_billing_refund_request', {p_hash: caseHash, p_lookup: lookupId, p_message: message});
      return error || !data ? null : String(data);
    },
  };
}
