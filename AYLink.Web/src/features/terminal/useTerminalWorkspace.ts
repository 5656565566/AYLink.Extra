import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { computed, nextTick, onActivated, onMounted, onUnmounted, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useI18n } from '../../composables/useI18n';
import { persistSessionTabs, restoreSessionTabs } from '../workspace/sessionTabs';
import { getAccessToken } from '../../services/auth';
import { useTheme } from '../../services/theme';
import { consumeWorkspaceOpen, type WorkspaceOpenRequest } from '../../services/workspaceNavigation';
import type { PersistedTerminalTab, TerminalTab } from '../../types/terminal';

interface TerminalRuntime {
  term: Terminal;
  fitAddon: FitAddon;
  socket: WebSocket | null;
  pingTimer: number | null;
}

const STORAGE_KEY = 'aylink_terminal_tabs';
const ACTIVE_KEY = 'aylink_terminal_active_tab';

function isPersistedTerminalTab(item: unknown): item is PersistedTerminalTab {
  return !!item
    && typeof item === 'object'
    && typeof (item as PersistedTerminalTab).key === 'string'
    && typeof (item as PersistedTerminalTab).deviceId === 'string';
}

export function useTerminalWorkspace() {
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
    persistSessionTabs(
      STORAGE_KEY,
      ACTIVE_KEY,
      tabs.value.map(({ key, deviceId, deviceName, serialHint }) => ({
        key,
        deviceId,
        deviceName,
        serialHint
      })),
      activeTabKey.value
    );
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

  const setTerminalHost = (key: string, element: Element | { $el?: Element | null } | null) => {
    const resolvedElement = element instanceof Element ? element : element?.$el ?? null;

    terminalHosts.set(key, resolvedElement instanceof HTMLDivElement ? resolvedElement : null);
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
      const restored = restoreSessionTabs(STORAGE_KEY, ACTIVE_KEY, isPersistedTerminalTab);
      tabs.value = restored.tabs.map((item) => ({
        key: item.key,
        deviceId: item.deviceId,
        deviceName: item.deviceName ?? t('TerminalPage.Title', '终端'),
        serialHint: item.serialHint ?? item.deviceId,
        status: 'idle'
      }));
      activeTabKey.value = restored.activeTabKey;
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
    const themeObject = getTerminalTheme(isDark);

    for (const runtime of runtimes.values()) {
      runtime.term.options.theme = themeObject;
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

  return {
    STORAGE_KEY,
    ACTIVE_KEY,
    route,
    router,
    t,
    resolvedTheme,
    tabs,
    activeTabKey,
    terminalHosts,
    runtimes,
    isTerminalRouteActive,
    activeTab,
    tabItems,
    getTerminalTheme,
    buildTabKey,
    persistTabs,
    createTabFromRequest,
    createTabFromRoute,
    syncRouteToActiveTab,
    setTerminalStatus,
    setTerminalHost,
    clearRuntime,
    sendSocketMessage,
    fitTerminal,
    buildWebSocketUrl,
    ensureSessionForTab,
    fitActiveTab,
    upsertTab,
    openTab,
    activateTab,
    closeTab,
    loadPersistedTabs,
    consumeIncomingTab
  };
}
