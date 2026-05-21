const LOCAL_WEBRTC_OVERRIDE_ENABLED_KEY = 'aylink.webrtc.override.enabled';
const LOCAL_WEBRTC_OVERRIDE_CONFIG_KEY = 'aylink.webrtc.override.config';

export interface WebRtcIceServerPayload {
  Urls?: string[];
  Username?: string | null;
  Credential?: string | null;
}

export interface WebRtcNetworkSettingsPayload {
  IceTransportPolicy?: string;
  IceServers?: WebRtcIceServerPayload[];
  HostCandidateOverrideEnabled?: boolean;
  HostCandidateOverrideIPs?: string[];
  HostCandidatePortMin?: number | null;
  HostCandidatePortMax?: number | null;
  SinglePortMuxEnabled?: boolean;
  SinglePortMuxBindPort?: number | null;
  SinglePortMuxPublishPort?: number | null;
}

function buildScopedKey(baseKey: string, scope = 'anonymous') {
  return `${baseKey}.${scope}`;
}

export function loadLocalWebRtcOverrideEnabled(scope?: string) {
  return localStorage.getItem(buildScopedKey(LOCAL_WEBRTC_OVERRIDE_ENABLED_KEY, scope)) === 'true';
}

export function setLocalWebRtcOverrideEnabled(enabled: boolean, scope?: string) {
  localStorage.setItem(buildScopedKey(LOCAL_WEBRTC_OVERRIDE_ENABLED_KEY, scope), String(enabled));
}

export function loadLocalWebRtcOverrideConfig(scope?: string): WebRtcNetworkSettingsPayload | null {
  const raw = localStorage.getItem(buildScopedKey(LOCAL_WEBRTC_OVERRIDE_CONFIG_KEY, scope));
  if (!raw) {
    return null;
  }

  try {
    return JSON.parse(raw) as WebRtcNetworkSettingsPayload;
  } catch {
    return null;
  }
}

export function saveLocalWebRtcOverrideConfig(payload: WebRtcNetworkSettingsPayload, scope?: string) {
  localStorage.setItem(buildScopedKey(LOCAL_WEBRTC_OVERRIDE_CONFIG_KEY, scope), JSON.stringify(payload));
}

export function clearLocalWebRtcOverrideConfig(scope?: string) {
  localStorage.removeItem(buildScopedKey(LOCAL_WEBRTC_OVERRIDE_CONFIG_KEY, scope));
}
