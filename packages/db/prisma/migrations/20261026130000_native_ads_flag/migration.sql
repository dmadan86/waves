-- Native list cards require this flag AND rewarded ads eligibility.
INSERT INTO public.feature_flags (key, description, enabled, rollout_percent, variants)
VALUES ('ads_native', 'One native Ad card after eight Activity or Friends rows for eligible Free users.', false, 0, ARRAY['control', 'treatment'])
ON CONFLICT (key) DO NOTHING;
