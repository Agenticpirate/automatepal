-- Reconcile pre-ticket records only where the owner has not reviewed or changed state.
-- No links are renewed. Taken-over, resolved and owner-reviewed tickets remain untouched.
WITH old AS (
 SELECT c.id,CASE WHEN EXISTS(SELECT 1 FROM support_requests r WHERE r.case_id=c.id AND r.status='pending_review' AND r.kind='refund_request') THEN 'refund'
 WHEN EXISTS(SELECT 1 FROM support_requests r WHERE r.case_id=c.id AND r.status='pending_review' AND r.kind='human_handoff') THEN 'handoff'
 WHEN EXISTS(SELECT 1 FROM support_requests r WHERE r.case_id=c.id AND r.status='pending_review' AND r.kind='receipt_request') THEN 'receipt'
 WHEN EXISTS(SELECT 1 FROM support_requests r WHERE r.case_id=c.id AND r.status='pending_review') THEN 'billing' ELSE 'knowledge' END AS category
 FROM support_cases c WHERE c.ticket_status='new' AND c.first_reviewed_at IS NULL AND c.inbox_state IN('open','attention') AND (
 EXISTS(SELECT 1 FROM support_requests r WHERE r.case_id=c.id AND r.status='pending_review') OR EXISTS(SELECT 1 FROM knowledge_interactions q WHERE q.case_id=c.id AND(q.feedback=-1 OR q.supported=false))))
UPDATE support_cases c SET ticket_status='open',category=old.category,inbox_state='attention',ticket_updated_at=clock_timestamp() FROM old WHERE c.id=old.id;
