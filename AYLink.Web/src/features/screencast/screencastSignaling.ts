export interface SignalTicketRequestInput {
  deviceId: string;
  sessionId?: string;
  newPeerConnection?: boolean;
  appPackage?: string;
  appName?: string;
  newDisplay: boolean;
  newDisplayWidth?: number;
  newDisplayHeight?: number;
  newDisplayDpi?: number;
}

export interface BrowserLocationLike {
  protocol: string;
  host: string;
}

export interface SignalWebSocketBaseUrlOptions {
  overrideUrl?: string | null;
}

export function buildSignalWebSocketBaseUrl(location: BrowserLocationLike, options: SignalWebSocketBaseUrlOptions = {}): string {
  const overrideUrl = options.overrideUrl?.trim();
  if (overrideUrl) {
    return overrideUrl;
  }

  const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${protocol}//${location.host}/webrtc`;
}

export function buildSignalTicketRequestBody(input: SignalTicketRequestInput): Record<string, string | number | boolean | undefined> {
  return {
    deviceId: input.deviceId,
    sessionId: input.sessionId || undefined,
    newPeerConnection: input.newPeerConnection || undefined,
    appPackage: input.appPackage || undefined,
    appName: input.appName || undefined,
    newDisplay: input.newDisplay,
    newDisplayWidth: input.newDisplayWidth,
    newDisplayHeight: input.newDisplayHeight,
    newDisplayDpi: input.newDisplayDpi
  };
}

export function buildSignalWebSocketUrl(baseUrl: string, ticket: unknown): string {
  return `${baseUrl}?ticket=${encodeURIComponent(String(ticket ?? ''))}`;
}
