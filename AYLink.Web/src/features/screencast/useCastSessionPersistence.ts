import type { PersistedCastConnection } from '../../types/screencast';
import { useAppSettings } from '../../services/appSettings';
import { createCastPageHeartbeat } from './castPageHeartbeat';

declare global {
  interface Window {
    __aylinkPersistedCastConnections?: Record<string, PersistedCastConnection>;
  }
}

export function useCastSessionPersistence(onPageExpired: () => void = () => {}) {
  const { activeCastSessionCount } = useAppSettings();
  const audioElements = new Map<string, HTMLAudioElement>();
  const lastViewed = new Map<string, number>();
  let viewSequence = 0;
  let viewingTabKey = '';
  let audioMuted = false;
  const pageHeartbeat = createCastPageHeartbeat(() => { disposeAllPersistedConnections(); onPageExpired(); });

  const releaseCastSession = async (deviceId: string, sessionId: string) => {
    try {
      await pageHeartbeat.releaseSession(deviceId, sessionId);
    } catch (error) {
      console.warn('Failed to release cast session:', error);
    }
  };

  const getPersistentAudioElement = (tabKey: string) => {
    let element = audioElements.get(tabKey);
    if (!element) {
      element = new Audio();
      element.autoplay = true;
      element.muted = audioMuted || tabKey !== viewingTabKey;
      element.setAttribute('playsinline', '');
      audioElements.set(tabKey, element);
    }
    return element;
  };

  const setAudioMuted = (muted: boolean) => {
    audioMuted = muted;
    for (const [tabKey, element] of audioElements) element.muted = muted || tabKey !== viewingTabKey;
  };

  const setViewingTab = (tabKey: string) => {
    viewingTabKey = tabKey;
    setAudioMuted(audioMuted);
    if (tabKey) lastViewed.set(tabKey, ++viewSequence);
  };

  const enforceActiveSessionLimit = () => {
    const background = Object.keys(window.__aylinkPersistedCastConnections ?? {})
      .filter((key) => key !== viewingTabKey)
      .sort((a, b) => (lastViewed.get(b) ?? 0) - (lastViewed.get(a) ?? 0));
    for (const key of background.slice(activeCastSessionCount.value)) disposePersistedConnection(key);
  };

  const clearPersistedConnection = (tabKey: string) => {
    const audio = audioElements.get(tabKey) ?? window.__aylinkPersistedCastConnections?.[tabKey]?.audioElement;
    if (audio) { audio.pause(); audio.srcObject = null; audioElements.delete(tabKey); }
    if (!tabKey || !window.__aylinkPersistedCastConnections) {
      return;
    }

    delete window.__aylinkPersistedCastConnections[tabKey];
    if (Object.keys(window.__aylinkPersistedCastConnections).length === 0) {
      window.__aylinkPersistedCastConnections = undefined;
    }
  };

  const getPersistedConnection = (tabKey: string) => {
    if (!tabKey) {
      return null;
    }

    return window.__aylinkPersistedCastConnections?.[tabKey] ?? null;
  };

  const disposePersistedConnection = (tabKey: string) => {
    const persisted = window.__aylinkPersistedCastConnections?.[tabKey];
    if (!persisted) {
      return;
    }
    clearPersistedConnection(tabKey);
    persisted.stopBackgroundHandlers?.();

    try {
      persisted.dataChannel?.close();
    } catch {
      // 关闭缓存连接的数据通道失败时 继续清理其余资源
    }

    try {
      persisted.metaControlChannel?.close();
    } catch {
      // 关闭缓存连接的数据通道失败时 继续清理其余资源
    }

    try {
      persisted.pointerMoveChannel?.close();
    } catch {
      // 关闭缓存连接的数据通道失败时 继续清理其余资源
    }

    try {
      persisted.peerConnection.ontrack = null;
      persisted.peerConnection.onicecandidate = null;
      persisted.peerConnection.onconnectionstatechange = null;
      persisted.peerConnection.oniceconnectionstatechange = null;
      persisted.peerConnection.ondatachannel = null;
      persisted.peerConnection.close();
    } catch {
      // 清理缓存的 WebRTC 连接失败时 继续清理其余资源
    }

    try {
      if (persisted.ws) {
        persisted.ws.onopen = null;
        persisted.ws.onmessage = null;
        persisted.ws.onerror = null;
        persisted.ws.onclose = null;
        persisted.ws.close();
      }
    } catch {
      // 关闭缓存的 WebSocket 连接失败时 仍需移除本地连接记录
    }

    for (const track of new Set([...persisted.remoteVideoStream.getTracks(), ...persisted.remoteAudioStream.getTracks()])) {
      track.onended = null;
      track.stop();
    }
  };

  const disposeOtherPersistedConnections = (keepTabKey: string) => {
    const persistedConnections = window.__aylinkPersistedCastConnections;
    if (!persistedConnections) {
      return;
    }

    for (const tabKey of Object.keys(persistedConnections)) {
      if (tabKey === keepTabKey) {
        continue;
      }

      disposePersistedConnection(tabKey);
    }
  };

  const disposeAllPersistedConnections = () => {
    const persistedConnections = window.__aylinkPersistedCastConnections;
    if (!persistedConnections) {
      return;
    }

    for (const tabKey of Object.keys(persistedConnections)) {
      disposePersistedConnection(tabKey);
    }
  };

  const persistCurrentConnection = (
    tabKey: string,
    connection: PersistedCastConnection | null,
  ) => {
    if (!connection || !tabKey) {
      return;
    }

    window.__aylinkPersistedCastConnections ??= {};
    window.__aylinkPersistedCastConnections[tabKey] = connection;
    enforceActiveSessionLimit();
  };

  return {
    releaseCastTab: (tabKey: string) => {
      void pageHeartbeat.releaseTab(tabKey).catch((error: unknown) => console.warn('Cast tab release failed:', error));
    },
    requestWebTicket: pageHeartbeat.requestTicket,
    releaseWebPage: pageHeartbeat.releasePage,
    getPersistentAudioElement,
    getPersistentAudioElements: () => [...audioElements.values()],
    setAudioMuted,
    setViewingTab,
    enforceActiveSessionLimit,
    releaseCastSession,
    refreshCastPage: pageHeartbeat.start,
    persistCurrentConnection,
    clearPersistedConnection,
    getPersistedConnection,
    disposePersistedConnection,
    disposeOtherPersistedConnections,
    disposeAllPersistedConnections
  };
}
