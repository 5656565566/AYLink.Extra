<template>
  <div class="settings-view">
    <div class="settings-content">
      <SettingSection :title="t('Settings.General', '通用')">
        <SettingItem
          :title="t('Settings.Language', '语言')"
          :description="t('Settings.LanguageDescription', '选择应用程序的显示语言')"
        >
          <select class="fluent-select" :value="currentLocale" @change="onLocaleChange">
            <option v-for="language in languages" :key="language.locale" :value="language.locale">
              {{ language.name }}
            </option>
          </select>
        </SettingItem>
        <SettingItem
          :title="t('Settings.BackgroundMute', '后台静音')"
          :description="t('Settings.BackgroundMuteDescription', '窗口失去焦点或切到后台时自动静音网页音频')"
        >
          <label class="toggle-switch" :class="{ active: backgroundMute }">
            <input
              class="toggle-switch__input"
              type="checkbox"
              :checked="backgroundMute"
              @change="onBackgroundMuteChange"
            />
            <span class="toggle-switch__slider"></span>
          </label>
        </SettingItem>
      </SettingSection>

      <SettingSection :title="t('Settings.Appearance', '外观')">
        <SettingItem
          :title="t('Settings.ThemeMode', '主题模式')"
          :description="t('Settings.ThemeModeDescription', '选择应用程序的亮色或暗色主题')"
        >
          <select class="fluent-select" :value="themeMode" @change="onThemeModeChange">
            <option value="system">{{ t('Settings.ThemeSystem', '跟随系统') }}</option>
            <option value="dark">{{ t('Settings.ThemeDark', '深色') }}</option>
            <option value="light">{{ t('Settings.ThemeLight', '浅色') }}</option>
          </select>
        </SettingItem>
        <SettingItem
          :title="t('Settings.BackgroundEffect', '背景图')"
          :description="t('Settings.BackgroundEffectDescription', '在窗口底层显示背景图片')"
        >
          <label class="toggle-switch" :class="{ active: backgroundEnabled }">
            <input
              class="toggle-switch__input"
              type="checkbox"
              :checked="backgroundEnabled"
              @change="onBackgroundEnabledChange"
            />
            <span class="toggle-switch__slider"></span>
          </label>
        </SettingItem>

        <SettingItem
          v-if="backgroundEnabled"
          :title="t('Settings.BackgroundImages', '管理背景图')"
          :description="t('Settings.BackgroundImagesDescription', '多张图片随机展示，一张固定展示')"
        >
          <button class="fluent-btn" @click="showBackgroundDialog = true">{{ t('Settings.Manage', '管理') }}</button>
        </SettingItem>

        <SettingItem
          :title="t('Settings.AccentColor', '强调色')"
          :description="t('Settings.AccentColorDescription', '自定义应用程序的强调颜色')"
        >
          <input
            type="color"
            class="fluent-color-picker"
            :value="accentColor"
            @input="onAccentColorInput"
          />
        </SettingItem>
      </SettingSection>

      <SettingSection :title="t('Settings.About', '关于')">
        <SettingItem :title="t('Settings.AppVersion', '应用版本')" description="1.0.0">
        </SettingItem>
        <SettingItem
          :title="t('Settings.CheckUpdates', '检查更新')"
          :description="t('Settings.CheckUpdatesDescription', '获取最新版本的应用程序')"
        >
          <button class="fluent-btn">{{ t('Settings.CheckNow', '立即检查') }}</button>
        </SettingItem>
        <SettingItem title="GitHub" description="https://github.com/5656565566/AYLink">
          <button class="fluent-btn">{{ t('Settings.OpenGitHub', '打开 GitHub 仓库') }}</button>
        </SettingItem>
        <SettingItem
          :title="t('Settings.RestoreDefaults', '恢复默认设置')"
          :description="t('Settings.RestoreDefaultsDescription', '将所有设置恢复为初始状态')"
        >
          <button class="fluent-btn" @click="resetTheme">{{ t('Settings.Restore', '恢复') }}</button>
        </SettingItem>
      </SettingSection>

      <SettingSection v-if="currentUser" :title="t('Settings.LocalWebRtcNetwork', '本地 WebRTC 网络偏好')">
        <SettingItem
          :title="t('Settings.UseLocalWebRtcOverride', '使用本地 WebRTC 覆盖')"
          :description="t('Settings.UseLocalWebRtcOverrideDescription', '仅对当前浏览器和当前账号生效，投屏时优先于全局默认配置')"
        >
          <label class="toggle-switch" :class="{ active: useLocalWebRtcOverride }">
            <input
              class="toggle-switch__input"
              type="checkbox"
              :checked="useLocalWebRtcOverride"
              @change="useLocalWebRtcOverride = ($event.target as HTMLInputElement).checked"
            />
            <span class="toggle-switch__slider"></span>
          </label>
        </SettingItem>

        <template v-if="useLocalWebRtcOverride">
          <SettingItem
            :title="t('Settings.IceTransportPolicy', 'ICE 传输策略')"
            :description="t('Settings.LocalIceTransportPolicyDescription', '当前浏览器投屏时使用的本地优先策略')"
          >
            <select class="fluent-select" v-model="localWebrtcTransportPolicy">
              <option value="all">{{ t('Settings.IceTransportAll', '全部候选 (all)') }}</option>
              <option value="relay">{{ t('Settings.IceTransportRelay', '仅 TURN 中继 (relay)') }}</option>
            </select>
          </SettingItem>

          <div class="webrtc-servers-container">
            <div class="webrtc-servers-header" :class="{ expanded: isLocalWebRtcServersListExpanded }" @click="isLocalWebRtcServersListExpanded = !isLocalWebRtcServersListExpanded">
              <span class="webrtc-servers-header__title">{{ t('Settings.IceServersList', 'ICE 服务器列表') }}</span>
              <svg class="webrtc-servers-header__chevron" :class="{ expanded: isLocalWebRtcServersListExpanded }" viewBox="0 0 24 24" width="20" height="20">
                <path fill="currentColor" d="M7.41 8.59L12 13.17l4.59-4.58L18 10l-6 6-6-6 1.41-1.41z"/>
              </svg>
            </div>

            <div class="webrtc-servers-grid-wrapper" :class="{ expanded: isLocalWebRtcServersListExpanded }">
              <div class="webrtc-servers-list">
                <div v-for="(server, index) in localWebrtcServers" :key="server.id" class="webrtc-server-card">
                  <div class="webrtc-server-card__header">
                    <span class="webrtc-server-card__title">
                      {{ server.type === 'stun' ? 'STUN' : 'TURN' }} {{ t('Settings.IceServer', '服务器') }} {{ index + 1 }}
                    </span>
                    <button
                      v-if="localWebrtcServers.length > 1"
                      type="button"
                      class="webrtc-server-card__remove-btn"
                      @click.stop="removeLocalWebRtcServer(index)"
                    >
                      {{ t('Settings.Remove', '删除') }}
                    </button>
                  </div>

                  <div class="webrtc-server-card__body">
                    <label class="webrtc-field">
                      <span class="webrtc-field__label">{{ t('Settings.IceServerUrls', '服务器地址') }}</span>
                      <textarea
                        v-model="server.urlsText"
                        class="fluent-textarea"
                        rows="2"
                        :placeholder="server.type === 'stun' ? 'stun:stun.l.google.com:19302' : 'turn:your.turn.server:3478'"
                      ></textarea>
                    </label>

                    <div v-if="server.type === 'turn'" class="webrtc-server-grid">
                      <label class="webrtc-field">
                        <span class="webrtc-field__label">{{ t('Settings.IceServerUsername', '用户名') }}</span>
                        <input
                          v-model="server.username"
                          type="text"
                          class="fluent-input"
                          :placeholder="t('Settings.IceServerUsernamePlaceholder', 'TURN 用户名，可留空')"
                        />
                      </label>

                      <label class="webrtc-field">
                        <span class="webrtc-field__label">{{ t('Settings.IceServerCredential', '密码') }}</span>
                        <input
                          v-model="server.credential"
                          type="text"
                          class="fluent-input"
                          :placeholder="t('Settings.IceServerCredentialPlaceholder', 'TURN 密码，可留空')"
                        />
                      </label>
                    </div>
                  </div>
                </div>

                <div class="webrtc-list-actions">
                  <button type="button" class="fluent-btn-ghost" @click="addLocalWebRtcServer('stun')">
                    + {{ t('Settings.AddStunServer', '添加 STUN') }}
                  </button>
                  <button type="button" class="fluent-btn-ghost" @click="addLocalWebRtcServer('turn')">
                    + {{ t('Settings.AddTurnServer', '添加 TURN') }}
                  </button>
                </div>
              </div>
            </div>
          </div>

          <SettingItem
            :title="t('Settings.RestoreDefaults', '恢复默认设置')"
            :description="t('Settings.LocalWebRtcRestoreDescription', '将当前浏览器的本地 WebRTC 偏好恢复为默认值')"
          >
            <button type="button" class="fluent-btn-text" @click="resetLocalWebRtcSettings">
              {{ t('Settings.RestoreDefaults', '恢复默认设置') }}
            </button>
          </SettingItem>
        </template>
      </SettingSection>

      <SettingSection v-if="canViewRemoteSettings" :title="t('Settings.WebRtcNetwork', 'WebRTC 网络')">
        <SettingItem
          :title="t('Settings.IceTransportPolicy', 'ICE 传输策略')"
          :description="t('Settings.IceTransportPolicyDescription', 'all 为直连优先，relay 为强制通过 TURN 中继')"
        >
          <select class="fluent-select" v-model="webrtcTransportPolicy">
            <option value="all">{{ t('Settings.IceTransportAll', '全部候选 (all)') }}</option>
            <option value="relay">{{ t('Settings.IceTransportRelay', '仅 TURN 中继 (relay)') }}</option>
          </select>
        </SettingItem>

        <SettingItem
          :title="t('Settings.HostCandidateOverrideEnabled', '启用直连 Host Candidate 覆写')"
          :description="t('Settings.HostCandidateOverrideEnabledDescription', '为所有客户端发布指定的对外直连地址，适用于无 STUN/TURN 的传统部署')"
        >
          <label class="toggle-switch" :class="{ active: webrtcHostCandidateOverrideEnabled }">
            <input
              class="toggle-switch__input"
              type="checkbox"
              :checked="webrtcHostCandidateOverrideEnabled"
              @change="webrtcHostCandidateOverrideEnabled = ($event.target as HTMLInputElement).checked"
            />
            <span class="toggle-switch__slider"></span>
          </label>
        </SettingItem>

        <template v-if="webrtcHostCandidateOverrideEnabled">
          <SettingItem
            :title="t('Settings.HostCandidateOverrideIPs', '直连地址列表')"
            :description="t('Settings.HostCandidateOverrideIPsDescription', '一行一个 IP 地址，投屏时将作为 host candidate 发布给对端')"
          >
            <textarea
              v-model="webrtcHostCandidateOverrideIPsText"
              class="fluent-textarea"
              rows="3"
              :placeholder="t('Settings.HostCandidateOverrideIPsPlaceholder', '例如:\n10.0.0.5\nrtc.example.com')"
            ></textarea>
          </SettingItem>

          <SettingItem
            :title="t('Settings.SinglePortMuxEnabled', '启用单端口映射模式')"
            :description="t('Settings.SinglePortMuxEnabledDescription', '适用于 FRP 或端口映射场景，使用固定本地 UDP 端口并允许单独指定发布给 ICE 的端口')"
          >
            <label class="toggle-switch" :class="{ active: webrtcSinglePortMuxEnabled }">
              <input
                class="toggle-switch__input"
                type="checkbox"
                :checked="webrtcSinglePortMuxEnabled"
                @change="webrtcSinglePortMuxEnabled = ($event.target as HTMLInputElement).checked"
              />
              <span class="toggle-switch__slider"></span>
            </label>
          </SettingItem>

          <SettingItem
            v-if="!webrtcSinglePortMuxEnabled"
            :title="t('Settings.HostCandidatePortRange', 'UDP 端口范围')"
            :description="t('Settings.HostCandidatePortRangeDescription', '留空则随机；同时填写起始和结束端口时，将限制 host candidate 使用该范围')"
          >
            <div class="webrtc-server-grid">
              <label class="webrtc-field">
                <span class="webrtc-field__label">{{ t('Settings.PortRangeMin', '起始端口') }}</span>
                <input
                  v-model="webrtcHostCandidatePortMin"
                  type="number"
                  min="1"
                  max="65535"
                  class="fluent-input"
                  :placeholder="t('Settings.PortRangeMinPlaceholder', '留空则随机')"
                />
              </label>

              <label class="webrtc-field">
                <span class="webrtc-field__label">{{ t('Settings.PortRangeMax', '结束端口') }}</span>
                <input
                  v-model="webrtcHostCandidatePortMax"
                  type="number"
                  min="1"
                  max="65535"
                  class="fluent-input"
                  :placeholder="t('Settings.PortRangeMaxPlaceholder', '留空则随机')"
                />
              </label>
            </div>
          </SettingItem>

          <template v-if="webrtcSinglePortMuxEnabled">
            <SettingItem
              :title="t('Settings.SinglePortMuxBindPort', '本地绑定端口')"
              :description="t('Settings.SinglePortMuxBindPortDescription', '服务端实际监听的固定 UDP 端口，FRP 内网侧应转发到这个端口')"
            >
              <input
                v-model="webrtcSinglePortMuxBindPort"
                type="number"
                min="1"
                max="65535"
                class="fluent-input webrtc-single-port-input"
                :placeholder="t('Settings.SinglePortMuxBindPortPlaceholder', '例如 40000')"
              />
            </SettingItem>

            <SettingItem
              :title="t('Settings.SinglePortMuxPublishPort', '对外发布端口')"
              :description="t('Settings.SinglePortMuxPublishPortDescription', '留空则等于本地绑定端口；如经 FRP 映射，可填写外部访问端口')"
            >
              <input
                v-model="webrtcSinglePortMuxPublishPort"
                type="number"
                min="1"
                max="65535"
                class="fluent-input webrtc-single-port-input"
                :placeholder="t('Settings.SinglePortMuxPublishPortPlaceholder', '留空则与绑定端口一致')"
              />
            </SettingItem>
          </template>
        </template>

        <div class="webrtc-servers-container">
          <div class="webrtc-servers-header" :class="{ expanded: isWebRtcServersListExpanded }" @click="isWebRtcServersListExpanded = !isWebRtcServersListExpanded">
            <span class="webrtc-servers-header__title">{{ t('Settings.IceServersList', 'ICE 服务器列表') }}</span>
            <svg class="webrtc-servers-header__chevron" :class="{ expanded: isWebRtcServersListExpanded }" viewBox="0 0 24 24" width="20" height="20">
              <path fill="currentColor" d="M7.41 8.59L12 13.17l4.59-4.58L18 10l-6 6-6-6 1.41-1.41z"/>
            </svg>
          </div>

          <div class="webrtc-servers-grid-wrapper" :class="{ expanded: isWebRtcServersListExpanded }">
            <div class="webrtc-servers-list">
              <div v-for="(server, index) in webrtcServers" :key="server.id" class="webrtc-server-card">
                <div class="webrtc-server-card__header">
                  <span class="webrtc-server-card__title">
                    {{ server.type === 'stun' ? 'STUN' : 'TURN' }} {{ t('Settings.IceServer', '服务器') }} {{ index + 1 }}
                  </span>
                  <button
                    v-if="webrtcServers.length > 1"
                    type="button"
                    class="webrtc-server-card__remove-btn"
                    @click.stop="removeWebRtcServer(index)"
                  >
                    {{ t('Settings.Remove', '删除') }}
                  </button>
                </div>

                <div class="webrtc-server-card__body">
                  <label class="webrtc-field">
                    <span class="webrtc-field__label">{{ t('Settings.IceServerUrls', '服务器地址') }}</span>
                    <textarea
                      v-model="server.urlsText"
                      class="fluent-textarea"
                      rows="2"
                      :placeholder="server.type === 'stun' ? 'stun:stun.l.google.com:19302' : 'turn:your.turn.server:3478'"
                    ></textarea>
                  </label>

                  <div v-if="server.type === 'turn'" class="webrtc-server-grid">
                    <label class="webrtc-field">
                      <span class="webrtc-field__label">{{ t('Settings.IceServerUsername', '用户名') }}</span>
                      <input
                        v-model="server.username"
                        type="text"
                        class="fluent-input"
                        :placeholder="t('Settings.IceServerUsernamePlaceholder', 'TURN 用户名，可留空')"
                      />
                    </label>

                    <label class="webrtc-field">
                      <span class="webrtc-field__label">{{ t('Settings.IceServerCredential', '密码') }}</span>
                      <input
                        v-model="server.credential"
                        type="text"
                        class="fluent-input"
                        :placeholder="t('Settings.IceServerCredentialPlaceholder', 'TURN 密码，可留空')"
                      />
                    </label>
                  </div>
                </div>
              </div>

              <div class="webrtc-list-actions">
                <button type="button" class="fluent-btn-ghost" @click="addWebRtcServer('stun')">
                  + {{ t('Settings.AddStunServer', '添加 STUN') }}
                </button>
                <button type="button" class="fluent-btn-ghost" @click="addWebRtcServer('turn')">
                  + {{ t('Settings.AddTurnServer', '添加 TURN') }}
                </button>
              </div>
            </div>
          </div>
        </div>

        <SettingItem
          :title="t('Settings.RestoreDefaults', '恢复默认设置')"
          :description="t('Settings.GlobalWebRtcRestoreDescription', '将全局 WebRTC 默认配置恢复为系统默认值')"
        >
          <button type="button" class="fluent-btn-text" @click="resetWebRtcSettings">
            {{ t('Settings.RestoreDefaults', '恢复默认设置') }}
          </button>
        </SettingItem>

        <p v-if="webrtcStatusMessage" class="webrtc-status">{{ webrtcStatusMessage }}</p>
      </SettingSection>

      <SettingSection v-if="currentUser" :title="t('Settings.AccountSection', '账户')">
        <SettingItem :title="t('Settings.CurrentLogin', '当前登录')" :description="currentUser.Username">
        </SettingItem>
        <SettingItem
          v-if="canChangeOwnPassword"
          :title="t('Settings.ChangePassword', '修改密码')"
          :description="t('Settings.ChangePasswordDescription', '修改当前登录账号的密码，修改后需要重新登录')"
        >
          <button class="fluent-btn" @click="showChangePasswordDialog = true">{{ t('Settings.ChangePassword', '修改密码') }}</button>
        </SettingItem>
        <SettingItem
          v-if="canManageAccounts"
          :title="t('Settings.AccountManagement', '账户管理')"
          :description="t('Settings.AccountManagementDescription', '管理本地用户、角色和权限')"
        >
          <button class="fluent-btn" @click="openAccountManagement">{{ t('Common.Open', '打开') }}</button>
        </SettingItem>
        <SettingItem
          :title="t('Common.Logout', '退出登录')"
          :description="t('Settings.LogoutDescription', '结束当前浏览器会话并返回登录页')"
        >
          <button class="fluent-btn" @click="handleLogout">{{ t('Common.Logout', '退出登录') }}</button>
        </SettingItem>
      </SettingSection>
    </div>

    <div v-if="showChangePasswordDialog" class="dialog-overlay" @click.self="closeChangePasswordDialog">
      <div class="dialog">
        <div class="dialog-header">
          <h3 class="dialog-title">{{ t('Settings.ChangePassword', '修改密码') }}</h3>
        </div>
        <div class="dialog-content">
          <div class="form-group">
            <input v-model="changePasswordForm.currentPassword" type="password" class="fluent-input" :placeholder="t('Settings.CurrentPasswordPlaceholder', '请输入当前密码')" />
          </div>
          <div class="form-group">
            <input v-model="changePasswordForm.newPassword" type="password" class="fluent-input" :placeholder="t('Settings.NewPasswordPlaceholder', '请输入新密码')" />
          </div>
          <div class="form-group">
            <input v-model="changePasswordForm.confirmPassword" type="password" class="fluent-input" :placeholder="t('Settings.ConfirmPasswordPlaceholder', '请再次输入新密码')" />
          </div>
          <div v-if="changePasswordError" class="error-text">{{ changePasswordError }}</div>
        </div>
        <div class="dialog-footer-grid">
          <button class="primary" :disabled="changingPassword" @click="submitChangePassword">
            {{ changingPassword ? t('Settings.Saving', '保存中...') : t('Settings.ChangePassword', '修改密码') }}
          </button>
          <button class="transparent" :disabled="changingPassword" @click="closeChangePasswordDialog">{{ t('Common.Back', '返回') }}</button>
        </div>
      </div>
    </div>
    <div v-if="showBackgroundDialog" class="dialog-overlay" @click.self="showBackgroundDialog = false">
      <div class="dialog" style="width: 500px; max-width: 90vw;">
        <div class="dialog-header">
          <h3 class="dialog-title">{{ t('Settings.BackgroundImages', '管理背景图') }}</h3>
        </div>
        <div class="dialog-content" style="max-height: 60vh; overflow-y: auto;">
          <div style="display: flex; flex-direction: column; gap: 16px;">
            <div style="display: flex; flex-wrap: wrap; gap: 12px;" v-if="backgroundImages.length > 0">
              <div v-for="img in backgroundImages" :key="img.id" style="position: relative; width: 100px; height: 100px; border-radius: 6px; overflow: hidden; border: 1px solid var(--fluent-stroke-default)">
                <img :src="img.dataUrl" style="width: 100%; height: 100%; object-fit: cover;" />
                <button class="fluent-btn" style="position: absolute; top: 4px; right: 4px; width: 24px; height: 24px; padding: 0; min-width: 0; background: rgba(0,0,0,0.6); border: none; color: white; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: 14px;" @click="removeBackgroundImage(img.id)">✕</button>
              </div>
            </div>
            <div v-else style="color: var(--fluent-text-secondary); font-size: 14px;">
              {{ t('Settings.NoBackgroundImages', '暂无背景图') }}
            </div>
          </div>
        </div>
        <div class="dialog-footer-grid" style="grid-template-columns: 1fr auto; padding: 16px 20px 20px;">
          <div>
            <label class="fluent-btn primary" style="display: inline-flex; align-items: center; justify-content: center; cursor: pointer; margin: 0;">
              {{ t('Settings.UploadImage', '上传图片') }}
              <input type="file" accept="image/*" multiple @change="handleUploadBackground" style="display: none;" />
            </label>
          </div>
          <button class="transparent" @click="showBackgroundDialog = false">{{ t('Common.Close', '关闭') }}</button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
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
import { apiFetch } from '../utils/api';

