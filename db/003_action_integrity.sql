-- Keep an action's reviewed payload fixed, even for direct authenticated API use.
CREATE OR REPLACE FUNCTION public.guard_action_integrity() RETURNS trigger
LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
 IF TG_OP = 'INSERT' THEN
  IF NEW.status <> 'pending' THEN RAISE EXCEPTION 'New action must be pending'; END IF;
 ELSE
  IF NEW.id <> OLD.id OR NEW.user_id <> OLD.user_id OR NEW.tool <> OLD.tool OR NEW.args <> OLD.args OR NEW.created_at <> OLD.created_at THEN
   RAISE EXCEPTION 'Reviewed action is immutable';
  END IF;
  IF NOT ((OLD.status = 'pending' AND NEW.status IN ('executing','cancelled')) OR (OLD.status = 'executing' AND NEW.status IN ('completed','needs_review'))) THEN
   RAISE EXCEPTION 'Invalid action transition';
  END IF;
 END IF;
 RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS action_integrity ON public.action_proposals;
CREATE TRIGGER action_integrity BEFORE INSERT OR UPDATE ON public.action_proposals
FOR EACH ROW EXECUTE FUNCTION public.guard_action_integrity();
