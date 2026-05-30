import { readSessionJson, removeSessionValue, writeSessionJson } from '../core/storage/browserStorage';
import { buildWorkspacePendingOpenKey } from '../core/storage/keys';

export type WorkspaceTarget = 'files' | 'apps' | 'screencast' | 'terminal';

export interface WorkspaceOpenRequest {
  deviceId: string;
  deviceName?: string;
  appPackageName?: string;
  appDisplayName?: string;
  newDisplay?: boolean;
}

const keyForTarget = (target: WorkspaceTarget) => buildWorkspacePendingOpenKey(target);

export function requestWorkspaceOpen(target: WorkspaceTarget, request: WorkspaceOpenRequest) {
  writeSessionJson(keyForTarget(target), {
    ...request,
    createdAt: Date.now(),
  });
}

export function consumeWorkspaceOpen(target: WorkspaceTarget): WorkspaceOpenRequest | null {
  const key = keyForTarget(target);
  const parsed = readSessionJson<WorkspaceOpenRequest>(key);
  removeSessionValue(key);

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
}