const { themeMode, accentColor, setThemeMode, setAccentColor, resetTheme } = useTheme();
const { t, currentLocale, languages, setLocale, loadServerLocale } = useI18n();
const { backgroundMute, setBackgroundMute } = useAppSettings();
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
    urlsText: type === 'stun' ? 'stun:stun.l.google.com:19302' : '',
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

async function handleUploadBackground(event: Event) {
  const input = event.target as HTMLInputElement;
  if (!input.files || input.files.length === 0) return;
  await addBackgroundImages(Array.from(input.files));
  input.value = '';
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
    throw new Error(`Failed to load WebRTC settings: ${response.status}`);
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
      throw new Error(`Failed to save WebRTC settings: ${response.status}`);
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
    webrtcStatusMessage.value = t('Settings.SaveFailed', '保存失败');
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
      throw new Error(payload.error || t('Settings.ChangePasswordFailed', '修改密码失败'));
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
      webrtcStatusMessage.value = t('Settings.LoadFailed', '加载失败');
    });
  }
});
</script>

<style scoped>
.settings-view {
  padding: 32px 40px;
  height: 100%;
  overflow-y: auto;
  box-sizing: border-box;
}

.settings-content {
  max-width: 800px;
  margin: 0 auto;
}

.fluent-select {
  background-color: var(--fluent-control-fill-default, rgba(255, 255, 255, 0.05));
  color: var(--fluent-text-primary);
  border: 1px solid var(--fluent-stroke-default, rgba(255, 255, 255, 0.08));
  padding: 6px 32px 6px 12px;
  border-radius: 4px;
  outline: none;
  font-size: 14px;
  cursor: pointer;
  appearance: none;
  background-image: url("data:image/svg+xml,%3Csvg width='12' height='12' viewBox='0 0 12 12' fill='none' xmlns='http://www.w3.org/2000/svg'%3E%3Cpath d='M2.14645 4.64645C2.34171 4.45118 2.65829 4.45118 2.85355 4.64645L6 7.79289L9.14645 4.64645C9.34171 4.45118 9.65829 4.45118 9.85355 4.64645C10.0488 4.84171 10.0488 5.15829 9.85355 5.35355L6.35355 8.85355C6.15829 9.04882 5.84171 9.04882 5.64645 8.85355L2.14645 5.35355C1.95118 5.15829 1.95118 4.84171 2.14645 4.64645Z' fill='%23ffffff'/%3E%3C/svg%3E");
  background-repeat: no-repeat;
  background-position: right 10px center;
  min-width: 120px;
}

