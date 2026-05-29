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
        <SettingItem
          :title="t('Settings.NewDisplayDpiMode', 'DPI 跟随')"
          :description="t('Settings.NewDisplayDpiModeDescription', '用于新建显示器和应用投屏时的默认像素密度')"
        >
          <select class="fluent-select" :value="newDisplayDpiMode" @change="onNewDisplayDpiModeChange">
            <option value="disabled">{{ t('Settings.NewDisplayDpiModeDisabled', '禁用') }}</option>
            <option value="auto">{{ t('Settings.NewDisplayDpiModeAuto', '自动') }}</option>
            <option value="custom">{{ t('Settings.NewDisplayDpiModeCustom', '自定义') }}</option>
          </select>
        </SettingItem>
        <SettingItem
          v-if="newDisplayDpiMode === 'custom'"
          :title="t('Settings.NewDisplayDpiValue', '自定义 DPI')"
          :description="t('Settings.NewDisplayDpiValueDescription', '推荐 160-480，该值会作为 new_display 的可选 DPI 参数发送给后端')"
        >
          <input
            type="number"
            min="72"
            max="960"
            step="1"
            class="fluent-input"
            :value="newDisplayDpiValue"
            @change="onNewDisplayDpiValueChange"
          />
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
        <SettingItem title="GitHub" description="https://github.com/5656565566/AYLink.Extra">
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
              @change="onUseLocalWebRtcOverrideChange"
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
                @change="onWebRtcHostCandidateOverrideEnabledChange"
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
                @change="onWebRtcSinglePortMuxEnabledChange"
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

<script lang="ts" src="./SettingsView.ts"></script>

<style scoped src="./SettingsView.css"></style>
