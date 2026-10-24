/** Questions and assistant requests that the basic expense parser cannot handle. */
export function isVoiceAssistantRequest(transcript: string): boolean {
  const words = transcript.trim();
  return (
    /[?؟][\s”"'»]*$/.test(words) ||
    /^(?:(?:hey\s+)?waves[,!]?\s+)?(?:who|what|how|when|where|why|which|whose|show|list|tell|(?:can|could|would)\s+you(?!\s+(?:please\s+)?(?:add|log|record|put|save|create|split|note|enter|make)\b)|please\s+(?:show|list|tell))\b/i.test(
      words,
    )
  );
}