.fluent-select:hover {
  background-color: var(--fluent-control-fill-secondary, rgba(255, 255, 255, 0.08));
}

.fluent-select option {
  background-color: var(--fluent-bg-solid);
  color: var(--fluent-text-primary);
}

.fluent-input,
.fluent-textarea {
  width: 100%;
  background-color: var(--fluent-control-fill-default, rgba(255, 255, 255, 0.05));
  color: var(--fluent-text-primary);
  border: 1px solid var(--fluent-stroke-default, rgba(255, 255, 255, 0.08));
  padding: 10px 12px;
  border-radius: 8px;
  outline: none;
  font-size: 14px;
  font-family: inherit;
  line-height: 1.5;
  box-sizing: border-box;
}

.fluent-textarea {
  resize: vertical;
  min-height: 84px;
}

.fluent-input:focus,
.fluent-textarea:focus {
  border-color: var(--fluent-accent-default);
  background-color: var(--fluent-bg-solid);
}

.fluent-color-picker {
  appearance: none;
  -webkit-appearance: none;
  border: 1px solid var(--fluent-stroke-default, rgba(255, 255, 255, 0.08));
  width: 32px;
  height: 32px;
  border-radius: 4px;
  padding: 0;
  cursor: pointer;
  background: transparent;
  overflow: hidden;
}

