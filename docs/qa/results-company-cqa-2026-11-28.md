# Company E2E (night run) - 2026-11-28 - PARTIAL

The full multi-user device run was NOT completed. Android emulator-5556 loads the preview app
signed in as U1 (+wavestest1) but U1 has no company yet; creating accounts, devices and email
codes was not reached. No scenario below was verified on a device.

Scenarios 1-6 and 8: NOT RUN. Scenario 7: code audit only.

## Code audit: employee deep link to manager-only screens
- Gated: company-leave-policy, company-import, company-vendor-order, company-vendor-payment, TeamScreen, company-wages.
- company-vendor-add was NOT gated (employee got a working save the server refuses). FIXED here (test: apps/mobile/test/vendorAddAdminGuard.test.ts).

## Not covered
All device flows; the vendor web portal (apps/web/src/app/c/[groupId]/vendors/*).

## UI for the layout agent
None observed.
