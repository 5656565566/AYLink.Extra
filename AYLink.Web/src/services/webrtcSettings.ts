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

export function loadLocalWebRtcOverrideEnabled(scope?: string) {
  return readLocalBoolean(buildScopedStorageKey(LOCAL_WEBRTC_OVERRIDE_ENABLED_KEY, scope));
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
