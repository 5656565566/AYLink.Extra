import { defineComponent } from 'vue';
import { onMounted, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import SettingSection from '../components/SettingSection.vue';
import SettingItem from '../components/SettingItem.vue';
import { useI18n } from '../composables/useI18n';
import { backgroundEnabled, backgroundImages, addBackgroundImages, removeBackgroundImage, setBackgroundEnabled } from '../services/background';
import { useAppSettings } from '../services/appSettings';
import { useTheme, type ThemeMode } from '../services/theme';
import { hasPermission, logout, useAuth } from '../services/auth';
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

export default defineComponent({
  name: 'SettingsView',
  components: {
    SettingSection,
    SettingItem
  },
  setup() {
    const { themeMode, accentColor, setThemeMode, setAccentColor, resetTheme } = useTheme();

    const { t, currentLocale, languages, setLocale, loadServerLocale } = useI18n();

    const { backgroundMute, newDisplayDpiMode, newDisplayDpiValue, setBackgroundMute, setNewDisplayDpiMode, setNewDisplayDpiValue } = useAppSettings();

    const router = useRouter();

    const auth = useAuth();

    const currentUser = auth.currentUser;

    const notifications = useNotification();

    const canManageAccounts = hasPermission('accounts.manage');

    const canViewRemoteSettings = hasPermission('settings.view');

    const canManageRemoteSettings = hasPermission('settings.manage');

    const canChangeOwnPassword = hasPermission('accounts.change-password');

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

    const webrtcServers = ref<WebRtcServerForm[]>([createDefaultWebRtcServerForm('stun')]);

    const webrtcHostCandidateOverrideEnabled = ref(false);

    const webrtcHostCandidateOverrideIPsText = ref('');

    const webrtcHostCandidatePortMin = ref('');

    const webrtcHostCandidatePortMax = ref('');

    const webrtcSinglePortMuxEnabled = ref(false);

    const webrtcSinglePortMuxBindPort = ref('');

    const webrtcSinglePortMuxPublishPort = ref('');

    const isWebRtcServersListExpanded = ref(true);

    const webrtcSaving = ref(false);

    const webrtcStatusMessage = ref('');

    const useLocalWebRtcOverride = ref(loadLocalWebRtcOverrideEnabled());

    const localWebrtcTransportPolicy = ref<'all' | 'relay'>('all');

    const localWebrtcServers = ref<WebRtcServerForm[]>([createDefaultWebRtcServerForm('stun')]);

    const isLocalWebRtcServersListExpanded = ref(true);

    const showChangePasswordDialog = ref(false);

    const showBackgroundDialog = ref(false);

    const changingPassword = ref(false);

    const changePasswordError = ref('');

    const changePasswordForm = ref({
      currentPassword: '',
      newPassword: '',
      confirmPassword: ''
    });

    let isSettingInternally = false;

    let isLocalSettingInternally = false;

    let skipSaveTimer: number | null = null;

    let saveTimeout: number | null = null;

    let localSkipSaveTimer: number | null = null;

    let localSaveTimeout: number | null = null;

    watch(
      [webrtcTransportPolicy, webrtcServers, webrtcHostCandidateOverrideEnabled, webrtcHostCandidateOverrideIPsText, webrtcHostCandidatePortMin, webrtcHostCandidatePortMax, webrtcSinglePortMuxEnabled, webrtcSinglePortMuxBindPort, webrtcSinglePortMuxPublishPort],
      () => {
        if (isSettingInternally || !canManageRemoteSettings) return;
        
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
      void setLocale((event.target as HTMLSelectElement).value, canManageRemoteSettings);
    }

    function onBackgroundMuteChange(event: Event) {
      setBackgroundMute((event.target as HTMLInputElement).checked);
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

    function applyWebRtcSettings(payload?: WebRtcNetworkSettingsPayload | null) {
      const normalizedPayload = normalizeWebRtcPayload(payload);
      isSettingInternally = true;
      webrtcTransportPolicy.value = normalizedPayload.IceTransportPolicy === 'relay' ? 'relay' : 'all';
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
      return normalizeWebRtcPayload({
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

    async function loadWebRtcSettings() {
      if (!canViewRemoteSettings) {
        return;
      }
    
      const response = await apiFetch('/api/settings/webrtc-network');
      if (!response.ok) {
        throw new Error(await readApiErrorMessage(response, t('Settings.LoadFailed', '加载失败')));
      }
    
      applyWebRtcSettings(await response.json());
    }

    async function saveWebRtcSettings() {
      if (!canManageRemoteSettings) {
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
      if (!canChangeOwnPassword) {
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

    onMounted(() => {
      loadLocalWebRtcSettings();
    
      if (canViewRemoteSettings) {
        void loadServerLocale();
      }
      if (canViewRemoteSettings) {
        void loadWebRtcSettings().catch((error) => {
          console.error('Failed to load WebRTC settings:', error);
          webrtcStatusMessage.value = error instanceof Error ? error.message : t('Settings.LoadFailed', '加载失败');
        });
      }
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
      loadServerLocale,
      backgroundMute,
      backgroundEnabled,
      backgroundImages,
      newDisplayDpiMode,
      newDisplayDpiValue,
      setBackgroundMute,
      setNewDisplayDpiMode,
      setNewDisplayDpiValue,
      router,
      auth,
      currentUser,
      notifications,
      canManageAccounts,
      canViewRemoteSettings,
      canManageRemoteSettings,
      canChangeOwnPassword,
      getLocalWebRtcScope,
      nextWebRtcServerFormId,
      createWebRtcServerFormId,
      createDefaultWebRtcServerForm,
      webrtcTransportPolicy,
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
      changingPassword,
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
      onBackgroundMuteChange,
      onBackgroundEnabledChange,
      onUseLocalWebRtcOverrideChange,
      onNewDisplayDpiModeChange,
      onNewDisplayDpiValueChange,
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
      closeChangePasswordDialog,
      handleLogout,
      loadWebRtcSettings,
      saveWebRtcSettings,
      submitChangePassword
    };
  }
});
