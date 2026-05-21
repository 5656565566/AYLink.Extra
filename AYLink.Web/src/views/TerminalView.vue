<template>
  <div class="page-container">
    <WorkspaceTabs
      :tabs="tabItems"
      :active-key="activeTabKey"
      @select="activateTab"
      @close="closeTab">
      <template #icon>
        <svg class="workspace-tab__icon" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M5.5 3.5C4 3.5 3.5 4.5 3.5 6V7C3.5 7.5 3 8 2.5 8C3 8 3.5 8.5 3.5 9V10C3.5 11.5 4 12.5 5.5 12.5M10.5 3.5C12 3.5 12.5 4.5 12.5 6V7C12.5 7.5 13 8 13.5 8C13 8 12.5 8.5 12.5 9V10C12.5 11.5 12 12.5 10.5 12.5" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"/></svg>
      </template>
    </WorkspaceTabs>

    <div class="content-area">
      <div v-if="!activeTab" class="empty-state">
        <svg class="empty-state__icon" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
          <path d="M9 5C9 5 7 5 7 8C7 10 5 11 5 12C5 13 7 14 7 16C7 19 9 19 9 19M15 5C15 5 17 5 17 8C17 10 19 11 19 12C19 13 17 14 17 16C17 19 15 19 15 19" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
        <div class="empty-state__title">{{ t('TerminalPage.NoDeviceSelected', '未选中设备') }}</div>
        <div class="empty-state__desc">{{ t('TerminalPage.OpenFromHome', '请在首页选择一个设备来启动终端') }}</div>
      </div>

      <div
        v-for="tab in tabs"
        :key="tab.key"
        v-show="tab.key === activeTabKey"
        class="terminal-panel"
      >
        <div class="terminal-host" :ref="(el) => setTerminalHost(tab.key, el as Element | null)"></div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { nextTick, onActivated, onMounted, onUnmounted, ref, watch, computed } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';
import WorkspaceTabs from '../components/WorkspaceTabs.vue';
import { consumeWorkspaceOpen, type WorkspaceOpenRequest } from '../services/workspaceNavigation';
import { useI18n } from '../composables/useI18n';
import { getAccessToken } from '../services/auth';
import { useTheme } from '../services/theme';

interface TerminalTab {
  key: string;
  deviceId: string;
  deviceName: string;
  serialHint: string;
  status: 'idle' | 'connecting' | 'connected' | 'disconnected' | 'error';
}

interface TerminalRuntime {
  term: Terminal;
  fitAddon: FitAddon;
  socket: WebSocket | null;
  pingTimer: number | null;
}

const STORAGE_KEY = 'aylink_terminal_tabs';
const ACTIVE_KEY = 'aylink_terminal_active_tab';

const route = useRoute();
const router = useRouter();
const { t } = useI18n();
const { resolvedTheme } = useTheme();
const tabs = ref<TerminalTab[]>([]);
const activeTabKey = ref('');

const terminalHosts = new Map<string, HTMLDivElement | null>();
const runtimes = new Map<string, TerminalRuntime>();

const isTerminalRouteActive = computed(() => route.name === 'terminal');
const activeTab = computed(() => tabs.value.find((tab) => tab.key === activeTabKey.value) ?? null);
const tabItems = computed(() => tabs.value.map((tab) => ({
  key: tab.key,
  title: tab.deviceName || t('TerminalPage.Title', '终端')
})));

const getTerminalTheme = (isDark: boolean) => ({
  background: 'transparent',
  foreground: isDark ? '#d4d4d4' : '#333333',
  cursor: isDark ? '#cccccc' : '#333333',
  selectionBackground: isDark ? 'rgba(255, 255, 255, 0.3)' : 'rgba(0, 0, 0, 0.2)'
});

const buildTabKey = (deviceId: string) => `${deviceId || 'empty'}::terminal`;

const persistTabs = () => {
  sessionStorage.setItem(STORAGE_KEY, JSON.stringify(tabs.value.map(({ key, deviceId, deviceName, serialHint }) => ({
    key,
    deviceId,
    deviceName,
    serialHint
  }))));
  sessionStorage.setItem(ACTIVE_KEY, activeTabKey.value);
};

const createTabFromRequest = (request: WorkspaceOpenRequest): TerminalTab => ({
  key: buildTabKey(request.deviceId),
  deviceId: request.deviceId,
  deviceName: request.deviceName || t('TerminalPage.Title', '终端'),
  serialHint: request.deviceName || request.deviceId,
  status: 'idle'
});

const createTabFromRoute = () => {
  if (!isTerminalRouteActive.value) return null;

  const deviceId = String(route.query.deviceId ?? '').trim();
  const deviceName = String(route.query.deviceName ?? '').trim();
  if (!deviceId) return null;

  return createTabFromRequest({
    deviceId,
    deviceName
  });
};

const syncRouteToActiveTab = async () => {
  if (Object.keys(route.query).length > 0) {
    await router.replace({ name: 'terminal', query: {} });
  }
};

