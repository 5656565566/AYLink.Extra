export type WorkspaceTarget = 'files' | 'apps' | 'screencast' | 'terminal';

export interface WorkspaceOpenRequest {
  deviceId: string;
  deviceName?: string;
  appPackageName?: string;
  appDisplayName?: string;
  newDisplay?: boolean;
}

const keyForTarget = (target: WorkspaceTarget) => `aylink_pending_${target}_open`;

export function requestWorkspaceOpen(target: WorkspaceTarget, request: WorkspaceOpenRequest) {
  sessionStorage.setItem(keyForTarget(target), JSON.stringify({
    ...request,
    createdAt: Date.now(),
  }));
}

export function consumeWorkspaceOpen(target: WorkspaceTarget): WorkspaceOpenRequest | null {
  const key = keyForTarget(target);
  const raw = sessionStorage.getItem(key);
  sessionStorage.removeItem(key);

  if (!raw) {
    return null;
  }

  try {
    const parsed = JSON.parse(raw) as WorkspaceOpenRequest;
    if (!parsed || !parsed.deviceId) {
      return null;
    }

    return {
      deviceId: String(parsed.deviceId),
      deviceName: parsed.deviceName ? String(parsed.deviceName) : undefined,
      appPackageName: parsed.appPackageName ? String(parsed.appPackageName) : undefined,
      appDisplayName: parsed.appDisplayName ? String(parsed.appDisplayName) : undefined,
      newDisplay: parsed.newDisplay === true,
    };
  } catch {
    return null;
  }
}
