# Sales / inventory integrity release

## Status and scope

This changes the existing React/Vite/Supabase app. It is not a new ERP and it does
not bulk-reconcile historical balances. The migration is additive and targets the
existing production schema inspected for daisho-webapp, including its current
`create_document`, `is_admin`, audit and document-number triggers. The repository's
three old migrations alone are NOT a full production schema baseline.

The code and migration must be released together. The client fails closed when
`sales_workflow` is absent; it never falls back to old multi-request stock writes.
No production migration, production data repair or deployment is implied merely
by merging this pull request.

## Included

* Five navigation groups: today's work, sales, billing/history, inventory/products,
  and master/settings. Dashboard counts open the corresponding filters.
* Preserve product codes, categories and click-to-filter from main. Quantity is
  read-only in the product master; receiving/adjustment records are separate.
* AI output and copied documents remain drafts until explicitly confirmed.
  Formal PDF generation is unavailable for an unsaved AI draft.
* One versioned RPC performs creation, quantity changes, invoice conversion,
  document cancellation or manual adjustment in one PostgreSQL transaction.
* User-scoped idempotency keys, retry persistence, row locks, expected-updated-at
  checks, positive quantities, finite monetary values and insufficient-stock guards.
* Estimates and receipts never ship. A direct invoice does not ship unless the
  operator explicitly selects the shipment option. Delivery-note registration
  includes a visible shipment option. Units must agree with the product master.
* Stock-managed rows resolve product UUIDs. Unknown/ambiguous products must be
  registered/selected explicitly; they are not silently inserted with negative stock.
* Quantity changes reconcile actual logged quantities; price-only changes do not
  move stock. Unknown legacy stock states are not inferred or bulk updated.
* Grouped invoices retain source deliveries and their stock logs. Re-invoicing
  already-linked deliveries is rejected. Cancellation releases invoice links,
  but does not physically return goods.
* Cancellation is non-destructive and requires a reason. The default does not
  return stock. Explicit reversal is for an unshipped erroneous registration;
  actual returned goods must be received separately.
* Tax calculation groups amounts by tax rate, rounds gross totals half-up to yen,
  computes tax once per rate, and preserves total = net + tax. JS and PostgreSQL
  use the same calculation, and new issued documents store a versioned tax snapshot.
* An amount-only receipt, or a manual amount that disagrees with its detail, has
  unknown tax instead of a guessed 8% tax. Screen/export/PDF calculations agree.
* Ordinary chat responses no longer update product origins. Product master writes
  check that the server actually returned an affected record.

Tax calculation reference:
https://www.nta.go.jp/taxes/shiraberu/taxanswer/shohi/6371.htm

## Verification

`npm ci --ignore-scripts && npm test && npm run build`

35 automated tests cover monetary regressions, 2,000 mixed-total invariants,
client retry behavior, isolated PostgreSQL atomicity, permissions, source invoice
links, cancellation/reversal, stale edits and legacy protection. PGlite is pinned
at 0.3.14 in the lockfile. Tests use synthetic users/data, not the production DB.
PGlite does not constitute a multi-connection production concurrency load test.

Seven offline Chromium checks exercise the actual UI with mocked auth/data:
home, product content filtering, cancellation without stock return, copy-as-draft,
AI draft confirmation, one create after confirmation and mobile width. There were
no JavaScript errors or unexpected alerts. This is NOT a real Google OAuth or
production Supabase browser acceptance test.

Reproduce offline UI checks with Python Playwright and Chromium installed:

```sh
node scripts/qa/bundle-ui.mjs
python scripts/qa/ui_smoke.py
```

The script uses `/usr/bin/chromium`; adjust the executable path on other systems.
Screenshots are written under ignored `tmp/qa`. No real credentials are required.
Three generated PDF samples were rendered and inspected: mixed total 2,160 JPY,
10% receipt 1,100 JPY / tax 100 JPY, and amount-only receipt with unknown tax.

## Release sequence

1. Record current production deployment/commit and database migration versions.
   Take the normal database backup. Do not reconstruct old inventory from documents.
2. Verify the additive migration against a non-production copy of the current
   schema (not just the incomplete old repository migration history). Confirm
   organization access settings and existing ownership/admin expectations.
3. Apply `supabase/migrations/20261027220243_atomic_sales_workflows.sql` through
   the authorized migration process, then refresh the API schema cache.
4. Build and test a preview of this exact commit with the correct environment.
   Complete real-login checks as ordinary user and administrator, including
   stock-managed/non-stock documents, stale editors and network retries.
5. Promote that verified build, and require existing browser tabs to reload.
   Confirm public deployment commit, document/stock counts and audit entries.
6. Retire legacy mutating RPCs and direct stock/log writes only after checking
   for other clients. Existing legacy APIs/policies were deliberately not revoked
   in this additive migration, to avoid breaking an unknown integration or the
   currently deployed old client. This compatibility boundary remains a release
   hardening item, not a claim that all old API access is fixed.

A source-only rollback to the previously unsafe client is not a safe stock repair.
On failure, stop writes, retain new audit records and inspect affected requests;
do not delete the request ledger or apply a blanket inverse adjustment.

## Not included

Lot/warehouse/dual-weight/reservation modules, PCA synchronization, payment
allocation, automatic historical repair, full authorization-policy redesign and
an authenticated production end-to-end test are separate work. Existing legacy
PDFs without a stored tax snapshot must have their amount checked before reissue.
The previous unsafe automatic duplicate-product merge is removed, not replaced
with an unverified merge/mass-delete operation.
