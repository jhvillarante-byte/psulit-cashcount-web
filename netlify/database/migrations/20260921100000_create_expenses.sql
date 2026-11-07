CREATE TABLE IF NOT EXISTS public.expenses (
  expense_id TEXT PRIMARY KEY, expense_date DATE NOT NULL, branch TEXT NOT NULL, posted_by TEXT NOT NULL,
  category TEXT NOT NULL, other_category TEXT, description TEXT NOT NULL,
  amount_centavos BIGINT NOT NULL CHECK (amount_centavos >= 0), fund_drawer_used TEXT, asset_type TEXT,
  actual_currency TEXT, actual_amount NUMERIC(20,6), borrower_company TEXT, valuation_rate NUMERIC(20,6),
  destination_fund TEXT, transfer_reference TEXT, received_asset_type TEXT, received_currency TEXT,
  received_amount NUMERIC(20,6), source_branch TEXT, destination_branch TEXT, settlement_method TEXT,
  receivable_reference TEXT, hive_transaction_reference TEXT, lotto_movement_type TEXT, lotto_source_wallet TEXT,
  lotto_ticket_number TEXT, lotto_claimant_name TEXT, supporting_document_key TEXT, supporting_document_name TEXT,
  supporting_document_type TEXT, slack_status TEXT NOT NULL DEFAULT 'Pending', slack_channel TEXT,
  slack_message_ts TEXT, slack_permalink TEXT, slack_error TEXT, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS expenses_date_created_idx ON public.expenses (expense_date DESC, created_at DESC);
