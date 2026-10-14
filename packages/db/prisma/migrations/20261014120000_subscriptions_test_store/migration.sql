-- Purchases made through RevenueCat's Test Store (a `test_` SDK key) get their
-- own store value, 'test', so a test purchase unlocks what a real one would
-- and stays easy to find and delete. The webhook drops them when
-- REVENUECAT_IGNORE_SANDBOX is on.

ALTER TABLE public.subscriptions DROP CONSTRAINT IF EXISTS subscriptions_store_known;
ALTER TABLE public.subscriptions ADD CONSTRAINT subscriptions_store_known
  CHECK (store = ANY (ARRAY['play'::text, 'appstore'::text, 'promo'::text, 'test'::text]));
