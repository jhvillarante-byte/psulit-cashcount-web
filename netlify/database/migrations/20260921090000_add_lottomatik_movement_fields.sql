DO $$
BEGIN
  IF to_regclass('public.expenses') IS NOT NULL THEN
    ALTER TABLE public.expenses
      ADD COLUMN IF NOT EXISTS lotto_movement_type TEXT,
      ADD COLUMN IF NOT EXISTS lotto_source_wallet TEXT,
      ADD COLUMN IF NOT EXISTS lotto_ticket_number TEXT,
      ADD COLUMN IF NOT EXISTS lotto_claimant_name TEXT;
  END IF;
END $$;
