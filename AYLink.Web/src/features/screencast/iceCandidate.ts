export function normalizeIceCandidate(candidate: unknown): RTCIceCandidateInit | null {
  function ensureCandidatePrefix(input: string): string {
    const text = input.trim();
    return text.startsWith('candidate:') ? text : `candidate:${text}`;
  }

  function deepParseCandidateText(input: string, maxDepth = 5): string {
    let current = input;
    let depth = 0;
    while (depth < maxDepth) {
      try {
        const parsed = JSON.parse(current);
        if (parsed && typeof parsed === 'object' && typeof parsed.candidate === 'string') {
          current = parsed.candidate;
          depth++;
          continue;
        }
      } catch {
        break;
      }
      break;
    }
    return current;
  }

  if (!candidate) return null;

  if (typeof candidate === 'string') {
    try {
      const parsed = JSON.parse(candidate);
      if (parsed && typeof parsed === 'object') {
        let candidateText = parsed.candidate;
        if (typeof candidateText === 'string') {
          candidateText = deepParseCandidateText(candidateText);
        }
        const normalized: RTCIceCandidateInit = { candidate: ensureCandidatePrefix(String(candidateText)) };
        if (typeof parsed.sdpMid === 'string') normalized.sdpMid = parsed.sdpMid;
        if (typeof parsed.sdpMLineIndex === 'number') normalized.sdpMLineIndex = parsed.sdpMLineIndex;
        if (typeof parsed.usernameFragment === 'string') normalized.usernameFragment = parsed.usernameFragment;
        if (normalized.sdpMid === undefined && normalized.sdpMLineIndex === undefined) {
          normalized.sdpMLineIndex = 0;
        }
        return normalized;
      }
    } catch {
      return { candidate: ensureCandidatePrefix(candidate), sdpMLineIndex: 0 };
    }
  }

  if (typeof candidate !== 'object') {
    console.warn('Invalid ICE candidate payload:', candidate);
    return null;
  }

  const value = candidate as Record<string, unknown>;
  let candidateText = value.candidate ?? value.Candidate;
  if (typeof candidateText === 'string') {
    candidateText = deepParseCandidateText(candidateText);
  }
  if (typeof candidateText !== 'string' || candidateText.length === 0) {
    return null;
  }

  const normalized: RTCIceCandidateInit = { candidate: ensureCandidatePrefix(candidateText) };
  const sdpMid = value.sdpMid ?? value.SdpMid;
  const sdpMLineIndex = value.sdpMLineIndex ?? value.SdpMLineIndex;
  const usernameFragment = value.usernameFragment ?? value.UsernameFragment;

  if (typeof sdpMid === 'string' && sdpMid.length > 0) normalized.sdpMid = sdpMid;
  if (typeof sdpMLineIndex === 'number') {
    normalized.sdpMLineIndex = sdpMLineIndex;
  } else if (typeof sdpMLineIndex === 'string' && sdpMLineIndex.length > 0) {
    const parsedIndex = Number(sdpMLineIndex);
    if (Number.isInteger(parsedIndex)) normalized.sdpMLineIndex = parsedIndex;
  }
  if (normalized.sdpMid === undefined && normalized.sdpMLineIndex === undefined) {
    normalized.sdpMLineIndex = 0;
  }
  if (typeof usernameFragment === 'string') normalized.usernameFragment = usernameFragment;

  return normalized;
}
