-- Log the Home-list banner ad: allow the 'home_banner' placement.
ALTER TABLE public.ad_events DROP CONSTRAINT ad_events_placement_check;
ALTER TABLE public.ad_events ADD CONSTRAINT ad_events_placement_check CHECK (placement IN
 ('expense_interstitial','group_create_rewarded','export_rewarded','native_list','quota_rewarded','credit_voluntary','credit_offer','review_banner','home_banner'));
