import { readLocalBoolean, readLocalJson, removeLocalValue, writeLocalBoolean, writeLocalJson } from '../core/storage/browserStorage';
import { buildScopedStorageKey, storageKeys } from '../core/storage/keys';

const LOCAL_WEBRTC_OVERRIDE_ENABLED_KEY = storageKeys.webrtc.overrideEnabled;
const LOCAL_WEBRTC_OVERRIDE_CONFIG_KEY = storageKeys.webrtc.overrideConfig;

export interface WebRtcIceServerPayload {
  Urls?: string[];
  Username?: string | null;
  Credential?: string | null;
}

export interface WebRtcNetworkSettingsPayload {
  IceTransportPolicy?: string;
  FallbackLocale?: string;
  IceServers?: WebRtcIceServerPayload[];
  HostCandidateOverrideEnabled?: boolean;
  HostCandidateOverrideIPs?: string[];
  HostCandidatePortMin?: number | null;
  HostCandidatePortMax?: number | null;
  SinglePortMuxEnabled?: boolean;
  SinglePortMuxBindPort?: number | null;
  SinglePortMuxPublishPort?: number | null;
}

export function toRtcConfiguration(settings?: WebRtcNetworkSettingsPayload | null): RTCConfiguration {
  const servers = (settings?.IceServers ?? []).map((server) => {
    const urls = (server.Urls ?? []).map((url) => url.trim()).filter(Boolean);
    return urls.length ? { urls: urls.length === 1 ? urls[0] : urls, username: server.Username ?? undefined, credential: server.Credential ?? undefined } : null;
  }).filter((server): server is NonNullable<typeof server> => server !== null);
  return {
    iceServers: servers.length ? servers : [{ urls: 'stun:stun.l.google.com:19302' }],
    iceTransportPolicy: settings?.IceTransportPolicy === 'relay' ? 'relay' : 'all',
  };
}

export function loadLocalWebRtcOverrideEnabled(scope?: string) {
  return readLocalBoolean(buildScopedStorageKey(LOCAL_WEBRTC_OVERRIDE_ENABLED_KEY, scope));
}

export function loadLocalWebRtcFileTransferPreferred(scope?: string) {
  return readLocalBoolean(buildScopedStorageKey(storageKeys.webrtc.fileTransferPreferred, scope), true);
}

export function setLocalWebRtcFileTransferPreferred(preferred: boolean, scope?: string) {
  writeLocalBoolean(buildScopedStorageKey(storageKeys.webrtc.fileTransferPreferred, scope), preferred);
}

export function setLocalWebRtcOverrideEnabled(enabled: boolean, scope?: string) {
  writeLocalBoolean(buildScopedStorageKey(LOCAL_WEBRTC_OVERRIDE_ENABLED_KEY, scope), enabled);
}

export function loadLocalWebRtcOverrideConfig(scope?: string): WebRtcNetworkSettingsPayload | null {
  return readLocalJson<WebRtcNetworkSettingsPayload>(buildScopedStorageKey(LOCAL_WEBRTC_OVERRIDE_CONFIG_KEY, scope));
}

export function saveLocalWebRtcOverrideConfig(payload: WebRtcNetworkSettingsPayload, scope?: string) {
  writeLocalJson(buildScopedStorageKey(LOCAL_WEBRTC_OVERRIDE_CONFIG_KEY, scope), payload);
}

export function clearLocalWebRtcOverrideConfig(scope?: string) {
  removeLocalValue(buildScopedStorageKey(LOCAL_WEBRTC_OVERRIDE_CONFIG_KEY, scope));
}
