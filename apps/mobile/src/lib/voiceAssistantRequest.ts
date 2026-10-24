/** Questions and assistant requests that the basic expense parser cannot handle. */
export function isVoiceAssistantRequest(transcript: string): boolean {
  const words = transcript.trim();
  return (
    /[?؟][\s”"'»]*$/.test(words) ||
    /^(?:(?:hey\s+)?waves[,!]?\s+)?(?:who|what|how|when|where|why|which|whose|show|list|tell|can\s+you|could\s+you|would\s+you|please\s+(?:show|list|tell))\b/i.test(
      words,
    )
  );
}