.fluent-color-picker::-webkit-color-swatch-wrapper {
  padding: 0;
}

.fluent-color-picker::-webkit-color-swatch {
  border: none;
  border-radius: 3px;
}

.fluent-btn {
  background-color: var(--fluent-control-fill-default, rgba(255, 255, 255, 0.05));
  color: var(--fluent-text-primary);
  border: 1px solid var(--fluent-stroke-default, rgba(255, 255, 255, 0.08));
  padding: 6px 16px;
  border-radius: 4px;
  cursor: pointer;
  font-size: 14px;
  transition: all 0.2s;
  min-width: 80px;
}

.fluent-btn:hover {
  background: var(--fluent-control-fill-secondary, rgba(255, 255, 255, 0.08));
}

.fluent-btn:active {
  background-color: var(--fluent-control-fill-tertiary, rgba(255, 255, 255, 0.03));
  transform: scale(0.98);
}

.toggle-switch {
  position: relative;
  display: inline-flex;
  width: 46px;
  height: 26px;
  cursor: pointer;
}

.toggle-switch__input {
  position: absolute;
  opacity: 0;
  pointer-events: none;
}

.toggle-switch__slider {
  position: relative;
  width: 100%;
  height: 100%;
  border-radius: 999px;
  background-color: var(--fluent-control-fill-secondary, rgba(255, 255, 255, 0.08));
  border: 1px solid var(--fluent-stroke-default, rgba(255, 255, 255, 0.08));
  transition: all 0.2s ease;
}

