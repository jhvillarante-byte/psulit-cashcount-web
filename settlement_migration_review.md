# Settlement migration review

`20261020120000_add_settlement_links.sql` is additive and idempotent. It only
adds nullable settlement-link/amount/status columns and indexes to the existing
`expenses` table. It does not drop tables, delete migration history, rewrite
operational rows, or require a database reset.

Apply it once through the existing Netlify database migration mechanism after
review. If a prior attempt is recorded as failed, repair that migration using
the provider's normal migration repair/retry procedure; do not reset the
database or remove the migration history.

The API uses the original `expense_id` as the settlement parent. Outstanding
records are read from `/api/settlements?branch=Alphaland|Solaire&category=Receivable|Payable`.
Settlement writes validate the branch, parent category, prior paid total and
remaining balance before inserting. A partial payment is marked
`PARTIALLY_SETTLED`; a final payment is marked `SETTLED`.

The existing PIN, receipt upload, Telegram delivery and Google Sheets sync
paths remain in use. Settlement metadata is appended to the existing sheet
payload; no operational sheet is replaced.