const setTerminalStatus = (key: string, status: TerminalTab['status']) => {
  const tab = tabs.value.find((item) => item.key === key);
  if (tab) {
    tab.status = status;
  }
};

const setTerminalHost = (key: string, element: Element | null) => {
  terminalHosts.set(key, element instanceof HTMLDivElement ? element : null);
  if (element && key === activeTabKey.value) {
    void nextTick(() => ensureSessionForTab(key));
  }
};

const clearRuntime = (key: string) => {
  const runtime = runtimes.get(key);
  if (!runtime) return;

  if (runtime.pingTimer !== null) {
    window.clearInterval(runtime.pingTimer);
  }

  runtime.socket?.close();
  runtime.term.dispose();
  runtimes.delete(key);
};

const sendSocketMessage = (key: string, payload: Record<string, unknown>) => {
  const runtime = runtimes.get(key);
  if (!runtime?.socket || runtime.socket.readyState !== WebSocket.OPEN) {
    return;
  }

  runtime.socket.send(JSON.stringify(payload));
};

const fitTerminal = (key: string) => {
  const runtime = runtimes.get(key);
  if (!runtime) return;

  runtime.fitAddon.fit();
  sendSocketMessage(key, {
    type: 'resize',
    cols: runtime.term.cols,
    rows: runtime.term.rows
  });
};

const buildWebSocketUrl = (deviceId: string) => {
  const token = getAccessToken();
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const query = token ? `?token=${encodeURIComponent(token)}` : '';
  return `${protocol}//${window.location.host}/api/devices/${encodeURIComponent(deviceId)}/terminal/ws${query}`;
};

const ensureSessionForTab = (key: string) => {
  if (runtimes.has(key)) {
    fitTerminal(key);
    return;
  }

  const tab = tabs.value.find((item) => item.key === key);
  const host = terminalHosts.get(key);
  if (!tab || !host) {
    return;
  }

  const isDark = resolvedTheme.value === 'dark';
  const term = new Terminal({
    cursorBlink: true,
    fontFamily: 'Consolas, "Courier New", monospace',
    fontSize: 14,
    lineHeight: 1.2,
    scrollback: 5000,
    allowTransparency: true,
    theme: getTerminalTheme(isDark)
  });

  const fitAddon = new FitAddon();
  term.loadAddon(fitAddon);
  term.open(host);
  term.focus();

  const runtime: TerminalRuntime = {
    term,
    fitAddon,
    socket: null,
    pingTimer: null
  };
  runtimes.set(key, runtime);
  setTerminalStatus(key, 'connecting');

  term.onData((data) => {
    sendSocketMessage(key, { type: 'input', data });
  });

  term.onResize(({ cols, rows }) => {
    sendSocketMessage(key, { type: 'resize', cols, rows });
  });

  const socket = new WebSocket(buildWebSocketUrl(tab.deviceId));
  runtime.socket = socket;

  socket.onopen = () => {
    fitTerminal(key);
    runtime.pingTimer = window.setInterval(() => {
      sendSocketMessage(key, { type: 'ping' });
    }, 30000);
  };

  socket.onmessage = (event) => {
    try {
      const message = JSON.parse(String(event.data));
      if (message.type === 'ready') {
        setTerminalStatus(key, 'connected');
        return;
      }

      if (message.type === 'output' && typeof message.data === 'string') {
        term.write(message.data);
        return;
      }

      if (message.type === 'error' && typeof message.message === 'string') {
        setTerminalStatus(key, 'error');
        term.writeln(`\r\n\u001b[31m${message.message}\u001b[0m`);
      }
    } catch (error) {
      console.error('Failed to parse terminal message', error);
    }
  };

  socket.onerror = () => {
    setTerminalStatus(key, 'error');
  };

  socket.onclose = () => {
    if (runtime.pingTimer !== null) {
      window.clearInterval(runtime.pingTimer);
      runtime.pingTimer = null;
    }

    if (tabs.value.some((item) => item.key === key)) {
      const currentStatus = tabs.value.find((item) => item.key === key)?.status;
      if (currentStatus !== 'error') {
        setTerminalStatus(key, 'disconnected');
      }
    }
  };
};

const fitActiveTab = () => {
  if (!activeTabKey.value) return;
  fitTerminal(activeTabKey.value);
};

const upsertTab = (tab: TerminalTab) => {
  const index = tabs.value.findIndex((item) => item.key === tab.key);
  if (index >= 0) {
    tabs.value[index] = { ...tabs.value[index], ...tab };
  } else {
    tabs.value.push(tab);
  }
};

const openTab = async (tab: TerminalTab) => {
  upsertTab(tab);
  activeTabKey.value = tab.key;
  persistTabs();
  await syncRouteToActiveTab();
  await nextTick();
  ensureSessionForTab(tab.key);
};

const activateTab = async (tabKey: string) => {
  if (tabKey === activeTabKey.value) return;
  const tab = tabs.value.find((item) => item.key === tabKey);
  if (!tab) return;

  activeTabKey.value = tab.key;
  persistTabs();
  await syncRouteToActiveTab();
  await nextTick();
  ensureSessionForTab(tab.key);
  fitTerminal(tab.key);
};

