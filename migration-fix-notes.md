# Settlement migration fix

- `20261020120000_add_settlement_links.sql` is restored from the original migration recovery archive. Do not edit it again.
- Settlement fields and the balance-validation trigger now live in the separate, later migration `20261020130000_add_expense_settlement_fields.sql`.
- The settlement API/UI remains included in this package.
- No production database was accessed or changed by creating this package.
- Before deploying, confirm the original migration checksum against the production migration history. Deploy only after that check succeeds.
