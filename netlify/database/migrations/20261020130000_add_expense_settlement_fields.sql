-- Additive settlement metadata. This is a NEW migration; do not edit the older
-- 20261020120000_add_settlement_links migration after it has been applied.
DO $$
BEGIN
  IF to_regclass('public.expenses') IS NOT NULL THEN
    ALTER TABLE public.expenses
      ADD COLUMN IF NOT EXISTS settlement_type TEXT,
      ADD COLUMN IF NOT EXISTS settlement_parent_expense_id TEXT,
      ADD COLUMN IF NOT EXISTS settlement_reference TEXT,
      ADD COLUMN IF NOT EXISTS settlement_original_amount_centavos BIGINT,
      ADD COLUMN IF NOT EXISTS settlement_previous_paid_centavos BIGINT NOT NULL DEFAULT 0,
      ADD COLUMN IF NOT EXISTS settlement_remaining_centavos BIGINT,
      ADD COLUMN IF NOT EXISTS settlement_status TEXT NOT NULL DEFAULT 'OPEN';
    CREATE INDEX IF NOT EXISTS expenses_settlement_parent_idx
      ON public.expenses (settlement_parent_expense_id, created_at);
    CREATE INDEX IF NOT EXISTS expenses_branch_category_idx
      ON public.expenses (branch, category, expense_date);
  END IF;
END $$;

-- Enforce the remaining-balance rule at the database boundary. Locking the
-- parent row serializes concurrent partial settlements to prevent overpayment.
CREATE OR REPLACE FUNCTION public.validate_expense_settlement_balance()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  original_amount BIGINT;
  already_paid BIGINT;
BEGIN
  IF NEW.category IN ('Receivable Settlement', 'Payable Settlement')
     AND NEW.settlement_parent_expense_id IS NOT NULL THEN
    SELECT amount_centavos INTO original_amount
      FROM public.expenses
      WHERE expense_id = NEW.settlement_parent_expense_id
        AND branch = NEW.branch
      FOR UPDATE;
    IF original_amount IS NULL THEN
      RAISE EXCEPTION 'Settlement parent does not exist for this branch';
    END IF;
    SELECT COALESCE(SUM(amount_centavos), 0) INTO already_paid
      FROM public.expenses
      WHERE branch = NEW.branch
        AND category = NEW.category
        AND settlement_parent_expense_id = NEW.settlement_parent_expense_id;
    IF already_paid + NEW.amount_centavos > original_amount THEN
      RAISE EXCEPTION 'Settlement exceeds the remaining balance';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DO $$
BEGIN
  IF to_regclass('public.expenses') IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'expenses_settlement_balance_trigger') THEN
    CREATE TRIGGER expenses_settlement_balance_trigger
      BEFORE INSERT ON public.expenses
      FOR EACH ROW EXECUTE FUNCTION public.validate_expense_settlement_balance();
  END IF;
END $$;
