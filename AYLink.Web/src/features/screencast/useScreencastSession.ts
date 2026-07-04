import type { Ref } from 'vue';

export type ScreencastSessionValue<T> = T | Ref<T>;

export interface ScreencastSessionState {
  isConnected: Ref<boolean>;
  isConnecting: Ref<boolean>;
  status: Ref<string>;
  videoStream: ScreencastSessionValue<MediaStream>;
  audioStream: ScreencastSessionValue<MediaStream>;
}

export interface ScreencastSessionLifecycle {
  start: (bypassStartGuard?: boolean) => Promise<void>;
  stop: (preserveForBackground?: boolean, preserveTabKey?: string, options?: ScreencastSessionStopOptions) => void;
  restore: (tabKey?: string) => boolean;
}

export interface ScreencastSessionStopOptions {
  disposeOtherPersistedConnections?: boolean;
}

export interface ScreencastSessionControls {
  sendAndroidCommand: (command: string) => void;
}

export interface ScreencastSessionRefs {
  getStageElement: () => HTMLDivElement | null;
  getVideoElement: () => HTMLVideoElement | null;
  getAudioElement: () => HTMLAudioElement | null;
}

export interface ScreencastSession {
  state: ScreencastSessionState;
  lifecycle: ScreencastSessionLifecycle;
  controls: ScreencastSessionControls;
  refs: ScreencastSessionRefs;
}

export function useScreencastSession(options: ScreencastSession): ScreencastSession {
  return options;
}