const closeTab = async (tabKey: string) => {
  const closingIndex = tabs.value.findIndex((item) => item.key === tabKey);
  if (closingIndex < 0) return;

  const closingActive = activeTabKey.value === tabKey;
  clearRuntime(tabKey);
  terminalHosts.delete(tabKey);
  tabs.value.splice(closingIndex, 1);

  if (!closingActive) {
    persistTabs();
    return;
  }

  const nextTab = tabs.value[closingIndex] ?? tabs.value[closingIndex - 1] ?? null;
  activeTabKey.value = nextTab?.key ?? '';
  persistTabs();
  await syncRouteToActiveTab();
  await nextTick();

  if (nextTab) {
    ensureSessionForTab(nextTab.key);
    fitTerminal(nextTab.key);
  }
};

const loadPersistedTabs = () => {
  try {
    const rawTabs = sessionStorage.getItem(STORAGE_KEY);
    const rawActive = sessionStorage.getItem(ACTIVE_KEY) ?? '';
    const parsedTabs = rawTabs ? JSON.parse(rawTabs) : [];

    if (Array.isArray(parsedTabs)) {
      tabs.value = parsedTabs
        .filter((item): item is Omit<TerminalTab, 'status'> => !!item && typeof item.key === 'string' && typeof item.deviceId === 'string')
        .map((item) => ({
          key: item.key,
          deviceId: item.deviceId,
          deviceName: item.deviceName ?? t('TerminalPage.Title', '终端'),
          serialHint: item.serialHint ?? item.deviceId,
          status: 'idle'
        }));
    }

    activeTabKey.value = tabs.value.some((item) => item.key === rawActive) ? rawActive : tabs.value[0]?.key ?? '';
  } catch {
    tabs.value = [];
    activeTabKey.value = '';
  }
};

const consumeIncomingTab = async () => {
  const pendingTab = consumeWorkspaceOpen('terminal');
  if (pendingTab) {
    await openTab(createTabFromRequest(pendingTab));
    return true;
  }

  const routeTab = createTabFromRoute();
  if (routeTab) {
    await openTab(routeTab);
    return true;
  }

  await syncRouteToActiveTab();
  return false;
};

watch(
  () => route.query,
  async () => {
    await consumeIncomingTab();
  }
);

watch(activeTabKey, async (key) => {
  if (!key) return;
  await nextTick();
  ensureSessionForTab(key);
  fitTerminal(key);
});

watch(resolvedTheme, (newTheme) => {
  const isDark = newTheme === 'dark';
  const themeObj = getTerminalTheme(isDark);
  for (const runtime of runtimes.values()) {
    runtime.term.options.theme = themeObj;
  }
});

onMounted(async () => {
  loadPersistedTabs();
  if (!isTerminalRouteActive.value) return;

  const consumed = await consumeIncomingTab();
  if (!consumed && activeTabKey.value) {
    await nextTick();
    ensureSessionForTab(activeTabKey.value);
    fitTerminal(activeTabKey.value);
  }

  window.addEventListener('resize', fitActiveTab);
});

onActivated(async () => {
  if (!isTerminalRouteActive.value) return;

  const consumed = await consumeIncomingTab();
  if (!consumed && activeTabKey.value) {
    await nextTick();
    ensureSessionForTab(activeTabKey.value);
    fitTerminal(activeTabKey.value);
  }
});

onUnmounted(() => {
  window.removeEventListener('resize', fitActiveTab);
  for (const key of [...runtimes.keys()]) {
    clearRuntime(key);
  }
});
</script>

<style scoped>
.page-container {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
  background-color: transparent;
}

.content-area {
  flex: 1;
  min-height: 0;
  position: relative;
  background-color: transparent;
}

.empty-state {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  z-index: 10;
  background: transparent;
}

.empty-state__icon {
  width: 64px;
  height: 64px;
  margin-bottom: 16px;
  color: var(--fluent-text-tertiary);
}

.empty-state__title {
  font-size: 18px;
  font-weight: 600;
  color: var(--fluent-text-primary);
  margin-bottom: 8px;
}

.empty-state__desc {
  font-size: 13px;
  color: var(--fluent-text-secondary);
}

.terminal-panel {
  width: 100%;
  height: 100%;
}

.terminal-host {
  width: 100%;
  height: 100%;
  padding: 8px 12px;
}

:deep(.xterm) {
  height: 100%;
}

:deep(.xterm-viewport) {
  background-color: transparent !important;
}

:deep(.xterm-scrollable-element) {
  background-color: transparent !important;
}

:deep(.xterm-viewport::-webkit-scrollbar) {
  width: 10px;
}

:deep(.xterm-viewport::-webkit-scrollbar-thumb) {
  background-color: rgba(255, 255, 255, 0.2);
  border-radius: 5px;
}

:deep(.xterm-viewport::-webkit-scrollbar-track) {
  background: transparent;
}
</style>
