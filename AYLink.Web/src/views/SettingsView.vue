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
        <SettingItem
          :title="t('Settings.PreviewRefreshInterval', '预览刷新间隔')"
          :description="t('Settings.PreviewRefreshIntervalDescription', '首页预览视图中每台设备的自动刷新间隔，单位为秒')"
        >
          <input
            type="number"
            min="2"
            max="300"
            step="1"
            class="fluent-input"
            :value="previewRefreshInterval"
            @change="onPreviewRefreshIntervalChange"
          />
        </SettingItem>
        <SettingItem
          :title="t('Settings.AdaptivePointerSampling', '自适应采样')"
          :description="t('Settings.AdaptivePointerSamplingDescription', '根据控制通道积压情况自动在 120 / 60 / 30Hz 间调整触控移动采样频率')"
        >
          <label class="toggle-switch" :class="{ active: adaptivePointerSampling }">
            <input
              class="toggle-switch__input"
              type="checkbox"
              :checked="adaptivePointerSampling"
              @change="onAdaptivePointerSamplingChange"
            />
            <span class="toggle-switch__slider"></span>
          </label>
        </SettingItem>
        <SettingItem
          :title="t('Settings.PointerSamplingRate', '自定义采样')"
          :description="t('Settings.PointerSamplingRateDescription', '关闭自适应采样后，手动选择触控移动的固定采样频率')"
        >
          <select class="fluent-select" :value="pointerSamplingRateHz" :disabled="adaptivePointerSampling" @change="onPointerSamplingRateChange">
            <option :value="120">120Hz</option>
            <option :value="60">60Hz</option>
            <option :value="30">30Hz</option>
          </select>
        </SettingItem>
        <SettingItem
          :title="t('Settings.WeakNetworkMode', '弱网模式')"
          :description="t('Settings.WeakNetworkModeDescription', '关闭自适应采样后启用更保守的触控发送策略，优先保证操作不堆积')"
        >
          <label class="toggle-switch" :class="{ active: weakNetworkMode }">
            <input
              class="toggle-switch__input"
              type="checkbox"
              :checked="weakNetworkMode"
              :disabled="adaptivePointerSampling"
              @change="onWeakNetworkModeChange"
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

      <SettingSection :title="t('Settings.InputMapping', '按键映射')">
        <SettingItem
          :title="t('Settings.InputMappingProfiles', '方案管理')"
          :description="t('Settings.InputMappingProfilesDescription', '按键映射到触控的方案管理，同时也是在这里选择方案 / 关闭功能')"
        >
          <button class="fluent-btn" @click="openInputMappingProfiles">{{ t('Settings.Manage', '管理') }}</button>
        </SettingItem>
        <SettingItem
          :title="t('Settings.InputMappingMouseCaptureKey', '鼠标捕获按键')"
          :description="t('Settings.InputMappingMouseCaptureKeyDescription', '用于进入或退出鼠标捕获，默认 Alt')"
        >
          <button type="button" class="key-capture-btn" @click="startInputMappingKeyCapture('mouseCapture')">
            {{ capturingInputMappingKey === 'mouseCapture' ? t('Settings.KeyCaptureWaiting', '按下按键...') : inputMappingMouseCaptureKey }}
          </button>
        </SettingItem>
        <SettingItem
          :title="t('Settings.InputMappingMouseSensitivity', '鼠标灵敏度')"
          :description="t('Settings.InputMappingMouseSensitivityDescription', '用于视角滑动映射的全局倍率')"
        >
          <input
            class="fluent-input key-input"
            type="number"
            min="0.1"
            max="5"
            step="0.1"
            :value="inputMappingMouseSensitivity"
            @change="onInputMappingMouseSensitivityChange"
          />
        </SettingItem>
        <SettingItem
          :title="t('Settings.InputMappingToggleHintsKey', '关闭按键提示')"
          :description="t('Settings.InputMappingToggleHintsKeyDescription', '显示或隐藏投屏上的按键提示，默认 ~')"
        >
          <button type="button" class="key-capture-btn" @click="startInputMappingKeyCapture('toggleHints')">
            {{ capturingInputMappingKey === 'toggleHints' ? t('Settings.KeyCaptureWaiting', '按下按键...') : inputMappingToggleHintsKey }}
          </button>
        </SettingItem>
        <SettingItem
          :title="t('Settings.InputMappingEnabledToggleKey', '关闭 / 开启映射')"
          :description="t('Settings.InputMappingEnabledToggleKeyDescription', '关闭或重新开启当前按键映射，默认 -')"
        >
          <button type="button" class="key-capture-btn" @click="startInputMappingKeyCapture('toggleEnabled')">
            {{ capturingInputMappingKey === 'toggleEnabled' ? t('Settings.KeyCaptureWaiting', '按下按键...') : inputMappingEnabledToggleKey }}
          </button>
        </SettingItem>
      </SettingSection>

      <SettingSection :title="t('Settings.About', '关于')">
        <SettingItem :title="t('Settings.AppVersion', '应用版本')" :description="appVersionDescription">
        </SettingItem>
        <SettingItem
          :title="t('Settings.CheckUpdates', '检查更新')"
          :description="t('Settings.CheckUpdatesDescription', '获取最新版本的应用程序')"
        >
          <button class="fluent-btn" :disabled="isCheckingUpdates" @click="checkForUpdates">
            {{ isCheckingUpdates ? t('Settings.CheckingUpdates', '检查中...') : t('Settings.CheckNow', '立即检查') }}
          </button>
        </SettingItem>
        <SettingItem title="GitHub" description="https://github.com/5656565566/AYLink.Extra">
          <button class="fluent-btn" @click="openGitHubRepository">{{ t('Settings.OpenGitHub', '打开 GitHub 仓库') }}</button>
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
          :title="t('Settings.DefaultFallbackLanguage', '默认回退语言')"
          :description="t('Settings.DefaultFallbackLanguageDescription', '当请求的语言资源不可用时，服务端返回这个默认语言')"
        >
          <select class="fluent-select" v-model="webrtcFallbackLocale">
            <option v-for="language in languages" :key="language.locale" :value="language.locale">
              {{ language.name }}
            </option>
          </select>
        </SettingItem>

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
          :title="t('Settings.LogoutAll', '退出所有会话')"
          :description="t('Settings.LogoutAllDescription', '结束当前账户的所有会话，包括当前浏览器以及其他已登录设备')"
        >
          <button class="fluent-btn" :disabled="loggingOutAll" @click="handleLogoutAll">
            {{ loggingOutAll ? t('Settings.Saving', '保存中...') : t('Settings.LogoutAll', '退出所有会话') }}
          </button>
        </SettingItem>
        <SettingItem
          :title="t('Common.Logout', '退出登录')"
          :description="t('Settings.LogoutDescription', '结束当前浏览器会话并返回登录页')"
        >
          <button class="fluent-btn" @click="handleLogout">{{ t('Common.Logout', '退出登录') }}</button>
        </SettingItem>
      </SettingSection>

      <SettingSection v-if="canManageGroupSection" :title="t('Settings.DeviceGroupManagement', '分组管理')">
        <div class="group-management-toolbar-card">
          <div class="group-management-toolbar">
            <input
              v-model.trim="groupSearchKeyword"
              type="text"
              class="fluent-input group-management-toolbar__search"
              :placeholder="t('Settings.GroupSearchPlaceholder', '搜索分组名称或描述')"
            />
            <div class="group-management-toolbar__actions">
              <button class="fluent-btn" :disabled="groupManagementLoading" @click="refreshGroupManagementList">
                {{ t('Common.Refresh', '刷新') }}
              </button>
              <button class="fluent-btn primary" @click="openCreateGroupDialog">
                {{ t('Settings.CreateDeviceGroup', '新建设备分组') }}
              </button>
            </div>
          </div>
        </div>

        <div v-if="groupManagementError" class="group-management-message group-management-message--error">
          {{ groupManagementError }}
        </div>
        <div v-else-if="groupManagementLoading" class="group-management-message">
          {{ t('Settings.Loading', '加载中...') }}
        </div>
        <div v-else-if="filteredDeviceGroups.length === 0" class="group-management-message">
          {{ t('Settings.EmptyDeviceGroups', '暂无设备分组') }}
        </div>
        <div v-else class="group-management-section">
          <div class="group-management-section__header" :class="{ expanded: isGroupManagementListExpanded }" @click="toggleGroupManagementList">
            <span class="group-management-section__title">
              {{ t('Settings.DeviceGroupList', '分组列表') }}
            </span>
            <span class="group-management-section__summary">
              {{ t('Settings.GroupCountSummary', '共 {0} 个分组', filteredDeviceGroups.length) }}
            </span>
            <svg class="group-management-section__chevron" :class="{ expanded: isGroupManagementListExpanded }" viewBox="0 0 24 24" width="20" height="20">
              <path fill="currentColor" d="M7.41 8.59L12 13.17l4.59-4.58L18 10l-6 6-6-6 1.41-1.41z"/>
            </svg>
          </div>
          <div class="group-management-section__body" :class="{ expanded: isGroupManagementListExpanded }">
            <div class="group-management-list">
              <article v-for="group in filteredDeviceGroups" :key="group.Id" class="group-card">
                <div class="group-card__header">
                  <div class="group-card__title-wrap">
                    <div class="group-card__title-line">
                      <h3 class="group-card__title">{{ group.Name }}</h3>
                      <span v-if="group.IsInternal" class="group-card__badge">
                        {{ t('Settings.InternalGroupBadge', '系统内置') }}
                      </span>
                    </div>
                    <p v-if="group.Description" class="group-card__description">{{ group.Description }}</p>
                    <p v-else class="group-card__description group-card__description--muted">
                      {{ t('Settings.NoDescription', '暂无描述') }}
                    </p>
                    <p v-if="group.IsInternal" class="group-card__hint">
                      {{ t('Settings.InternalAllDevicesHint', '系统全量范围组，不可改名、删除，也不会作为普通业务分组显示在首页。') }}
                    </p>
                  </div>
                  <div class="group-card__actions">
                    <button class="fluent-btn" @click="openEditGroupDialog(group)">
                      {{ group.IsInternal ? t('Settings.ManageAuthorization', '管理授权') : t('Settings.Manage', '管理') }}
                    </button>
                    <button v-if="!group.IsInternal" class="fluent-btn fluent-btn-danger" @click="deleteDeviceGroup(group)">
                      {{ t('Common.Delete', '删除') }}
                    </button>
                  </div>
                </div>
                <div class="group-card__metrics">
                  <div class="group-card__metric">
                    <span class="group-card__metric-label">{{ t('Common.Devices', '设备') }}</span>
                    <span class="group-card__metric-value">{{ group.DeviceCount ?? 0 }}</span>
                  </div>
                  <div v-if="canManageAccounts" class="group-card__metric">
                    <span class="group-card__metric-label">{{ t('Settings.Roles', '角色') }}</span>
                    <span class="group-card__metric-value">{{ group.RoleCount ?? 0 }}</span>
                  </div>
                  <div v-if="canManageAccounts" class="group-card__metric">
                    <span class="group-card__metric-label">{{ t('Settings.Users', '用户') }}</span>
                    <span class="group-card__metric-value">{{ group.UserCount ?? 0 }}</span>
                  </div>
                </div>
              </article>
            </div>
          </div>
        </div>
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
    <div v-if="showGroupDialog" class="dialog-overlay" @click.self="closeGroupDialog">
      <div class="dialog dialog--wide">
        <div class="dialog-header">
          <h3 class="dialog-title">
            {{ groupDialogMode === 'create' ? t('Settings.CreateDeviceGroup', '新建设备分组') : t('Settings.EditDeviceGroup', '编辑设备分组') }}
          </h3>
        </div>
        <div class="dialog-content dialog-content--group">
          <div class="group-dialog-form">
            <div class="form-group">
              <label class="group-dialog-form__label">{{ t('Settings.GroupName', '分组名称') }}</label>
              <input
                v-model.trim="groupForm.name"
                type="text"
                class="fluent-input"
                :disabled="isEditingInternalGroup"
                :placeholder="t('Settings.GroupNamePlaceholder', '请输入设备分组名称')"
              />
            </div>
            <div class="form-group">
              <label class="group-dialog-form__label">{{ t('Settings.Description', '描述') }}</label>
              <textarea
                v-model.trim="groupForm.description"
                class="fluent-textarea"
                rows="3"
                :disabled="isEditingInternalGroup"
                :placeholder="t('Settings.GroupDescriptionPlaceholder', '可以写这个分组的用途或归属范围')"
              ></textarea>
            </div>
            <div v-if="isEditingInternalGroup" class="group-dialog-form__hint">
              {{ t('Settings.InternalGroupLockedHint', '内置分组的名称和描述已锁定，你仍然可以在下面调整角色和用户的授权范围。') }}
            </div>
          </div>

          <div class="group-dialog-grid">
            <section v-if="canManageDevices" class="group-dialog-panel">
              <div class="group-dialog-panel__header">
                <div>
                  <h4 class="group-dialog-panel__title">{{ t('Common.Devices', '设备') }}</h4>
                  <p class="group-dialog-panel__summary">
                    {{ t('Settings.SelectedCount', '已选择 {0} 项', groupForm.deviceIds.length) }}
                  </p>
                </div>
              </div>
              <input
                v-if="!isEditingInternalGroup"
                v-model.trim="deviceSearchKeyword"
                type="text"
                class="fluent-input group-dialog-panel__search"
                :placeholder="t('Settings.DeviceSearchPlaceholder', '搜索设备名称或序列号')"
              />
              <div v-if="isEditingInternalGroup" class="group-dialog-static-note">
                {{ t('Settings.InternalGroupDeviceAutoInclude', '这个系统内置组会自动包含全部设备，不能在这里手动增删设备。') }}
              </div>
              <div v-else class="group-dialog-selection-list">
                <label v-for="device in filteredGroupDevices" :key="device.Id" class="group-dialog-selection-item">
                  <input
                    type="checkbox"
                    :checked="hasGroupSelection('deviceIds', device.Id)"
                    @change="onGroupSelectionChange('deviceIds', device.Id, $event)"
                  />
                  <div class="group-dialog-selection-item__content">
                    <span class="group-dialog-selection-item__title">{{ device.Name || device.Serial || `#${device.Id}` }}</span>
                    <span class="group-dialog-selection-item__meta">{{ device.Serial || device.Status || t('Settings.UnknownDevice', '未命名设备') }}</span>
                  </div>
                </label>
                <div v-if="filteredGroupDevices.length === 0" class="group-dialog-empty">
                  {{ t('Settings.NoMatchingDevices', '没有匹配的设备') }}
                </div>
              </div>
            </section>

            <section v-if="canManageAccounts" class="group-dialog-panel">
              <div class="group-dialog-panel__header">
                <div>
                  <h4 class="group-dialog-panel__title">{{ t('Settings.Roles', '角色') }}</h4>
                  <p class="group-dialog-panel__summary">
                    {{ t('Settings.SelectedCount', '已选择 {0} 项', groupForm.roleIds.length) }}
                  </p>
                </div>
              </div>
              <input
                v-model.trim="roleSearchKeyword"
                type="text"
                class="fluent-input group-dialog-panel__search"
                :placeholder="t('Settings.RoleSearchPlaceholder', '搜索角色名称或描述')"
              />
              <div class="group-dialog-selection-list">
                <label v-for="role in filteredGroupRoles" :key="role.Id" class="group-dialog-selection-item">
                  <input
                    type="checkbox"
                    :checked="hasGroupSelection('roleIds', role.Id)"
                    @change="onGroupSelectionChange('roleIds', role.Id, $event)"
                  />
                  <div class="group-dialog-selection-item__content">
                    <span class="group-dialog-selection-item__title">{{ role.Name }}</span>
                    <span class="group-dialog-selection-item__meta">{{ role.Description || t('Settings.NoDescription', '暂无描述') }}</span>
                  </div>
                </label>
                <div v-if="filteredGroupRoles.length === 0" class="group-dialog-empty">
                  {{ t('Settings.NoMatchingRoles', '没有匹配的角色') }}
                </div>
              </div>
            </section>

            <section v-if="canManageAccounts" class="group-dialog-panel">
              <div class="group-dialog-panel__header">
                <div>
                  <h4 class="group-dialog-panel__title">{{ t('Settings.Users', '用户') }}</h4>
                  <p class="group-dialog-panel__summary">
                    {{ t('Settings.SelectedCount', '已选择 {0} 项', groupForm.userIds.length) }}
                  </p>
                </div>
              </div>
              <input
                v-model.trim="userSearchKeyword"
                type="text"
                class="fluent-input group-dialog-panel__search"
                :placeholder="t('Settings.UserSearchPlaceholder', '搜索用户名')"
              />
              <div class="group-dialog-selection-list">
                <label v-for="user in filteredGroupUsers" :key="user.Id" class="group-dialog-selection-item">
                  <input
                    type="checkbox"
                    :checked="hasGroupSelection('userIds', user.Id)"
                    @change="onGroupSelectionChange('userIds', user.Id, $event)"
                  />
                  <div class="group-dialog-selection-item__content">
                    <span class="group-dialog-selection-item__title">{{ user.Username }}</span>
                    <span class="group-dialog-selection-item__meta">
                      {{ user.Roles.map((role) => role.Name).join(' / ') || t('Settings.NoAssignedRole', '未分配角色') }}
                    </span>
                  </div>
                </label>
                <div v-if="filteredGroupUsers.length === 0" class="group-dialog-empty">
                  {{ t('Settings.NoMatchingUsers', '没有匹配的用户') }}
                </div>
              </div>
            </section>
          </div>

          <div v-if="groupManagementError" class="group-management-message group-management-message--error">
            {{ groupManagementError }}
          </div>
        </div>
        <div class="dialog-footer-grid dialog-footer-grid--group">
          <button class="primary" :disabled="groupManagementSaving" @click="saveGroupDialog">
            {{ groupManagementSaving ? t('Settings.Saving', '保存中...') : t('Settings.Save', '保存') }}
          </button>
          <button class="transparent" :disabled="groupManagementSaving" @click="closeGroupDialog">
            {{ t('Common.Cancel', '取消') }}
          </button>
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
