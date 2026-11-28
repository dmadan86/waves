# Company UI pass, 2026-11-28

Audit of 39 company screens and 102 company components (code only; no device run).

## Found

- Left-aligned stacked buttons (Button without fullWidth is alignSelf flex-start): 33 fixed
  (vendor order/receipt/line, inquiry detail/parts, employment sheet, iOS date pickers, work export, ask-advance, suspended report).
- Approve/Reject rows had the primary on the left: reordered to secondary then primary, equal width (vendor line).
- RTL: 3 left/right indents changed to start/end (CompanyPeople, company-entry).
- Kebabs: all use OverflowMenu (0 issues). Headers: all sub-screens use a standard header (thin route wrappers excluded).
- Hex colours: ~95 in 30 files, nearly all status/category palettes or white-on-fill; not changed.

## Mobbin references

Airwallex approval detail, Instacart order approval, Monzo review payment, Wise request: full-width primary stacked over a secondary.

## Left for later

- Status/category palette hex values to theme tokens (dashboard/parts.tsx, vendors/parts.tsx, work/*).
- Centred/left empty-state buttons (wages, vendors tab, follow-ups, tickets) left as is.
- AgentAccessSection uses a Button labelled the kebab glyph instead of OverflowMenu trigger.
- No on-device screenshot check: emulator 5558 not touched.
