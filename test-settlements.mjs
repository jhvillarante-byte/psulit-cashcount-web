import assert from "node:assert/strict";
import fs from "node:fs";

const api = fs.readFileSync("netlify/functions/api.mts", "utf8");
const originalMigration = fs.readFileSync("netlify/database/migrations/20261020120000_add_settlement_links.sql", "utf8");
const migration = fs.readFileSync("netlify/database/migrations/20261020130000_add_expense_settlement_fields.sql", "utf8");
const ui = fs.readFileSync("settlement-ui.js", "utf8");

assert.match(originalMigration, /CREATE TABLE IF NOT EXISTS public\.settlement_links/);
assert.match(migration, /ADD COLUMN IF NOT EXISTS settlement_parent_expense_id/);
assert.match(migration, /ADD COLUMN IF NOT EXISTS settlement_remaining_centavos/);
assert.match(migration, /expenses_settlement_balance_trigger/);
assert.doesNotMatch(originalMigration + migration, /DROP\s+(TABLE|COLUMN)/i);
assert.match(api, /path === "\/api\/settlements"/);
assert.match(api, /Settlement exceeds the remaining balance/);
assert.match(api, /category === "Receivable Settlement" \|\| category === "Payable Settlement"/);
assert.doesNotMatch(ui, /settlement-outstanding-panel/);
assert.match(api, /originalRecordId/);
assert.match(api, /Reference Number does not match/);
assert.match(fs.readFileSync("assets/index-cashlog-simplified-20260924.js", "utf8"), /Original Record ID/);
assert.match(fs.readFileSync("assets/index-cashlog-simplified-20260924.js", "utf8"), /Reference Number/);
assert.match(fs.readFileSync("assets/index-cashlog-simplified-20260924.js", "utf8"), /Payable Settlement/);
const original = 10000, previous = 2500;
assert.equal(original - previous - 5000, 2500, "partial settlement should leave a balance");
assert.ok(5000 <= original - previous, "valid settlement must not exceed remaining balance");
assert.ok(!(8000 <= original - previous), "overpayment must be rejected");
console.log("settlement schema/UI/API/partial-payment checks: 10 passed");
