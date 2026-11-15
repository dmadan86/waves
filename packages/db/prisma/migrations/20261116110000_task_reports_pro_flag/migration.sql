-- Team › Tasks reports 2-4 (per person, per site, overdue) are free until this flag is turned on.
-- Turn it on (Enabled, 100%) in the admin Flags page to make them Pro, no app release needed.
INSERT INTO public.feature_flags (key, description, enabled, rollout_percent, variants)
VALUES ('task_reports_pro', 'Task reports other than the plain task list need Pro while this is on.', false, 100, ARRAY['control', 'treatment'])
ON CONFLICT (key) DO NOTHING;