.toggle-switch__slider::after {
  content: '';
  position: absolute;
  top: 3px;
  left: 4px;
  width: 18px;
  height: 18px;
  border-radius: 50%;
  background-color: var(--fluent-text-secondary);
  transition: all 0.2s ease;
}

.toggle-switch.active .toggle-switch__slider {
  background-color: var(--fluent-accent-default);
  border-color: var(--fluent-accent-default);
}

.toggle-switch.active .toggle-switch__slider::after {
  left: 22px;
  background-color: #fff;
}

.webrtc-servers-container {
  margin-top: 12px;
  background: var(--fluent-control-fill-default, rgba(255, 255, 255, 0.02));
  border: 1px solid var(--fluent-stroke-default, rgba(255, 255, 255, 0.08));
  border-radius: 8px;
  overflow: hidden;
}

.webrtc-servers-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 16px;
  cursor: pointer;
  user-select: none;
  background: var(--fluent-control-fill-secondary, rgba(255, 255, 255, 0.04));
  transition: all 0.2s ease;
}

.webrtc-servers-header.expanded {
  padding: 12px 16px;
  border-bottom: 1px solid var(--fluent-stroke-default, rgba(255, 255, 255, 0.08));
}

.webrtc-servers-header:hover {
  background: var(--fluent-control-fill-tertiary, rgba(255, 255, 255, 0.06));
}

