-- Per-person UI preferences that follow the account across devices (first user: the company Overview card layout,
-- keyed by company id). JSON for the same reason as notification_prefs: a column per switch would be a migration per idea.
-- waves_my_profile() returns SETOF profiles, so clients read it with no function change; the owner updates their own row.
ALTER TABLE public.profiles ADD COLUMN ui_prefs jsonb NOT NULL DEFAULT '{}'::jsonb;
