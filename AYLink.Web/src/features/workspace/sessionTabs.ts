import { readSessionJson, readSessionString, writeSessionJson, writeSessionString } from '../../core/storage/browserStorage';
import type { SessionTabItem } from '../../types/workspace';

export function persistSessionTabs<T extends SessionTabItem>(tabsKey: string, activeKey: string, tabs: T[], activeTabKey: string) {
  writeSessionJson(tabsKey, tabs);
  writeSessionString(activeKey, activeTabKey);
}

export function restoreSessionTabs<T extends SessionTabItem>(
  tabsKey: string,
  activeKey: string,
  isTab: (value: unknown) => value is T,
) {
  const parsedTabs = readSessionJson<unknown[]>(tabsKey);
  const rawActiveKey = readSessionString(activeKey) || '';

  const tabs = Array.isArray(parsedTabs) ? parsedTabs.filter(isTab) : [];
  const resolvedActiveKey = tabs.some((tab) => tab.key === rawActiveKey) ? rawActiveKey : tabs[0]?.key ?? '';

  return {
    tabs,
    activeTabKey: resolvedActiveKey,
  };
}
