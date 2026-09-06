-- Five packs, so the shelf is not empty on the day it opens.
--
-- A marketplace with nothing in it teaches people not to come back, and the
-- first person to look will look once. These are the five vocabularies the
-- built-ins most obviously do not cover: a country's everyday words, and the
-- four ways of earning and spending that the general list cannot serve without
-- becoming everybody's problem.
--
-- Every icon here is in the curated set (`TAG_ICONS` in @waves/core) and every
-- tint is one of the six, which is what `parsePack` insists on — these rows go
-- in through the same gate the console uses, so a typo would surface as a pack
-- the client silently drops rather than a blank box on somebody's phone. Keep
-- that true when adding more.
--
-- Idempotent on the slug, so re-running this changes nothing.

INSERT INTO public.packs (slug, title, summary, status, version, entries) VALUES
(
  'india-everyday',
  'India · everyday',
  'The words an Indian household actually uses — the ones a general category list has no room for.',
  'published',
  1,
  '[
    {"key":"kirana","label":"Kirana","icon":"storefront-outline","tint":"mint","axis":"expense"},
    {"key":"auto","label":"Auto","icon":"car-outline","tint":"peach","axis":"expense"},
    {"key":"chit-fund","label":"Chit fund","icon":"people-outline","tint":"lilac","axis":"expense"},
    {"key":"maid","label":"House help","icon":"person-outline","tint":"sky","axis":"expense"},
    {"key":"tiffin","label":"Tiffin","icon":"fast-food-outline","tint":"peach","axis":"expense"},
    {"key":"puja","label":"Puja","icon":"flower-outline","tint":"pink","axis":"expense"},
    {"key":"recharge","label":"Recharge","icon":"call-outline","tint":"sky","axis":"expense"},
    {"key":"fd-interest","label":"Deposit interest","icon":"trending-up-outline","tint":"mint","axis":"income"},
    {"key":"pf","label":"Provident fund","icon":"shield-checkmark-outline","tint":"mint","axis":"income"}
  ]'::jsonb
),
(
  'freelance',
  'Freelance',
  'Invoices in, tools and taxes out — for anybody billing their own clients.',
  'published',
  1,
  '[
    {"key":"client-invoice","label":"Client invoice","icon":"document-text-outline","tint":"sky","axis":"income"},
    {"key":"retainer","label":"Retainer","icon":"calendar-outline","tint":"mint","axis":"income"},
    {"key":"advance","label":"Advance","icon":"cash-outline","tint":"lilac","axis":"income"},
    {"key":"software","label":"Software","icon":"laptop-outline","tint":"lilac","axis":"expense"},
    {"key":"equipment","label":"Equipment","icon":"desktop-outline","tint":"sky","axis":"expense"},
    {"key":"coworking","label":"Coworking","icon":"business-outline","tint":"peach","axis":"expense"},
    {"key":"tax-set-aside","label":"Tax set aside","icon":"calculator-outline","tint":"coral","axis":"expense"},
    {"key":"accountant","label":"Accountant","icon":"briefcase-outline","tint":"mint","axis":"expense"}
  ]'::jsonb
),
(
  'landlord',
  'Letting a property',
  'Rent coming in, and everything a property costs to keep.',
  'published',
  1,
  '[
    {"key":"rent-received","label":"Rent received","icon":"home-outline","tint":"mint","axis":"income"},
    {"key":"deposit-held","label":"Deposit held","icon":"key-outline","tint":"sky","axis":"income"},
    {"key":"repairs","label":"Repairs","icon":"hammer-outline","tint":"peach","axis":"expense"},
    {"key":"maintenance","label":"Maintenance","icon":"construct-outline","tint":"lilac","axis":"expense"},
    {"key":"property-tax","label":"Property tax","icon":"receipt-outline","tint":"coral","axis":"expense"},
    {"key":"insurance","label":"Insurance","icon":"shield-checkmark-outline","tint":"sky","axis":"expense"},
    {"key":"agent-fee","label":"Agent fee","icon":"pricetag-outline","tint":"pink","axis":"expense"}
  ]'::jsonb
),
(
  'student',
  'Student',
  'Fees, books and the small money of term time.',
  'published',
  1,
  '[
    {"key":"tuition","label":"Tuition","icon":"school-outline","tint":"lilac","axis":"expense"},
    {"key":"books","label":"Books","icon":"book-outline","tint":"peach","axis":"expense"},
    {"key":"hostel","label":"Hostel","icon":"bed-outline","tint":"sky","axis":"expense"},
    {"key":"printing","label":"Printing","icon":"print-outline","tint":"mint","axis":"expense"},
    {"key":"society","label":"Clubs & societies","icon":"people-outline","tint":"pink","axis":"expense"},
    {"key":"scholarship","label":"Scholarship","icon":"ribbon-outline","tint":"mint","axis":"income"},
    {"key":"part-time","label":"Part-time work","icon":"briefcase-outline","tint":"sky","axis":"income"},
    {"key":"from-family","label":"From family","icon":"heart-outline","tint":"pink","axis":"income"}
  ]'::jsonb
),
(
  'travel',
  'A long trip',
  'The costs a trip has that everyday life does not.',
  'published',
  1,
  '[
    {"key":"flights","label":"Flights","icon":"airplane-outline","tint":"sky","axis":"expense"},
    {"key":"visa","label":"Visa","icon":"document-text-outline","tint":"lilac","axis":"expense"},
    {"key":"travel-insurance","label":"Travel insurance","icon":"umbrella-outline","tint":"mint","axis":"expense"},
    {"key":"sim","label":"Local SIM","icon":"call-outline","tint":"peach","axis":"expense"},
    {"key":"laundry","label":"Laundry","icon":"shirt-outline","tint":"sky","axis":"expense"},
    {"key":"tips","label":"Tips","icon":"happy-outline","tint":"pink","axis":"expense"},
    {"key":"souvenirs","label":"Souvenirs","icon":"gift-outline","tint":"coral","axis":"expense"},
    {"key":"tours","label":"Tours","icon":"map-outline","tint":"mint","axis":"expense"}
  ]'::jsonb
)
ON CONFLICT (slug) DO NOTHING;
