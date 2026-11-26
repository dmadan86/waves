/** Tables whose changes make an open group pull. Each must be in the supabase_realtime publication. */
export const GROUP_REALTIME_TABLES = [
  'expenses',
  'settlements',
  'group_members',
  'activity_log',
  'expense_comments',
] as const;