.webrtc-servers-header__title {
  font-size: 14px;
  font-weight: 600;
  color: var(--fluent-text-primary);
  display: flex;
  align-items: center;
}

.webrtc-servers-header__chevron {
  color: var(--fluent-text-secondary);
  transition: transform 0.3s ease;
  display: block;
}

.webrtc-servers-header__chevron.expanded {
  transform: rotate(180deg);
}

.webrtc-servers-grid-wrapper {
  display: grid;
  grid-template-rows: 0fr;
  transition: grid-template-rows 0.3s ease;
}

.webrtc-servers-grid-wrapper.expanded {
  grid-template-rows: 1fr;
}

.webrtc-servers-list {
  overflow: hidden;
  display: flex;
  flex-direction: column;
  gap: 16px;
  padding: 0 16px;
  transition: padding 0.3s ease;
}

.webrtc-servers-grid-wrapper.expanded .webrtc-servers-list {
  padding: 16px;
}

.webrtc-server-card {
  border-radius: 8px;
  border: 1px solid var(--fluent-stroke-default, rgba(255, 255, 255, 0.08));
  background: var(--fluent-bg-solid);
}

.webrtc-server-card__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 14px;
  border-bottom: 1px solid var(--fluent-stroke-default, rgba(255, 255, 255, 0.08));
}

