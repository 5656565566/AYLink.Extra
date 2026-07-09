import { defineComponent } from 'vue';
import { computed, onMounted, onUnmounted, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import SettingSection from '../components/SettingSection.vue';
import SettingItem from '../components/SettingItem.vue';
import { useI18n } from '../composables/useI18n';
import { backgroundEnabled, backgroundImages, addBackgroundImages, removeBackgroundImage, setBackgroundEnabled } from '../services/background';
import { useAppSettings } from '../services/appSettings';
import { useDialog } from '../services/dialog';
import { useTheme, type ThemeMode } from '../services/theme';
import { hasPermission, logout, logoutAll, useAuth } from '../services/auth';
import { useNotification } from '../services/notification';
import {
  clearLocalWebRtcOverrideConfig,
  loadLocalWebRtcOverrideConfig,
  loadLocalWebRtcOverrideEnabled,
  saveLocalWebRtcOverrideConfig,
  setLocalWebRtcOverrideEnabled,
  type WebRtcIceServerPayload,
  type WebRtcNetworkSettingsPayload
} from '../services/webrtcSettings';
import { apiFetch, readApiErrorMessage, resolveApiErrorMessage } from '../utils/api';
import { storageKeys } from '../core/storage/keys';

export default defineComponent({
  name: 'SettingsView',
  components: {
    SettingSection,
    SettingItem
  },
  setup() {
    interface DeviceGroupSummary {
      Id: number;
      Name: string;
      Description?: string;
      DeviceCount?: number;
      IsInternal?: boolean;
    }

    interface DeviceGroupItem extends DeviceGroupSummary {
      RoleCount?: number;
      UserCount?: number;
      CreatedAt?: string;
      UpdatedAt?: string;
    }

    interface SettingsDeviceItem {
      Id: number;
      Name?: string | null;
      Serial?: string | null;
      Status?: string | null;
      Groups?: DeviceGroupSummary[] | null;
    }

    interface SettingsRoleSummary {
      Id: number;
      Name: string;
      Description: string;
    }

    interface SettingsRoleItem {
      Id: number;
      Name: string;
      Description: string;
      IsInternal: boolean;
      Permissions: string[];
      DeviceGroups?: DeviceGroupSummary[] | null;
    }

    interface SettingsUserItem {
      Id: number;
      Username: string;
      IsActive: boolean;
      Roles: SettingsRoleSummary[];
      DirectDeviceGroups?: DeviceGroupSummary[] | null;
      EffectiveDeviceGroups?: DeviceGroupSummary[] | null;
      EffectiveDeviceCount?: number;
      EffectiveDeviceGroupCount?: number;
    }

    const { themeMode, accentColor, setThemeMode, setAccentColor, resetTheme } = useTheme();

    const { t, currentLocale, languages, setLocale } = useI18n();

    const {
      adaptivePointerSampling,
      backgroundMute,
      newDisplayDpiMode,
      newDisplayDpiValue,
      pointerSamplingRateHz,
      previewRefreshInterval,
      weakNetworkMode,
      debugMode,
      setAdaptivePointerSampling,
      setBackgroundMute,
      setNewDisplayDpiMode,
      setNewDisplayDpiValue,
      setPointerSamplingRateHz,
      setPreviewRefreshInterval,
      setWeakNetworkMode,
      setDebugMode
    } = useAppSettings();

    const router = useRouter();

    const auth = useAuth();
    const dialogService = useDialog();

    const currentUser = auth.currentUser;

    const notifications = useNotification();

    const inputMappingMouseCaptureKey = ref(localStorage.getItem(storageKeys.inputMapping.mouseCaptureKey) || 'Alt');
    const inputMappingMouseSensitivity = ref(localStorage.getItem(storageKeys.inputMapping.mouseSensitivity) || '1');
    const inputMappingToggleHintsKey = ref(localStorage.getItem(storageKeys.inputMapping.toggleHintsKey) || '~');
    const inputMappingPauseToggleKey = ref(localStorage.getItem(storageKeys.inputMapping.pauseToggleKey) || '-');
    const capturingInputMappingKey = ref<'' | 'mouseCapture' | 'toggleHints' | 'pauseToggle'>('');

    const canManageAccounts = computed(() => hasPermission('accounts.manage'));
    const canManageDevices = computed(() => hasPermission('devices.manage'));

    const canViewRemoteSettings = computed(() => hasPermission('settings.view'));

    const canManageRemoteSettings = computed(() => hasPermission('settings.manage'));

    const canChangeOwnPassword = computed(() => hasPermission('accounts.change-password'));

    const appVersionDescription = ref('1.0.0');

    const currentAppVersion = ref('1.0.0');

    const currentReleaseTag = ref('v1.0.0');

    const latestReleaseUrl = ref('https://github.com/5656565566/AYLink.Extra/releases/latest');

    const isCheckingUpdates = ref(false);

    function getLocalWebRtcScope() {
      return String(currentUser.value?.Id ?? 'anonymous');
    }

    interface WebRtcServerForm {
      id: string;
      type: 'stun' | 'turn';
      urlsText: string;
      username: string;
      credential: string;
    }

    let nextWebRtcServerFormId = 0;

    function createWebRtcServerFormId() {
      nextWebRtcServerFormId += 1;
      return `webrtc-server-${nextWebRtcServerFormId}`;
    }

    function createDefaultWebRtcServerForm(type: 'stun' | 'turn'): WebRtcServerForm {
      return {
        id: createWebRtcServerFormId(),
        type,
        urlsText: '',
        username: '',
        credential: ''
      };
    }

    const webrtcTransportPolicy = ref<'all' | 'relay'>('all');

    const webrtcFallbackLocale = ref('zh-CN');

    const webrtcServers = ref<WebRtcServerForm[]>([createDefaultWebRtcServerForm('stun')]);

    const webrtcHostCandidateOverrideEnabled = ref(false);

    const webrtcHostCandidateOverrideIPsText = ref('');

    const webrtcHostCandidatePortMin = ref('');

    const webrtcHostCandidatePortMax = ref('');

    const webrtcSinglePortMuxEnabled = ref(false);

    const webrtcSinglePortMuxBindPort = ref('');

    const webrtcSinglePortMuxPublishPort = ref('');

    const isWebRtcServersListExpanded = ref(false);

    const webrtcSaving = ref(false);

    const webrtcStatusMessage = ref('');

    const useLocalWebRtcOverride = ref(loadLocalWebRtcOverrideEnabled());

    const localWebrtcTransportPolicy = ref<'all' | 'relay'>('all');

    const localWebrtcServers = ref<WebRtcServerForm[]>([createDefaultWebRtcServerForm('stun')]);

    const isLocalWebRtcServersListExpanded = ref(false);

    const showChangePasswordDialog = ref(false);

    const showBackgroundDialog = ref(false);
    const showGroupDialog = ref(false);

    const changingPassword = ref(false);
    const loggingOutAll = ref(false);
    const groupManagementLoading = ref(false);
    const groupManagementSaving = ref(false);
    const groupManagementError = ref('');
    const deviceGroupItems = ref<DeviceGroupItem[]>([]);
    const groupManagementDevices = ref<SettingsDeviceItem[]>([]);
    const groupManagementUsers = ref<SettingsUserItem[]>([]);
    const groupManagementRoles = ref<SettingsRoleItem[]>([]);
    const isGroupManagementListExpanded = ref(false);
    const groupSearchKeyword = ref('');
    const deviceSearchKeyword = ref('');
    const roleSearchKeyword = ref('');
    const userSearchKeyword = ref('');
    const groupDialogMode = ref<'create' | 'edit'>('create');
    const editingGroupId = ref<number | null>(null);
    const groupForm = ref({
      name: '',
      description: '',
      deviceIds: [] as number[],
      roleIds: [] as number[],
      userIds: [] as number[],
    });

    const changePasswordError = ref('');

    const changePasswordForm = ref({
      currentPassword: '',
      newPassword: '',
      confirmPassword: ''
    });

    const canManageGroupSection = computed(() => canManageAccounts.value || canManageDevices.value);

    const filteredDeviceGroups = computed(() => {
      const keyword = groupSearchKeyword.value.trim().toLowerCase();
      if (!keyword) {
        return deviceGroupItems.value;
      }
      return deviceGroupItems.value.filter((group) => {
        const haystack = `${group.Name} ${group.Description || ''}`.toLowerCase();
        return haystack.includes(keyword);
      });
    });

    const filteredGroupDevices = computed(() => {
      const keyword = deviceSearchKeyword.value.trim().toLowerCase();
      if (!keyword) {
        return groupManagementDevices.value;
      }
      return groupManagementDevices.value.filter((device) => {
        const haystack = `${device.Name || ''} ${device.Serial || ''}`.toLowerCase();
        return haystack.includes(keyword);
      });
    });

    const filteredGroupRoles = computed(() => {
      const keyword = roleSearchKeyword.value.trim().toLowerCase();
      if (!keyword) {
        return groupManagementRoles.value;
      }
      return groupManagementRoles.value.filter((role) => {
        const haystack = `${role.Name} ${role.Description || ''}`.toLowerCase();
        return haystack.includes(keyword);
      });
    });

    const filteredGroupUsers = computed(() => {
      const keyword = userSearchKeyword.value.trim().toLowerCase();
      if (!keyword) {
        return groupManagementUsers.value;
      }
      return groupManagementUsers.value.filter((user) => {
        const haystack = `${user.Username}`.toLowerCase();
        return haystack.includes(keyword);
      });
    });

    const editingGroup = computed(() => {
      if (groupDialogMode.value !== 'edit' || editingGroupId.value == null) {
        return null;
      }
      return deviceGroupItems.value.find((group) => group.Id === editingGroupId.value) || null;
    });

    const isEditingInternalGroup = computed(() => editingGroup.value?.IsInternal === true);

    let isSettingInternally = false;

    let isLocalSettingInternally = false;

    let skipSaveTimer: number | null = null;

    let saveTimeout: number | null = null;

    let localSkipSaveTimer: number | null = null;

    let localSaveTimeout: number | null = null;

    watch(
      [webrtcTransportPolicy, webrtcFallbackLocale, webrtcServers, webrtcHostCandidateOverrideEnabled, webrtcHostCandidateOverrideIPsText, webrtcHostCandidatePortMin, webrtcHostCandidatePortMax, webrtcSinglePortMuxEnabled, webrtcSinglePortMuxBindPort, webrtcSinglePortMuxPublishPort],
      () => {
        if (isSettingInternally || !canManageRemoteSettings.value) return;

        webrtcSaving.value = true;
        webrtcStatusMessage.value = t('Settings.Saving', '保存中...');

        if (saveTimeout) window.clearTimeout(saveTimeout);
        saveTimeout = window.setTimeout(() => {
          void saveWebRtcSettings();
        }, 1000);
      },
      { deep: true }
    );

    watch(
      [useLocalWebRtcOverride, localWebrtcTransportPolicy, localWebrtcServers],
      () => {
        if (isLocalSettingInternally) return;

        if (localSaveTimeout) window.clearTimeout(localSaveTimeout);
        localSaveTimeout = window.setTimeout(() => {
          saveLocalWebRtcSettings();
        }, 300);
      },
      { deep: true }
    );

    watch(webrtcSinglePortMuxEnabled, (enabled) => {
      if (enabled) {
        webrtcHostCandidateOverrideEnabled.value = true;
      }
    });

    watch(webrtcHostCandidateOverrideEnabled, (enabled) => {
      if (!enabled) {
        webrtcSinglePortMuxEnabled.value = false;
      }
    });

    function onThemeModeChange(event: Event) {
      const value = (event.target as HTMLSelectElement).value as ThemeMode;
      setThemeMode(value);
    }

    function onAccentColorInput(event: Event) {
      setAccentColor((event.target as HTMLInputElement).value);
    }

    function onLocaleChange(event: Event) {
      void setLocale((event.target as HTMLSelectElement).value);
    }

    function onBackgroundMuteChange(event: Event) {
      setBackgroundMute((event.target as HTMLInputElement).checked);
    }

    function onAdaptivePointerSamplingChange(event: Event) {
      setAdaptivePointerSampling((event.target as HTMLInputElement).checked);
    }

    function onBackgroundEnabledChange(event: Event) {
      setBackgroundEnabled((event.target as HTMLInputElement).checked);
    }

    function onUseLocalWebRtcOverrideChange(event: Event) {
      useLocalWebRtcOverride.value = (event.target as HTMLInputElement).checked;
    }

    function onNewDisplayDpiModeChange(event: Event) {
      const rawValue = (event.target as HTMLSelectElement).value;
      const value = rawValue === 'custom' ? 'custom' : rawValue === 'auto' ? 'auto' : 'disabled';
      setNewDisplayDpiMode(value);
    }

    function onNewDisplayDpiValueChange(event: Event) {
      setNewDisplayDpiValue(Number((event.target as HTMLInputElement).value));
    }

    function onPreviewRefreshIntervalChange(event: Event) {
      setPreviewRefreshInterval(Number((event.target as HTMLInputElement).value));
    }

    function onPointerSamplingRateChange(event: Event) {
      setPointerSamplingRateHz(Number((event.target as HTMLSelectElement).value));
    }

    function onWeakNetworkModeChange(event: Event) {
      setWeakNetworkMode((event.target as HTMLInputElement).checked);
    }

    function onDebugModeChange(event: Event) {
      setDebugMode((event.target as HTMLInputElement).checked);
    }

    function formatCapturedInputMappingKey(event: KeyboardEvent) {
      if (event.code === 'AltLeft' || event.code === 'AltRight') return 'Alt';
      if (event.code === 'ControlLeft' || event.code === 'ControlRight') return 'Ctrl';
      if (event.code === 'ShiftLeft' || event.code === 'ShiftRight') return 'Shift';
      if (event.code === 'MetaLeft' || event.code === 'MetaRight') return 'Meta';
      if (event.code === 'Backquote') return event.shiftKey ? '~' : '`';
      if (event.code === 'Minus') return '-';
      if (event.code.startsWith('Key') || event.code.startsWith('Digit') || event.code.startsWith('Numpad')) {
        return event.code;
      }
      return event.key && event.key !== 'Unidentified' ? event.key : event.code;
    }

    function saveInputMappingKeySetting(kind: typeof capturingInputMappingKey.value, value: string) {
      if (kind === 'mouseCapture') {
        inputMappingMouseCaptureKey.value = value || 'Alt';
        localStorage.setItem(storageKeys.inputMapping.mouseCaptureKey, inputMappingMouseCaptureKey.value);
      } else if (kind === 'toggleHints') {
        inputMappingToggleHintsKey.value = value || '~';
        localStorage.setItem(storageKeys.inputMapping.toggleHintsKey, inputMappingToggleHintsKey.value);
      } else if (kind === 'pauseToggle') {
        inputMappingPauseToggleKey.value = value || '-';
        localStorage.setItem(storageKeys.inputMapping.pauseToggleKey, inputMappingPauseToggleKey.value);
      }
    }

    function startInputMappingKeyCapture(kind: typeof capturingInputMappingKey.value) {
      capturingInputMappingKey.value = kind;
    }

    function handleInputMappingKeyCapture(event: KeyboardEvent) {
      if (!capturingInputMappingKey.value) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();
      if (event.code === 'Escape') {
        capturingInputMappingKey.value = '';
        return;
      }

      const captured = formatCapturedInputMappingKey(event).trim();
      saveInputMappingKeySetting(capturingInputMappingKey.value, captured);
      capturingInputMappingKey.value = '';
    }

    function onInputMappingMouseSensitivityChange(event: Event) {
      const rawValue = ((event.target as HTMLInputElement).value || '1').trim();
      const numeric = Number(rawValue);
      const normalized = Number.isFinite(numeric) ? String(Math.min(5, Math.max(0.1, numeric))) : '1';
      inputMappingMouseSensitivity.value = normalized;
      localStorage.setItem(storageKeys.inputMapping.mouseSensitivity, normalized);
    }

    function normalizeVersion(value: string) {
      return value.trim().replace(/^[vV]/, '');
    }

    // 将 tag 版本拆成数字段 避免 1.10.0 被误判成小于 1.2.0
    function compareVersions(left: string, right: string) {
      const leftCore = normalizeVersion(left).split('-', 1)[0];
      const rightCore = normalizeVersion(right).split('-', 1)[0];
      const leftParts = leftCore.split('.').map((part) => Number.parseInt(part, 10) || 0);
      const rightParts = rightCore.split('.').map((part) => Number.parseInt(part, 10) || 0);
      const length = Math.max(leftParts.length, rightParts.length);

      for (let index = 0; index < length; index += 1) {
        const leftValue = leftParts[index] ?? 0;
        const rightValue = rightParts[index] ?? 0;
        if (leftValue === rightValue) {
          continue;
        }

        return leftValue > rightValue ? 1 : -1;
      }

      return 0;
    }

    function openExternalUrl(url: string) {
      window.open(url, '_blank', 'noopener,noreferrer');
    }

    function openGitHubRepository() {
      openExternalUrl('https://github.com/5656565566/AYLink.Extra');
    }

    async function handleUploadBackground(event: Event) {
      const input = event.target as HTMLInputElement;
      if (!input.files || input.files.length === 0) return;
      await addBackgroundImages(Array.from(input.files));
      input.value = '';
    }

    function onWebRtcHostCandidateOverrideEnabledChange(event: Event) {
      webrtcHostCandidateOverrideEnabled.value = (event.target as HTMLInputElement).checked;
    }

    function onWebRtcSinglePortMuxEnabledChange(event: Event) {
      webrtcSinglePortMuxEnabled.value = (event.target as HTMLInputElement).checked;
    }

    function createWebRtcServerForm(server?: WebRtcIceServerPayload): WebRtcServerForm {
      const urls = server?.Urls ?? [];
      const urlsText = urls.join('\n');
      const hasCredential = !!(server?.Username || server?.Credential);
      const isTurn = urls.some((u) => u.toLowerCase().startsWith('turn:')) || hasCredential;

      return {
        id: createWebRtcServerFormId(),
        type: isTurn ? 'turn' : 'stun',
        urlsText,
        username: server?.Username ?? '',
        credential: server?.Credential ?? ''
      };
    }

    function isWebRtcServerDraft(server: WebRtcServerForm) {
      return server.urlsText.trim() === '';
    }

    function mergeServerDrafts(savedServers: WebRtcServerForm[], currentServers: WebRtcServerForm[]) {
      const drafts = currentServers.filter(isWebRtcServerDraft);
      return drafts.length > 0 ? [...savedServers, ...drafts] : savedServers;
    }

    function normalizeOptionalPort(value: number | string | null | undefined): number | null {
      if (value == null || value === '') {
        return null;
      }

      const numeric = typeof value === 'number' ? value : Number(value);
      if (!Number.isInteger(numeric) || numeric < 1 || numeric > 65535) {
        return null;
      }

      return numeric;
    }

    function normalizeWebRtcPayload(payload?: WebRtcNetworkSettingsPayload | null): WebRtcNetworkSettingsPayload {
      const normalizedPolicy = payload?.IceTransportPolicy === 'relay' ? 'relay' : 'all';
      const normalizedFallbackLocale = normalizeLocale(payload?.FallbackLocale);
      const seenServers = new Set<string>();
      const normalizedServers = (payload?.IceServers ?? [])
        .map((server) => {
          const urls = (server.Urls ?? [])
            .map((url) => url.trim())
            .filter(Boolean)
            .filter((url, index, list) => list.findIndex((item) => item.toLowerCase() === url.toLowerCase()) === index);

          if (urls.length === 0) {
            return null;
          }

          const normalizedServer = {
            Urls: urls,
            Username: server.Username?.trim() || null,
            Credential: server.Credential || null
          };

          const serverKey = `${[...urls].sort((a, b) => a.localeCompare(b)).join('\n')}||${normalizedServer.Username || ''}||${normalizedServer.Credential || ''}`;
          if (seenServers.has(serverKey)) {
            return null;
          }

          seenServers.add(serverKey);
          return normalizedServer;
        })
        .filter((server): server is NonNullable<typeof server> => server != null);

      const normalizedHostCandidateIPs = (payload?.HostCandidateOverrideIPs ?? [])
        .map((ip) => ip.trim())
        .filter(Boolean)
        .filter((ip, index, list) => list.findIndex((item) => item.toLowerCase() === ip.toLowerCase()) === index);

      const normalizedPortMin = normalizeOptionalPort(payload?.HostCandidatePortMin);
      const normalizedPortMax = normalizeOptionalPort(payload?.HostCandidatePortMax);
      const hasValidPortRange = normalizedPortMin != null && normalizedPortMax != null && normalizedPortMin <= normalizedPortMax;
      const normalizedSinglePortMuxBindPort = normalizeOptionalPort(payload?.SinglePortMuxBindPort);
      const normalizedSinglePortMuxPublishPort = normalizeOptionalPort(payload?.SinglePortMuxPublishPort);
      const singlePortMuxEnabled = payload?.SinglePortMuxEnabled === true;

      return {
        IceTransportPolicy: normalizedPolicy,
        FallbackLocale: normalizedFallbackLocale,
        IceServers: normalizedServers,
        HostCandidateOverrideEnabled: payload?.HostCandidateOverrideEnabled === true,
        HostCandidateOverrideIPs: normalizedHostCandidateIPs,
        HostCandidatePortMin: singlePortMuxEnabled ? null : (hasValidPortRange ? normalizedPortMin : null),
        HostCandidatePortMax: singlePortMuxEnabled ? null : (hasValidPortRange ? normalizedPortMax : null),
        SinglePortMuxEnabled: singlePortMuxEnabled,
        SinglePortMuxBindPort: singlePortMuxEnabled ? normalizedSinglePortMuxBindPort : null,
        SinglePortMuxPublishPort: singlePortMuxEnabled ? (normalizedSinglePortMuxPublishPort ?? normalizedSinglePortMuxBindPort) : null
      };
    }

    function normalizeLocale(locale?: string | null) {
      const normalized = locale?.trim() ?? '';
      return /^[a-z]{2}-[A-Z]{2}$/.test(normalized) ? normalized : 'zh-CN';
    }

    function applyWebRtcSettings(payload?: WebRtcNetworkSettingsPayload | null) {
      const normalizedPayload = normalizeWebRtcPayload(payload);
      isSettingInternally = true;
      webrtcTransportPolicy.value = normalizedPayload.IceTransportPolicy === 'relay' ? 'relay' : 'all';
      webrtcFallbackLocale.value = normalizedPayload.FallbackLocale || 'zh-CN';
      const servers = normalizedPayload.IceServers?.map((server) => createWebRtcServerForm(server)) ?? [];
      webrtcServers.value = mergeServerDrafts(servers, webrtcServers.value);
      webrtcHostCandidateOverrideEnabled.value = normalizedPayload.HostCandidateOverrideEnabled === true;
      webrtcHostCandidateOverrideIPsText.value = (normalizedPayload.HostCandidateOverrideIPs ?? []).join('\n');
      webrtcHostCandidatePortMin.value = normalizedPayload.HostCandidatePortMin != null ? String(normalizedPayload.HostCandidatePortMin) : '';
      webrtcHostCandidatePortMax.value = normalizedPayload.HostCandidatePortMax != null ? String(normalizedPayload.HostCandidatePortMax) : '';
      webrtcSinglePortMuxEnabled.value = normalizedPayload.SinglePortMuxEnabled === true;
      webrtcSinglePortMuxBindPort.value = normalizedPayload.SinglePortMuxBindPort != null ? String(normalizedPayload.SinglePortMuxBindPort) : '';
      webrtcSinglePortMuxPublishPort.value = normalizedPayload.SinglePortMuxPublishPort != null ? String(normalizedPayload.SinglePortMuxPublishPort) : '';

      if (skipSaveTimer) window.clearTimeout(skipSaveTimer);
      skipSaveTimer = window.setTimeout(() => {
        isSettingInternally = false;
      }, 100);
    }

    function applyLocalWebRtcSettings(payload?: WebRtcNetworkSettingsPayload | null) {
      const normalizedPayload = normalizeWebRtcPayload({
        ...payload,
        HostCandidateOverrideEnabled: false,
        HostCandidateOverrideIPs: [],
        HostCandidatePortMin: null,
        HostCandidatePortMax: null,
        SinglePortMuxEnabled: false,
        SinglePortMuxBindPort: null,
        SinglePortMuxPublishPort: null
      });
      isLocalSettingInternally = true;
      localWebrtcTransportPolicy.value = normalizedPayload.IceTransportPolicy === 'relay' ? 'relay' : 'all';
      const servers = normalizedPayload.IceServers?.map((server) => createWebRtcServerForm(server)) ?? [];
      localWebrtcServers.value = mergeServerDrafts(servers, localWebrtcServers.value);

      if (localSkipSaveTimer) window.clearTimeout(localSkipSaveTimer);
      localSkipSaveTimer = window.setTimeout(() => {
        isLocalSettingInternally = false;
      }, 100);
    }

    function buildWebRtcSettingsPayload(): WebRtcNetworkSettingsPayload {
      return normalizeWebRtcPayload({
        IceTransportPolicy: webrtcTransportPolicy.value,
        FallbackLocale: webrtcFallbackLocale.value,
        IceServers: webrtcServers.value
          .map((server) => ({
            Urls: server.urlsText
              .split(/\r?\n/)
              .map((url) => url.trim())
              .filter(Boolean),
            Username: server.username.trim() || null,
            Credential: server.credential || null
          }))
          .filter((server) => (server.Urls?.length ?? 0) > 0),
        HostCandidateOverrideEnabled: webrtcHostCandidateOverrideEnabled.value,
        HostCandidateOverrideIPs: webrtcHostCandidateOverrideIPsText.value
          .split(/\r?\n/)
          .map((ip) => ip.trim())
          .filter(Boolean),
        HostCandidatePortMin: normalizeOptionalPort(webrtcHostCandidatePortMin.value),
        HostCandidatePortMax: normalizeOptionalPort(webrtcHostCandidatePortMax.value),
        SinglePortMuxEnabled: webrtcSinglePortMuxEnabled.value,
        SinglePortMuxBindPort: normalizeOptionalPort(webrtcSinglePortMuxBindPort.value),
        SinglePortMuxPublishPort: normalizeOptionalPort(webrtcSinglePortMuxPublishPort.value)
      });
    }

    function buildLocalWebRtcSettingsPayload(): WebRtcNetworkSettingsPayload {
      const payload = normalizeWebRtcPayload({
        IceTransportPolicy: localWebrtcTransportPolicy.value,
        IceServers: localWebrtcServers.value
          .map((server) => ({
            Urls: server.urlsText
              .split(/\r?\n/)
              .map((url) => url.trim())
              .filter(Boolean),
            Username: server.username.trim() || null,
            Credential: server.credential || null
          }))
          .filter((server) => (server.Urls?.length ?? 0) > 0)
      });
      const { FallbackLocale: _fallbackLocale, ...localPayload } = payload;
      return localPayload;
    }

    function addWebRtcServer(type: 'stun' | 'turn') {
      webrtcServers.value.push(createDefaultWebRtcServerForm(type));
      isWebRtcServersListExpanded.value = true;
    }

    function addLocalWebRtcServer(type: 'stun' | 'turn') {
      localWebrtcServers.value.push(createDefaultWebRtcServerForm(type));
      isLocalWebRtcServersListExpanded.value = true;
    }

    function removeWebRtcServer(index: number) {
      webrtcServers.value.splice(index, 1);
    }

    function removeLocalWebRtcServer(index: number) {
      localWebrtcServers.value.splice(index, 1);
    }

    function resetWebRtcSettings() {
      applyWebRtcSettings({
        IceTransportPolicy: 'all',
        FallbackLocale: webrtcFallbackLocale.value || 'zh-CN',
        IceServers: [{ Urls: ['stun:stun.l.google.com:19302'] }],
        HostCandidateOverrideEnabled: false,
        HostCandidateOverrideIPs: [],
        HostCandidatePortMin: null,
        HostCandidatePortMax: null,
        SinglePortMuxEnabled: false,
        SinglePortMuxBindPort: null,
        SinglePortMuxPublishPort: null
      });
      void saveWebRtcSettings();
    }

    function resetLocalWebRtcSettings() {
      applyLocalWebRtcSettings({
        IceTransportPolicy: 'all',
        IceServers: [{ Urls: ['stun:stun.l.google.com:19302'] }],
        HostCandidateOverrideEnabled: false,
        HostCandidateOverrideIPs: [],
        HostCandidatePortMin: null,
        HostCandidatePortMax: null,
        SinglePortMuxEnabled: false,
        SinglePortMuxBindPort: null,
        SinglePortMuxPublishPort: null
      });
      saveLocalWebRtcSettings();
    }

    function saveLocalWebRtcSettings() {
      setLocalWebRtcOverrideEnabled(useLocalWebRtcOverride.value, getLocalWebRtcScope());
      if (!useLocalWebRtcOverride.value) {
        clearLocalWebRtcOverrideConfig(getLocalWebRtcScope());
        return;
      }

      saveLocalWebRtcOverrideConfig(buildLocalWebRtcSettingsPayload(), getLocalWebRtcScope());
    }

    function loadLocalWebRtcSettings() {
      useLocalWebRtcOverride.value = loadLocalWebRtcOverrideEnabled(getLocalWebRtcScope());
      applyLocalWebRtcSettings(loadLocalWebRtcOverrideConfig(getLocalWebRtcScope()));
    }

    function openAccountManagement() {
      router.push({ name: 'account-settings' });
    }

    function openInputMappingProfiles() {
      router.push({ name: 'input-mapping-profiles', query: { mode: 'manage' } });
    }

    function resetGroupForm() {
      editingGroupId.value = null;
      groupDialogMode.value = 'create';
      groupForm.value = {
        name: '',
        description: '',
        deviceIds: [],
        roleIds: [],
        userIds: [],
      };
      groupManagementError.value = '';
      deviceSearchKeyword.value = '';
      roleSearchKeyword.value = '';
      userSearchKeyword.value = '';
    }

    function openCreateGroupDialog() {
      resetGroupForm();
      showGroupDialog.value = true;
    }

    function toggleGroupManagementList() {
      isGroupManagementListExpanded.value = !isGroupManagementListExpanded.value;
    }

    function populateGroupFormFromGroup(group: DeviceGroupItem) {
      editingGroupId.value = group.Id;
      groupForm.value.name = group.Name;
      groupForm.value.description = group.Description || '';
      groupForm.value.deviceIds = group.IsInternal
        ? groupManagementDevices.value.map((device) => device.Id)
        : groupManagementDevices.value
          .filter((device) => Array.isArray(device.Groups) && device.Groups.some((item) => item.Id === group.Id))
          .map((device) => device.Id);
      groupForm.value.roleIds = groupManagementRoles.value
        .filter((role) => Array.isArray(role.DeviceGroups) && role.DeviceGroups.some((item) => item.Id === group.Id))
        .map((role) => role.Id);
      groupForm.value.userIds = groupManagementUsers.value
        .filter((user) => Array.isArray(user.DirectDeviceGroups) && user.DirectDeviceGroups.some((item) => item.Id === group.Id))
        .map((user) => user.Id);
    }

    async function openEditGroupDialog(group: DeviceGroupItem) {
      resetGroupForm();
      groupDialogMode.value = 'edit';

      await loadGroupManagementData();

      const latestGroup = deviceGroupItems.value.find((item) => item.Id === group.Id) || group;
      populateGroupFormFromGroup(latestGroup);
      showGroupDialog.value = true;
    }

    function closeGroupDialog() {
      showGroupDialog.value = false;
      resetGroupForm();
    }

    function toggleGroupFormSelection(collection: 'deviceIds' | 'roleIds' | 'userIds', id: number, checked: boolean) {
      const next = new Set(groupForm.value[collection]);
      if (checked) {
        next.add(id);
      } else {
        next.delete(id);
      }
      groupForm.value[collection] = [...next];
    }

    function onGroupSelectionChange(collection: 'deviceIds' | 'roleIds' | 'userIds', id: number, event: Event) {
      toggleGroupFormSelection(collection, id, (event.target as HTMLInputElement).checked);
    }

    function hasGroupSelection(collection: 'deviceIds' | 'roleIds' | 'userIds', id: number) {
      return groupForm.value[collection].includes(id);
    }

    async function loadGroupManagementData() {
      return loadGroupManagementDataWithOptions({ includeDevices: true, includeAccounts: true });
    }

    async function loadGroupManagementDataWithOptions(options?: { includeDevices?: boolean; includeAccounts?: boolean }) {
      if (!canManageGroupSection.value) {
        return;
      }

      groupManagementLoading.value = true;
      groupManagementError.value = '';

      try {
        const includeDevices = options?.includeDevices ?? canManageDevices.value;
        const includeAccounts = options?.includeAccounts ?? canManageAccounts.value;
        const requests: Promise<Response>[] = [apiFetch('/api/device-groups')];
        if (includeDevices) {
          requests.push(apiFetch('/api/devices'));
        }
        if (includeAccounts) {
          requests.push(apiFetch('/api/accounts/users'));
        }

        const responses = await Promise.all(requests);
        const [groupsResponse, devicesResponse, accountsResponse] = responses;

        if (!groupsResponse.ok) {
          throw new Error(await readApiErrorMessage(groupsResponse, t('Settings.LoadFailed', '加载失败')));
        }

        const groupsPayload = await groupsResponse.json() as { items?: DeviceGroupItem[] };
        deviceGroupItems.value = groupsPayload.items || [];

        if (devicesResponse) {
          if (!devicesResponse.ok) {
            throw new Error(await readApiErrorMessage(devicesResponse, t('Settings.LoadFailed', '加载失败')));
          }
          groupManagementDevices.value = await devicesResponse.json() as SettingsDeviceItem[];
        } else if (includeDevices) {
          groupManagementDevices.value = [];
        }

        if (accountsResponse) {
          if (!accountsResponse.ok) {
            throw new Error(await readApiErrorMessage(accountsResponse, t('Settings.LoadFailed', '加载失败')));
          }
          const accountsPayload = await accountsResponse.json() as { users?: SettingsUserItem[]; roles?: SettingsRoleItem[] };
          groupManagementUsers.value = accountsPayload.users || [];
          groupManagementRoles.value = accountsPayload.roles || [];
        } else if (includeAccounts) {
          groupManagementUsers.value = [];
          groupManagementRoles.value = [];
        }
      } catch (error) {
        groupManagementError.value = error instanceof Error ? error.message : t('Settings.LoadFailed', '加载失败');
      } finally {
        groupManagementLoading.value = false;
      }
    }

    async function refreshGroupManagementList() {
      await loadGroupManagementDataWithOptions({ includeDevices: false, includeAccounts: false });
    }

    async function saveDeviceGroupAssignments(groupId: number) {
      if (!canManageDevices.value) {
        return;
      }

      for (const device of groupManagementDevices.value) {
        const currentGroupIds = new Set((device.Groups || []).map((item) => item.Id));
        const shouldInclude = groupForm.value.deviceIds.includes(device.Id);

        if (shouldInclude) {
          currentGroupIds.add(groupId);
        } else {
          currentGroupIds.delete(groupId);
        }

        const nextGroupIds = [...currentGroupIds].sort((left, right) => left - right);
        const currentNormalized = [...new Set((device.Groups || []).map((item) => item.Id))].sort((left, right) => left - right);
        if (JSON.stringify(nextGroupIds) === JSON.stringify(currentNormalized)) {
          continue;
        }

        const response = await apiFetch(`/api/devices/${device.Id}/groups`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ groupIds: nextGroupIds })
        });
        if (!response.ok) {
          throw new Error(await readApiErrorMessage(response, t('Settings.SaveFailed', '保存失败')));
        }
      }
    }

    async function saveRoleGroupAssignments(groupId: number) {
      if (!canManageAccounts.value) {
        return;
      }

      for (const role of groupManagementRoles.value) {
        const currentGroupIds = new Set((role.DeviceGroups || []).map((item) => item.Id));
        const shouldInclude = groupForm.value.roleIds.includes(role.Id);

        if (shouldInclude) {
          currentGroupIds.add(groupId);
        } else {
          currentGroupIds.delete(groupId);
        }

        const nextGroupIds = [...currentGroupIds].sort((left, right) => left - right);
        const currentNormalized = [...new Set((role.DeviceGroups || []).map((item) => item.Id))].sort((left, right) => left - right);
        if (JSON.stringify(nextGroupIds) === JSON.stringify(currentNormalized)) {
          continue;
        }

        const response = await apiFetch(`/api/accounts/roles/${role.Id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: role.Name,
            description: role.Description,
            permissions: role.Permissions,
            deviceGroupIds: nextGroupIds,
          })
        });
        if (!response.ok) {
          throw new Error(await readApiErrorMessage(response, t('Settings.SaveFailed', '保存失败')));
        }
      }
    }

    async function saveUserGroupAssignments(groupId: number) {
      if (!canManageAccounts.value) {
        return;
      }

      for (const user of groupManagementUsers.value) {
        const currentGroupIds = new Set((user.DirectDeviceGroups || []).map((item) => item.Id));
        const shouldInclude = groupForm.value.userIds.includes(user.Id);

        if (shouldInclude) {
          currentGroupIds.add(groupId);
        } else {
          currentGroupIds.delete(groupId);
        }

        const nextGroupIds = [...currentGroupIds].sort((left, right) => left - right);
        const currentNormalized = [...new Set((user.DirectDeviceGroups || []).map((item) => item.Id))].sort((left, right) => left - right);
        if (JSON.stringify(nextGroupIds) === JSON.stringify(currentNormalized)) {
          continue;
        }

        const response = await apiFetch(`/api/accounts/users/${user.Id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            username: user.Username,
            isActive: user.IsActive,
            roleIds: user.Roles.map((role) => role.Id),
            deviceGroupIds: nextGroupIds,
          })
        });
        if (!response.ok) {
          throw new Error(await readApiErrorMessage(response, t('Settings.SaveFailed', '保存失败')));
        }
      }
    }

    async function saveGroupDialog() {
      const name = groupForm.value.name.trim();
      if (!isEditingInternalGroup.value && !name) {
        groupManagementError.value = t('Settings.GroupNameRequired', '分组名称不能为空');
        return;
      }

      groupManagementSaving.value = true;
      groupManagementError.value = '';

      try {
        let groupId = editingGroupId.value;

        if (groupDialogMode.value === 'create') {
          const response = await apiFetch('/api/device-groups', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              name,
              description: groupForm.value.description.trim(),
            })
          });
          const payload = await response.json().catch(() => null);
          if (!response.ok) {
            throw new Error(resolveApiErrorMessage(payload, t('Settings.SaveFailed', '保存失败')));
          }
          groupId = payload?.group?.Id ?? null;
        } else if (groupId && !isEditingInternalGroup.value) {
          const response = await apiFetch(`/api/device-groups/${groupId}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              name,
              description: groupForm.value.description.trim(),
            })
          });
          const payload = await response.json().catch(() => null);
          if (!response.ok) {
            throw new Error(resolveApiErrorMessage(payload, t('Settings.SaveFailed', '保存失败')));
          }
        }

        if (!groupId) {
          throw new Error(t('Settings.SaveFailed', '保存失败'));
        }

        if (!isEditingInternalGroup.value) {
          await saveDeviceGroupAssignments(groupId);
        }
        await saveRoleGroupAssignments(groupId);
        await saveUserGroupAssignments(groupId);

        notifications.show({
          type: 'success',
          title: t('Settings.SaveSuccess', '保存成功'),
          message: groupDialogMode.value === 'create'
            ? t('Settings.GroupCreateSuccess', '设备分组已创建')
            : t('Settings.GroupSaveSuccess', '设备分组已更新')
        });

        closeGroupDialog();
        await loadGroupManagementData();
      } catch (error) {
        groupManagementError.value = error instanceof Error ? error.message : t('Settings.SaveFailed', '保存失败');
      } finally {
        groupManagementSaving.value = false;
      }
    }

    async function deleteDeviceGroup(group: DeviceGroupItem) {
      if (group.IsInternal) {
        return;
      }

      const confirmed = await dialogService.confirm(
        t('Settings.DeleteDeviceGroupTitle', '删除设备分组'),
        t('Settings.GroupDeleteConfirm', '确定要删除这个分组吗？'),
        t('Common.Delete', '删除'),
        t('Common.Cancel', '取消')
      );
      if (!confirmed) {
        return;
      }

      try {
        const response = await apiFetch(`/api/device-groups/${group.Id}`, {
          method: 'DELETE'
        });
        if (!response.ok) {
          throw new Error(await readApiErrorMessage(response, t('Settings.SaveFailed', '保存失败')));
        }

        notifications.show({
          type: 'success',
          title: t('Settings.SaveSuccess', '保存成功'),
          message: t('Settings.GroupDeleteSuccess', '设备分组已删除')
        });
        await loadGroupManagementData();
      } catch (error) {
        groupManagementError.value = error instanceof Error ? error.message : t('Settings.SaveFailed', '保存失败');
      }
    }

    function closeChangePasswordDialog() {
      showChangePasswordDialog.value = false;
      changePasswordError.value = '';
      changePasswordForm.value = {
        currentPassword: '',
        newPassword: '',
        confirmPassword: ''
      };
    }

    async function handleLogout() {
      await logout();
      router.push({ name: 'login' });
    }

    async function handleLogoutAll() {
      if (loggingOutAll.value) {
        return;
      }

      const confirmed = await dialogService.confirm(
        t('Settings.LogoutAllTitle', '退出所有会话'),
        t('Settings.LogoutAllConfirm', '确定要结束当前账户的所有会话吗？这会让当前浏览器以及其他已登录设备全部退出。'),
        t('Settings.LogoutAll', '退出所有会话'),
        t('Common.Cancel', '取消')
      );
      if (!confirmed) {
        return;
      }

      loggingOutAll.value = true;
      try {
        await logoutAll();
        router.push({ name: 'login' });
      } catch (error) {
        notifications.show({
          type: 'error',
          title: t('Settings.LogoutAllFailedTitle', '退出全部会话失败'),
          message: error instanceof Error ? error.message : t('Errors.LogoutAllFailed', '退出全部会话失败')
        });
      } finally {
        loggingOutAll.value = false;
      }
    }

    async function loadAppVersion() {
      const response = await apiFetch('/api/app/version', {
        requiresAuth: false,
        retryOnUnauthorized: false,
        handleUnauthorized: false,
        handleForbidden: false
      });

      if (!response.ok) {
        throw new Error(await readApiErrorMessage(response, t('Settings.LoadVersionFailed', '加载版本信息失败')));
      }

      const payload = await response.json() as {
        version?: string;
        webVersion?: string;
        releaseTag?: string;
        latestReleaseUrl?: string;
      };

      const version = payload.webVersion ?? payload.version ?? '1.0.0';
      currentAppVersion.value = version;
      currentReleaseTag.value = payload.releaseTag ?? `v${version}`;
      latestReleaseUrl.value = payload.latestReleaseUrl ?? latestReleaseUrl.value;
      appVersionDescription.value = version;
    }

    async function checkForUpdates() {
      if (isCheckingUpdates.value) {
        return;
      }

      isCheckingUpdates.value = true;
      try {
        const response = await fetch('https://api.github.com/repos/5656565566/AYLink.Extra/releases/latest', {
          headers: {
            Accept: 'application/vnd.github+json'
          }
        });

        if (!response.ok) {
          throw new Error(t('Settings.CheckUpdatesFailedMessage', '获取最新版本失败'));
        }

        const payload = await response.json() as {
          html_url?: string;
          tag_name?: string;
        };

        const latestTag = payload.tag_name ?? '';
        const latestUrl = payload.html_url ?? latestReleaseUrl.value;
        const compareResult = compareVersions(currentReleaseTag.value, latestTag);

        if (compareResult < 0) {
          notifications.show({
            type: 'info',
            title: t('Settings.UpdateAvailableTitle', '发现新版本'),
            message: t('Settings.UpdateAvailableMessage', '当前版本 {0}，最新版本 {1}', currentAppVersion.value, normalizeVersion(latestTag))
          });
          openExternalUrl(latestUrl);
          return;
        }

        notifications.show({
          type: 'success',
          title: t('Settings.UpToDateTitle', '已是最新版本'),
          message: t('Settings.UpToDateMessage', '当前版本 {0} 已是最新版本', currentAppVersion.value)
        });
      } catch (error) {
        notifications.show({
          type: 'error',
          title: t('Settings.CheckUpdatesFailedTitle', '检查更新失败'),
          message: error instanceof Error ? error.message : t('Settings.CheckUpdatesFailedMessage', '获取最新版本失败')
        });
      } finally {
        isCheckingUpdates.value = false;
      }
    }

    async function loadWebRtcSettings() {
      if (!canViewRemoteSettings.value) {
        return;
      }

      const response = await apiFetch('/api/settings/webrtc-network');
      if (!response.ok) {
        throw new Error(await readApiErrorMessage(response, t('Settings.LoadFailed', '加载失败')));
      }

      applyWebRtcSettings(await response.json());
    }

    async function saveWebRtcSettings() {
      if (!canManageRemoteSettings.value) {
        return;
      }

      webrtcSaving.value = true;

      try {
        const response = await apiFetch('/api/settings/webrtc-network', {
          method: 'PUT',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify(buildWebRtcSettingsPayload())
        });

        if (!response.ok) {
          throw new Error(await readApiErrorMessage(response, t('Settings.SaveFailed', '保存失败')));
        }

        applyWebRtcSettings(await response.json());
        webrtcStatusMessage.value = t('Settings.SaveSuccess', '保存成功');

        window.setTimeout(() => {
          if (webrtcStatusMessage.value === t('Settings.SaveSuccess', '保存成功')) {
            webrtcStatusMessage.value = '';
          }
        }, 3000);
      } catch (error) {
        console.error('Failed to save WebRTC settings:', error);
        webrtcStatusMessage.value = error instanceof Error ? error.message : t('Settings.SaveFailed', '保存失败');
      } finally {
        webrtcSaving.value = false;
      }
    }

    async function submitChangePassword() {
      if (!canChangeOwnPassword.value) {
        return;
      }

      changePasswordError.value = '';
      if (!changePasswordForm.value.currentPassword || !changePasswordForm.value.newPassword) {
        changePasswordError.value = t('Settings.ChangePasswordRequired', '请完整填写密码信息');
        return;
      }

      if (changePasswordForm.value.newPassword !== changePasswordForm.value.confirmPassword) {
        changePasswordError.value = t('Settings.PasswordMismatch', '两次输入的新密码不一致');
        return;
      }

      changingPassword.value = true;
      try {
        const response = await apiFetch('/api/auth/change-password', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            currentPassword: changePasswordForm.value.currentPassword,
            newPassword: changePasswordForm.value.newPassword
          })
        });
        const payload = await response.json();
        if (!response.ok) {
          throw new Error(resolveApiErrorMessage(payload, t('Settings.ChangePasswordFailed', '修改密码失败')));
        }

        notifications.show({
          type: 'success',
          title: t('Settings.ChangePasswordSuccessTitle', '密码已修改'),
          message: t('Settings.ChangePasswordSuccessMessage', '密码已更新，请重新登录。')
        });
        closeChangePasswordDialog();
        await handleLogout();
      } catch (error) {
        changePasswordError.value = error instanceof Error ? error.message : t('Settings.ChangePasswordFailed', '修改密码失败');
      } finally {
        changingPassword.value = false;
      }
    }

    async function initializeSettingsData() {
      loadLocalWebRtcSettings();

      void loadAppVersion().catch((error) => {
        console.error('Failed to load app version:', error);
        appVersionDescription.value = t('Settings.VersionUnavailable', '版本信息不可用');
      });

      const tasks: Array<Promise<unknown>> = [];

      if (canViewRemoteSettings.value) {
        tasks.push(loadWebRtcSettings().catch((error) => {
          console.error('Failed to load WebRTC settings:', error);
          webrtcStatusMessage.value = error instanceof Error ? error.message : t('Settings.LoadFailed', '加载失败');
        }));
      }

      if (canManageGroupSection.value) {
        tasks.push(loadGroupManagementData());
      }

      if (tasks.length > 0) {
        await Promise.allSettled(tasks);
      }
    }

    onMounted(() => {
      window.addEventListener('keydown', handleInputMappingKeyCapture, true);
      void initializeSettingsData();
    });

    onUnmounted(() => {
      window.removeEventListener('keydown', handleInputMappingKeyCapture, true);
    });

    return {
      themeMode,
      accentColor,
      setThemeMode,
      setAccentColor,
      resetTheme,
      t,
      currentLocale,
      languages,
      setLocale,
      adaptivePointerSampling,
      backgroundMute,
      backgroundEnabled,
      backgroundImages,
      newDisplayDpiMode,
      newDisplayDpiValue,
      pointerSamplingRateHz,
      previewRefreshInterval,
      weakNetworkMode,
      debugMode,
      inputMappingMouseCaptureKey,
      inputMappingMouseSensitivity,
      inputMappingToggleHintsKey,
      inputMappingPauseToggleKey,
      capturingInputMappingKey,
      setAdaptivePointerSampling,
      setBackgroundMute,
      setNewDisplayDpiMode,
      setNewDisplayDpiValue,
      setPointerSamplingRateHz,
      setPreviewRefreshInterval,
      setWeakNetworkMode,
      setDebugMode,
      router,
      auth,
      currentUser,
      notifications,
      canManageAccounts,
      canManageDevices,
      canViewRemoteSettings,
      canManageRemoteSettings,
      canChangeOwnPassword,
      canManageGroupSection,
      appVersionDescription,
      currentAppVersion,
      currentReleaseTag,
      latestReleaseUrl,
      isCheckingUpdates,
      getLocalWebRtcScope,
      nextWebRtcServerFormId,
      createWebRtcServerFormId,
      createDefaultWebRtcServerForm,
      webrtcTransportPolicy,
      webrtcFallbackLocale,
      webrtcServers,
      webrtcHostCandidateOverrideEnabled,
      webrtcHostCandidateOverrideIPsText,
      webrtcHostCandidatePortMin,
      webrtcHostCandidatePortMax,
      webrtcSinglePortMuxEnabled,
      webrtcSinglePortMuxBindPort,
      webrtcSinglePortMuxPublishPort,
      isWebRtcServersListExpanded,
      webrtcSaving,
      webrtcStatusMessage,
      useLocalWebRtcOverride,
      localWebrtcTransportPolicy,
      localWebrtcServers,
      isLocalWebRtcServersListExpanded,
      showChangePasswordDialog,
      showBackgroundDialog,
      showGroupDialog,
      changingPassword,
      loggingOutAll,
      groupManagementLoading,
      groupManagementSaving,
      groupManagementError,
      deviceGroupItems,
      groupManagementDevices,
      groupManagementUsers,
      groupManagementRoles,
      isGroupManagementListExpanded,
      groupSearchKeyword,
      deviceSearchKeyword,
      roleSearchKeyword,
      userSearchKeyword,
      groupDialogMode,
      groupForm,
      filteredDeviceGroups,
      filteredGroupDevices,
      filteredGroupRoles,
      filteredGroupUsers,
      editingGroup,
      isEditingInternalGroup,
      changePasswordError,
      changePasswordForm,
      isSettingInternally,
      isLocalSettingInternally,
      skipSaveTimer,
      saveTimeout,
      localSkipSaveTimer,
      localSaveTimeout,
      onThemeModeChange,
      onAccentColorInput,
      onLocaleChange,
      onAdaptivePointerSamplingChange,
      onBackgroundMuteChange,
      onBackgroundEnabledChange,
      onUseLocalWebRtcOverrideChange,
      onNewDisplayDpiModeChange,
      onNewDisplayDpiValueChange,
      onPointerSamplingRateChange,
      onPreviewRefreshIntervalChange,
      onWeakNetworkModeChange,
      onDebugModeChange,
      onInputMappingMouseSensitivityChange,
      startInputMappingKeyCapture,
      handleInputMappingKeyCapture,
      normalizeVersion,
      compareVersions,
      openExternalUrl,
      openGitHubRepository,
      handleUploadBackground,
      onWebRtcHostCandidateOverrideEnabledChange,
      onWebRtcSinglePortMuxEnabledChange,
      createWebRtcServerForm,
      isWebRtcServerDraft,
      mergeServerDrafts,
      normalizeOptionalPort,
      normalizeWebRtcPayload,
      applyWebRtcSettings,
      applyLocalWebRtcSettings,
      buildWebRtcSettingsPayload,
      buildLocalWebRtcSettingsPayload,
      addWebRtcServer,
      addLocalWebRtcServer,
      removeBackgroundImage,
      removeWebRtcServer,
      removeLocalWebRtcServer,
      resetWebRtcSettings,
      resetLocalWebRtcSettings,
      saveLocalWebRtcSettings,
      loadLocalWebRtcSettings,
      openAccountManagement,
      openInputMappingProfiles,
      openCreateGroupDialog,
      toggleGroupManagementList,
      openEditGroupDialog,
      closeGroupDialog,
      toggleGroupFormSelection,
      onGroupSelectionChange,
      hasGroupSelection,
      loadGroupManagementData,
      refreshGroupManagementList,
      saveGroupDialog,
      deleteDeviceGroup,
      closeChangePasswordDialog,
      handleLogout,
      handleLogoutAll,
      loadAppVersion,
      checkForUpdates,
      loadWebRtcSettings,
      saveWebRtcSettings,
      submitChangePassword,
      initializeSettingsData
    };
  }
});
