-- Index foreign-key columns used by joins and referential checks.
CREATE INDEX IF NOT EXISTS activity_log_actor_member_id_idx ON public.activity_log (actor_member_id);
CREATE INDEX IF NOT EXISTS api_authorization_codes_app_id_idx ON public.api_authorization_codes (app_id);
CREATE INDEX IF NOT EXISTS api_authorization_codes_profile_id_idx ON public.api_authorization_codes (profile_id);
CREATE INDEX IF NOT EXISTS api_tokens_parent_id_idx ON public.api_tokens (parent_id);
CREATE INDEX IF NOT EXISTS campaign_email_sends_profile_id_idx ON public.campaign_email_sends (profile_id);
CREATE INDEX IF NOT EXISTS campaign_impressions_profile_id_idx ON public.campaign_impressions (profile_id);
CREATE INDEX IF NOT EXISTS campaigns_promo_code_idx ON public.campaigns (promo_code);
CREATE INDEX IF NOT EXISTS category_tags_pack_id_idx ON public.category_tags (pack_id);
CREATE INDEX IF NOT EXISTS email_events_notification_id_idx ON public.email_events (notification_id);
CREATE INDEX IF NOT EXISTS expense_attachments_uploader_member_id_idx ON public.expense_attachments (uploader_member_id);
CREATE INDEX IF NOT EXISTS expense_comments_author_member_id_idx ON public.expense_comments (author_member_id);
CREATE INDEX IF NOT EXISTS expense_comments_deleted_by_idx ON public.expense_comments (deleted_by);
CREATE INDEX IF NOT EXISTS expense_comments_flagged_by_idx ON public.expense_comments (flagged_by);
CREATE INDEX IF NOT EXISTS expense_disputes_member_id_idx ON public.expense_disputes (member_id);
CREATE INDEX IF NOT EXISTS expense_disputes_resolved_by_member_id_idx ON public.expense_disputes (resolved_by_member_id);
CREATE INDEX IF NOT EXISTS expense_image_events_actor_member_id_idx ON public.expense_image_events (actor_member_id);
CREATE INDEX IF NOT EXISTS expense_payers_member_id_idx ON public.expense_payers (member_id);
CREATE INDEX IF NOT EXISTS expense_shares_member_id_idx ON public.expense_shares (member_id);
CREATE INDEX IF NOT EXISTS expense_versions_author_member_id_idx ON public.expense_versions (author_member_id);
CREATE INDEX IF NOT EXISTS expense_versions_import_batch_id_idx ON public.expense_versions (import_batch_id);
CREATE INDEX IF NOT EXISTS expense_versions_receipt_id_idx ON public.expense_versions (receipt_id);
CREATE INDEX IF NOT EXISTS expenses_created_by_idx ON public.expenses (created_by);
CREATE INDEX IF NOT EXISTS expenses_deleted_by_idx ON public.expenses (deleted_by);
CREATE INDEX IF NOT EXISTS feedback_profile_id_idx ON public.feedback (profile_id);
CREATE INDEX IF NOT EXISTS ghost_merges_member_id_idx ON public.ghost_merges (member_id);
CREATE INDEX IF NOT EXISTS group_balances_member_id_idx ON public.group_balances (member_id);
CREATE INDEX IF NOT EXISTS group_members_import_batch_id_idx ON public.group_members (import_batch_id);
CREATE INDEX IF NOT EXISTS group_members_profile_id_idx ON public.group_members (profile_id);
CREATE INDEX IF NOT EXISTS group_members_removed_by_idx ON public.group_members (removed_by);
CREATE INDEX IF NOT EXISTS group_passes_purchased_by_idx ON public.group_passes (purchased_by);
CREATE INDEX IF NOT EXISTS group_recurring_expenses_created_by_idx ON public.group_recurring_expenses (created_by);
CREATE INDEX IF NOT EXISTS import_batches_actor_member_id_idx ON public.import_batches (actor_member_id);
CREATE INDEX IF NOT EXISTS import_batches_undone_by_idx ON public.import_batches (undone_by);
CREATE INDEX IF NOT EXISTS invites_created_by_idx ON public.invites (created_by);
CREATE INDEX IF NOT EXISTS member_claims_decided_by_idx ON public.member_claims (decided_by);
CREATE INDEX IF NOT EXISTS member_claims_member_id_idx ON public.member_claims (member_id);
CREATE INDEX IF NOT EXISTS notifications_group_id_idx ON public.notifications (group_id);
CREATE INDEX IF NOT EXISTS pack_installs_pack_id_idx ON public.pack_installs (pack_id);
CREATE INDEX IF NOT EXISTS pack_requests_requester_id_idx ON public.pack_requests (requester_id);
CREATE INDEX IF NOT EXISTS pairwise_balances_from_member_id_idx ON public.pairwise_balances (from_member_id);
CREATE INDEX IF NOT EXISTS pairwise_balances_to_member_id_idx ON public.pairwise_balances (to_member_id);
CREATE INDEX IF NOT EXISTS promo_redemptions_subscription_id_idx ON public.promo_redemptions (subscription_id);
CREATE INDEX IF NOT EXISTS receipt_item_claims_member_id_idx ON public.receipt_item_claims (member_id);
CREATE INDEX IF NOT EXISTS referrals_code_idx ON public.referrals (code);
CREATE INDEX IF NOT EXISTS reminders_from_member_id_idx ON public.reminders (from_member_id);
CREATE INDEX IF NOT EXISTS reminders_to_member_id_idx ON public.reminders (to_member_id);
CREATE INDEX IF NOT EXISTS settlement_allocations_expense_id_idx ON public.settlement_allocations (expense_id);
CREATE INDEX IF NOT EXISTS settlement_proofs_uploader_member_id_idx ON public.settlement_proofs (uploader_member_id);
CREATE INDEX IF NOT EXISTS settlements_from_member_id_idx ON public.settlements (from_member_id);
CREATE INDEX IF NOT EXISTS settlements_import_batch_id_idx ON public.settlements (import_batch_id);
CREATE INDEX IF NOT EXISTS settlements_to_member_id_idx ON public.settlements (to_member_id);
CREATE INDEX IF NOT EXISTS storage_objects_group_id_idx ON public.storage_objects (group_id);
CREATE INDEX IF NOT EXISTS sync_mutations_group_id_idx ON public.sync_mutations (group_id);
CREATE INDEX IF NOT EXISTS trip_photos_created_by_idx ON public.trip_photos (created_by);
CREATE INDEX IF NOT EXISTS trip_plan_items_created_by_idx ON public.trip_plan_items (created_by);
CREATE INDEX IF NOT EXISTS trip_plan_items_expense_id_idx ON public.trip_plan_items (expense_id);
CREATE INDEX IF NOT EXISTS usage_events_group_id_idx ON public.usage_events (group_id);
CREATE INDEX IF NOT EXISTS voice_attempts_profile_id_idx ON public.voice_attempts (profile_id);
CREATE INDEX IF NOT EXISTS voice_stream_reservations_profile_id_idx ON public.voice_stream_reservations (profile_id);

-- Merge overlapping policies; anon was dropped since waves_current_profile_id() is null for anon.
DROP POLICY IF EXISTS group_members_update ON public.group_members;
DROP POLICY IF EXISTS group_members_update_self ON public.group_members;
CREATE POLICY group_members_update ON public.group_members
FOR UPDATE TO authenticated
USING ((public.is_group_member(group_id) AND profile_id IS NULL) OR profile_id = public.waves_current_profile_id())
WITH CHECK ((public.is_group_member(group_id) AND profile_id IS NULL) OR profile_id = public.waves_current_profile_id());

DROP POLICY IF EXISTS profiles_select_co_members ON public.profiles;
DROP POLICY IF EXISTS profiles_select_self ON public.profiles;
CREATE POLICY profiles_select ON public.profiles
FOR SELECT TO authenticated
USING ((id = public.waves_current_profile_id()) OR (EXISTS ( SELECT 1
   FROM (public.group_members mine
     JOIN public.group_members theirs ON ((theirs.group_id = mine.group_id)))
  WHERE ((mine.profile_id = public.waves_current_profile_id()) AND (mine.left_at IS NULL) AND (theirs.profile_id = profiles.id)))));