.webrtc-server-card__title {
  font-size: 13px;
  font-weight: 600;
  color: var(--fluent-text-primary);
}

.webrtc-server-card__remove-btn {
  background: transparent;
  border: none;
  color: #ffcece;
  font-size: 13px;
  cursor: pointer;
  padding: 4px 8px;
  border-radius: 4px;
  transition: background-color 0.2s ease;
}

.webrtc-server-card__remove-btn:hover {
  background: rgba(255, 0, 0, 0.1);
}

.webrtc-server-card__body {
  padding: 14px;
}

.webrtc-server-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
  gap: 12px;
  margin-top: 12px;
}

.webrtc-field {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.webrtc-field__label {
  font-size: 13px;
  color: var(--fluent-text-secondary);
}

.webrtc-single-port-input {
  width: min(320px, 100%);
}

.webrtc-list-actions {
  display: flex;
  gap: 12px;
  margin-top: 4px;
}

.fluent-btn-ghost {
  background: transparent;
  color: var(--fluent-accent-default, #60cdff);
  border: 1px dashed var(--fluent-accent-default, #60cdff);
  padding: 8px 16px;
  border-radius: 6px;
  cursor: pointer;
  font-size: 13px;
  transition: all 0.2s;
  flex: 1;
  text-align: center;
}

.fluent-btn-ghost:hover {
  background: rgba(96, 205, 255, 0.1);
}

.webrtc-actions {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-top: 16px;
}

.fluent-btn-text {
  background: transparent;
  color: var(--fluent-text-secondary);
  border: none;
  padding: 6px 12px;
  border-radius: 4px;
  cursor: pointer;
  font-size: 13px;
  transition: all 0.2s;
}

.fluent-btn-text:hover {
  background: var(--fluent-control-fill-default, rgba(255, 255, 255, 0.05));
  color: var(--fluent-text-primary);
}

.webrtc-status {
  margin: 12px 0 0;
  font-size: 13px;
  color: var(--fluent-text-secondary);
}

.dialog-overlay {
  position: fixed;
  inset: 0;
  background-color: rgba(0, 0, 0, 0.45);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
}

.dialog {
  width: 420px;
  max-width: calc(100vw - 32px);
  background-color: var(--fluent-bg-layer);
  border: 1px solid var(--fluent-stroke-default);
  border-radius: 12px;
  box-shadow: 0 16px 32px rgba(0, 0, 0, 0.35);
}

.dialog-header {
  padding: 18px 20px 0;
}

.dialog-title {
  margin: 0;
  font-size: 18px;
  color: var(--fluent-text-primary);
}

.dialog-content {
  padding: 16px 20px 20px;
}

.dialog-footer-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px;
  padding: 16px 20px 20px;
}

.form-group {
  margin-bottom: 12px;
}

.error-text {
  color: #ff99a4;
  font-size: 13px;
}
</style>
