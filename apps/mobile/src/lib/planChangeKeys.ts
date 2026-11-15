/** Query prefixes whose server answers depend on the current plan or ad state. */
export const PLAN_CHANGE_QUERY_KEYS = [
  ['voiceAgentEnabled'],
  ['voiceAccess'],
  ['myPlan'],
  ['myPlanVoiceRouting'],
  ['myProTrial'],
  ['adsStatus'],
  ['bannerGate'],
  ['credits'],
  ['receiptCap'],
  ['adChoicesVisible'],
  ['attachmentCap'],
  ['photoGate'],
  ['is-paid-storage'],
  ['storage-usage'],
] as const;
