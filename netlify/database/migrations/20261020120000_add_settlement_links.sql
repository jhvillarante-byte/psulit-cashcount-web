CREATE TABLE IF NOT EXISTS public.settlement_links (
  id BIGSERIAL PRIMARY KEY,
  source_expense_id TEXT NOT NULL REFERENCES public.expenses(expense_id),
  settlement_expense_id TEXT NOT NULL UNIQUE REFERENCES public.expenses(expense_id),
  kind TEXT NOT NULL CHECK (kind IN ('receivable','payable')),
  amount_centavos BIGINT NOT NULL CHECK (amount_centavos > 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS settlement_links_source_idx ON public.settlement_links (source_expense_id, created_at);
