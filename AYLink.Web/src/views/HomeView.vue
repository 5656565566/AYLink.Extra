<template>
  <div class="page-container">
    <div class="header">
      <div class="title-bar">
        <div class="group-select">
          <span class="label">{{ t('HomeView.DeviceGroup', '设备分组') }}</span>
          <FluentDropdown
            :model-value="selectedGroupId"
            :options="groupDropdownOptions"
            searchable
            width="180px"
            :search-placeholder="t('HomeView.GroupSearchPlaceholder', '搜索分组名称')"
            :empty-text="availableGroups.length === 0 ? t('Settings.EmptyDeviceGroups', '暂无设备分组') : t('HomeView.NoGroupsMatched', '没有匹配的分组')"
            @open="prepareGroupDropdown"
            @update:model-value="selectGroup(Number($event))" />
        </div>
        <div class="actions">
          <button v-if="canManageDevices" class="transparent" @click="openAddDeviceDialog">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M8 3V13M3 8H13" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>
            {{ t('HomeView.AddDevice', '添加设备') }}
          </button>
          
          <div class="dropdown-container">
            <button class="transparent" @click.stop="toggleMoreActionsMenu">
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M3.5 8C3.5 8.55228 3.05228 9 2.5 9C1.94772 9 1.5 8.55228 1.5 8C1.5 7.44772 1.94772 7 2.5 7C3.05228 7 3.5 7.44772 3.5 8ZM9 8C9 8.55228 8.55228 9 8 9C7.44772 9 7 8.55228 7 8C7 7.44772 7.44772 7 8 7C8.55228 7 9 7.44772 9 8ZM14.5 8C14.5 8.55228 14.0523 9 13.5 9C12.9477 9 12.5 8.55228 12.5 8C12.5 7.44772 12.9477 7 13.5 7C14.0523 7 14.5 7.44772 14.5 8Z" fill="currentColor"/></svg>
              {{ t('HomeView.MoreActions', '更多操作') }}
            </button>
            <div v-if="showMoreActionsMenu" class="dropdown-menu">
              <button class="dropdown-item" @click.stop="handleRefreshDevices">
                <svg class="item-icon" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
                  <path d="M13.6498 2.3502C12.193 0.893427 10.2037 0 8 0C3.58172 0 0 3.58172 0 8C0 12.4183 3.58172 16 8 16C11.7346 16 14.8735 13.4475 15.7335 10H13.6393C12.8631 12.3514 10.6309 14 8 14C4.68629 14 2 11.3137 2 8C2 4.68629 4.68629 2 8 2C9.65685 2 11.1569 2.67157 12.2355 3.76446L9 7H16V0L13.6498 2.3502Z" fill="currentColor" stroke-width="0.5"/>
                </svg>
                {{ t('HomeView.RefreshDevices', '刷新设备') }}
              </button>
              <button class="dropdown-item" @click.stop="toggleDeviceViewMode">
                <svg class="item-icon" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
                  <path d="M2.5 3H13.5M2.5 8H13.5M2.5 13H13.5" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/>
                  <path d="M3 3H6V6H3V3ZM10 3H13V6H10V3ZM3 10H6V13H3V10ZM10 10H13V13H10V10Z" stroke="currentColor" stroke-width="1.1" stroke-linejoin="round"/>
                </svg>
                {{ isPreviewMode ? t('HomeView.ListView', '列表视图') : t('HomeView.PreviewView', '预览视图') }}
              </button>
              <button
                v-if="canManageDevices"
                class="dropdown-item danger"
                :disabled="selectedDeviceCount === 0"
                @click.stop="deleteSelectedDevices"
              >
                <svg class="item-icon" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
                  <path d="M5.5 3.5V2.5C5.5 1.94772 5.94772 1.5 6.5 1.5H9.5C10.0523 1.5 10.5 1.94772 10.5 2.5V3.5M3 3.5H13M4 3.5V12.5C4 13.3284 4.67157 14 5.5 14H10.5C11.3284 14 12 13.3284 12 12.5V3.5" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"/>
                </svg>
                {{ t('HomeView.DeleteSelectedDevices', '删除设备') }}<template v-if="selectedDeviceCount > 0"> ({{ selectedDeviceCount }})</template>
              </button>
              <button class="dropdown-item" disabled>
                <svg class="item-icon" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
                  <path d="M8 2V5M8 11V14M11 8H14M2 8H5M5.5 5.5L4 4M10.5 10.5L12 12M10.5 5.5L12 4M5.5 10.5L4 12" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/>
                </svg>
                {{ t('HomeView.SyncControl', '同步控制') }}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
    
    <div class="content-area">
      <div v-if="!isPreviewMode" class="list-header">
        <div class="col-info">{{ t('HomeView.DeviceInfo', '设备信息') }}</div>
        <div class="col-group">{{ t('HomeView.DeviceGroup', '分组') }}</div>
        <div class="col-conn">{{ t('HomeView.ConnectionType', '连接方式') }}</div>
        <div class="col-actions">{{ t('HomeView.Actions', '操作') }}</div>
      </div>

      <div v-if="loading" class="empty-state">
        <div class="spinner"></div>
        <p>{{ t('HomeView.LoadingDevices', '正在加载设备列表...') }}</p>
      </div>
      <div v-else-if="visibleDevices.length === 0" class="empty-state">
        <p>{{ t('HomeView.NoDevices', '没有可用的设备，请点击「添加设备」按钮') }}</p>
      </div>
      <div v-else-if="!isPreviewMode" class="list-body">
        <div
          v-for="device in visibleDevices"
          :key="device.Id"
          class="list-row"
          :class="{ 'list-row--selected': isDeviceSelected(device.Id) }"
          @click="toggleDeviceSelection(device.Id)"
        >
          <div class="col-info">
            <div class="device-name">{{ device.Name || device.Serial || t('Devices.UnknownDevice', '未知设备') }}</div>
            <div class="device-ip">{{ device.IpAddress ? `${device.IpAddress}:${device.Port}` : device.Serial }}</div>
          </div>
          <div class="col-group">
            <span class="device-group-text">{{ formatDeviceGroups(device) }}</span>
          </div>
          <div class="col-conn">
            <div class="connection-badge">
              <PlugConnected20Regular v-if="getStoredDeviceTransport(device) === 'usb'" class="connection-icon" />
              <Desktop20Regular v-else-if="getStoredDeviceTransport(device) === 'emulator'" class="connection-icon" />
              <Wifi120Regular v-else class="connection-icon" />
              <span v-if="getStoredDeviceTransport(device) === 'usb'">{{ t('HomeView.USB', 'USB') }}</span>
              <span v-else-if="getStoredDeviceTransport(device) === 'emulator'">{{ t('HomeView.Emulator', '模拟器') }}</span>
              <span v-else>{{ t('HomeView.WiFi', 'WiFi') }}</span>
            </div>
          </div>
          <div class="col-actions">
            <button v-if="canControlDevices" class="icon-btn" :title="t('HomeView.StartCast', '启动投屏')" @click.stop="openScreencast(device)">
              <svg viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M4.5 3.5L12.5 8L4.5 12.5V3.5Z" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"/></svg>
            </button>
            <button v-if="canAccessFiles" class="icon-btn" :title="t('FilePage.Title', '文件管理')" @click.stop="openFileManager(device)">
              <svg viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M2 3.5C2 2.67157 2.67157 2 3.5 2H6.5L8 4H12.5C13.3284 4 14 4.67157 14 5.5V12.5C14 13.3284 13.3284 14 12.5 14H3.5C2.67157 14 2 13.3284 2 12.5V3.5Z" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"/></svg>
            </button>
            <button v-if="canControlDevices" class="icon-btn" :title="t('AppPage.Title', '应用管理')" @click.stop="openAppManager(device)">
              <svg viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M6 4.5H13M6 8H13M6 11.5H13M3 4.5H3.01M3 8H3.01M3 11.5H3.01" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>
            </button>
            <div v-if="canControlDevices || canAccessTerminal || canManageDevices" class="dropdown-container">
              <button class="icon-btn" :title="t('HomeView.MoreActions', '更多操作')" @click.stop="toggleMenu(device.Id)">
                <svg viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M3.5 8C3.5 8.55228 3.05228 9 2.5 9C1.94772 9 1.5 8.55228 1.5 8C1.5 7.44772 1.94772 7 2.5 7C3.05228 7 3.5 7.44772 3.5 8ZM9 8C9 8.55228 8.55228 9 8 9C7.44772 9 7 8.55228 7 8C7 7.44772 7.44772 7 8 7C8.55228 7 9 7.44772 9 8ZM14.5 8C14.5 8.55228 14.0523 9 13.5 9C12.9477 9 12.5 8.55228 12.5 8C12.5 7.44772 12.9477 7 13.5 7C14.0523 7 14.5 7.44772 14.5 8Z" fill="currentColor"/></svg>
              </button>
              <div v-if="activeMenuDeviceId === device.Id" class="dropdown-menu">
                <button v-if="canControlDevices" class="dropdown-item" @click.stop="openNewDisplayScreencast(device)">{{ t('HomeView.NewDisplay', '新建显示') }}</button>
                <button v-if="canAccessTerminal" class="dropdown-item" @click.stop="openTerminal(device)">{{ t('HomeView.OpenTerminal', '打开终端') }}</button>
                <button v-if="canManageDevices" class="dropdown-item" @click.stop="openDeviceSettings(device)">{{ t('DeviceSettings.Title', '设备设置') }}</button>
                <button v-if="canManageDevices" class="dropdown-item" @click.stop="openRenameDialog(device)">{{ t('HomeView.RenameDevice', '重命名设备') }}</button>
                <button v-if="canControlDevices" class="dropdown-item" @click.stop="showEncoderList(device)">{{ t('HomeView.EncoderList', '编码器列表') }}</button>
                <div v-if="canManageDevices" class="dropdown-divider"></div>
                <button v-if="canManageDevices" class="dropdown-item danger" @click.stop="deleteDevice(device.Id)">
                  <svg class="item-icon" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
                    <path d="M5.5 3.5V2.5C5.5 1.94772 5.94772 1.5 6.5 1.5H9.5C10.0523 1.5 10.5 1.94772 10.5 2.5V3.5M3 3.5H13M4 3.5V12.5C4 13.3284 4.67157 14 5.5 14H10.5C11.3284 14 12 13.3284 12 12.5V3.5" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"/>
                  </svg>
                  {{ t('HomeView.DeleteDevices', '删除设备') }}
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
      <div v-else class="preview-grid">
        <article v-for="device in visibleDevices" :key="device.Id" class="preview-card">
          <button
            class="preview-screen-button"
            :class="{ 'preview-screen-button--offline': String(device.Status || '').toLowerCase() !== 'online' }"
            :title="t('HomeView.StartCast', '启动投屏')"
            @click="openScreencast(device)"
          >
            <div class="preview-screen">
              <img
                v-if="getDevicePreviewUrl(device.Id)"
                class="preview-image"
                :src="getDevicePreviewUrl(device.Id)"
                :alt="device.Name || device.Serial || t('Devices.UnknownDevice', '未知设备')"
              />
              <div v-else class="preview-placeholder">
                <div v-if="isDevicePreviewLoading(device.Id)" class="spinner preview-spinner"></div>
              </div>
              <div class="preview-play-overlay" aria-hidden="true">
                <div class="preview-play-icon">
                  <svg viewBox="0 0 40 40" fill="none" xmlns="http://www.w3.org/2000/svg">
                    <path d="M14 11V29L29 20L14 11Z" fill="currentColor"/>
                  </svg>
                </div>
              </div>
            </div>
          </button>

          <div class="preview-meta">
            <div class="preview-meta__title">{{ device.Name || device.Serial || t('Devices.UnknownDevice', '未知设备') }}</div>
            <div class="preview-meta__subtitle">{{ device.IpAddress ? `${device.IpAddress}:${device.Port}` : device.Serial }}</div>
            <div class="preview-meta__group">{{ formatDeviceGroups(device) }}</div>
          </div>

          <div class="preview-actions">
            <button v-if="canAccessFiles" class="preview-action-btn" @click.stop="openFileManager(device)">
              {{ t('Common.Files', '文件') }}
            </button>
            <button v-if="canControlDevices" class="preview-action-btn" @click.stop="openAppManager(device)">
              {{ t('Common.Apps', '应用') }}
            </button>
            <div v-if="canControlDevices || canAccessTerminal || canManageDevices" class="dropdown-container preview-more">
              <button class="preview-action-btn" @click.stop="toggleMenu(device.Id)">
                {{ t('HomeView.MoreActions', '更多') }}
              </button>
              <div v-if="activeMenuDeviceId === device.Id" class="dropdown-menu preview-dropdown-menu">
                <button v-if="canControlDevices" class="dropdown-item" @click.stop="openNewDisplayScreencast(device)">{{ t('HomeView.NewDisplay', '新建显示') }}</button>
                <button v-if="canAccessTerminal" class="dropdown-item" @click.stop="openTerminal(device)">{{ t('HomeView.OpenTerminal', '打开终端') }}</button>
                <button v-if="canManageDevices" class="dropdown-item" @click.stop="openDeviceSettings(device)">{{ t('DeviceSettings.Title', '设备设置') }}</button>
                <button v-if="canManageDevices" class="dropdown-item" @click.stop="openRenameDialog(device)">{{ t('HomeView.RenameDevice', '重命名设备') }}</button>
                <button v-if="canControlDevices" class="dropdown-item" @click.stop="showEncoderList(device)">{{ t('HomeView.EncoderList', '编码器列表') }}</button>
                <div v-if="canManageDevices" class="dropdown-divider"></div>
                <button v-if="canManageDevices" class="dropdown-item danger" @click.stop="deleteDevice(device.Id)">
                  {{ t('HomeView.DeleteDevices', '删除设备') }}
                </button>
              </div>
            </div>
          </div>
        </article>
      </div>
    </div>

    <!-- 编码器列表弹窗 -->
    <div v-if="showEncodersDialog" class="dialog-overlay" @click.self="closeEncodersDialog">
      <div class="dialog encoders-dialog">
        <div class="dialog-header">
          <h3 class="dialog-title">{{ t('HomeView.EncoderList', '编码器列表') }} - {{ encodersDeviceName }}</h3>
        </div>
        <div class="dialog-content">
          <div v-if="fetchingEncoders" class="empty-state-dialog">
            <div class="spinner"></div>
            <p>{{ t('HomeView.LoadingEncoders', '正在获取编码器...') }}</p>
          </div>
          <div v-else class="encoders-list">
            <input
              v-if="deviceEncoders.length > 0"
              type="search"
              class="fluent-input encoder-search"
              v-model="encoderSearchKeyword"
              :placeholder="t('HomeView.SearchEncoders', '搜索编码器')"
            />
            <div v-if="deviceEncoders.length === 0" class="no-encoders">{{ t('HomeView.NoEncoders', '未找到可用的编码器') }}</div>
            <div v-else-if="filteredDeviceEncoders.length === 0" class="no-encoders">{{ t('HomeView.NoMatchedEncoders', '没有匹配的编码器') }}</div>
            <div v-else class="encoder-results">
              <button
                type="button"
                class="encoder-item"
                v-for="(encoder, index) in filteredDeviceEncoders"
                :key="`${encoder}-${index}`"
                @click="selectEncoder(encoder)"
              >
                {{ encoder }}
              </button>
            </div>
          </div>
        </div>
        <div class="dialog-footer-grid" style="grid-template-columns: 1fr;">
          <button class="primary" @click="closeEncodersDialog">{{ t('Common.Close', '关闭') }}</button>
        </div>
      </div>
    </div>

    <div v-if="showEncoderTargetDialog" class="dialog-overlay encoder-target-overlay" @click.self="closeEncoderTargetDialog">
      <div class="dialog encoder-target-dialog">
        <div class="dialog-header">
          <h3 class="dialog-title">{{ t('HomeView.ApplyEncoder', '应用编码器') }}</h3>
        </div>
        <div class="dialog-content">
          <div class="encoder-target-name">{{ selectedEncoder }}</div>
        </div>
        <div class="dialog-footer-grid encoder-target-actions">
          <button class="secondary" :disabled="applyingEncoder" @click="closeEncoderTargetDialog">{{ t('Common.Cancel', '取消') }}</button>
          <button class="secondary" :disabled="applyingEncoder" @click="applySelectedEncoder('audio')">{{ t('HomeView.ApplyAudioEncoder', '应用到音频') }}</button>
          <button class="primary" :disabled="applyingEncoder" @click="applySelectedEncoder('video')">{{ t('HomeView.ApplyVideoEncoder', '应用到视频') }}</button>
        </div>
      </div>
    </div>

    <!-- 添加设备弹窗 -->
    <div v-if="showAddDialog" class="dialog-overlay" @click.self="closeAddDeviceDialog">
      <div class="dialog add-device-dialog">
        <div class="dialog-header">
          <h3 class="dialog-title">{{ t('HomeView.AddDevice', '添加设备') }}</h3>
        </div>
        <div class="dialog-content">
          <div class="add-device-mode-switch" role="tablist" :aria-label="t('HomeView.ConnectionType', '连接方式')">
            <button
              type="button"
              role="tab"
              :aria-selected="addDeviceMode === 'wifi'"
              :class="{ active: addDeviceMode === 'wifi' }"
              @click="selectAddDeviceMode('wifi')"
            >
              <Wifi120Regular />
              {{ t('HomeView.NetworkADB', '网络 ADB') }}
            </button>
            <button
              type="button"
              role="tab"
              :aria-selected="addDeviceMode === 'usb'"
              :class="{ active: addDeviceMode === 'usb' }"
              @click="selectAddDeviceMode('usb')"
            >
              <PlugConnected20Regular />
              {{ t('HomeView.LocalUSB', '本地 USB') }}
            </button>
          </div>

          <p v-if="addDeviceMode === 'wifi'" class="dialog-subtitle">
            {{ t('HomeView.AddDeviceSubtitle', '通过网络调试 (Wi-Fi) 连接设备') }}
          </p>
          <p v-else class="dialog-subtitle">
            {{ t('HomeView.AddUSBDeviceSubtitle', '选择一台已连接到 Agent 主机的 USB 调试设备') }}
          </p>

          <div class="form-group">
            <input type="text" v-model="newDeviceName" :placeholder="t('HomeView.DeviceNameOptional', '设备名称 (可选)')" />
          </div>

          <template v-if="addDeviceMode === 'wifi'">
            <div class="form-group">
              <input type="text" v-model="newDeviceIp" :placeholder="t('HomeView.DeviceIpPlaceholder', 'IP 地址 (例如: 127.0.0.1)')" autofocus />
            </div>
            <div class="form-group">
              <input type="text" v-model="newDevicePort" :placeholder="t('HomeView.DevicePortPlaceholder', '端口号 (可选, 默认为 5555)')" />
            </div>
            <div class="form-group">
              <input type="text" v-model="newDevicePairingPort" :placeholder="t('HomeView.PairingPortPlaceholder', '配对端口 (可选 安卓 无线调试配对 流程)')" />
            </div>
            <div class="form-group">
              <input type="text" v-model="newDevicePairingCode" :placeholder="t('HomeView.PairingCodePlaceholder', '配对码 (可选)')" @keyup.enter="addDevice" />
            </div>
          </template>

          <div v-else class="usb-device-picker">
            <div class="usb-device-picker__toolbar">
              <span>{{ t('HomeView.USBDevices', 'USB 设备') }}</span>
              <button
                type="button"
                class="icon-btn"
                :title="t('HomeView.RefreshUSBDevices', '重新扫描 USB 设备')"
                :disabled="loadingUsbDevices"
                @click="fetchUsbDevices"
              >
                <ArrowClockwise20Regular :class="{ spinning: loadingUsbDevices }" />
              </button>
            </div>

            <div v-if="loadingUsbDevices" class="usb-device-state">
              <div class="spinner"></div>
              <span>{{ t('HomeView.ScanningUSBDevices', '正在扫描 USB 设备...') }}</span>
            </div>
            <div v-else-if="usbDiscoveryError" class="usb-device-state usb-device-state--error">
              {{ usbDiscoveryError }}
            </div>
            <div v-else-if="discoveredUsbDevices.length === 0" class="usb-device-state">
              {{ t('HomeView.NoUSBDevices', '未发现本地 USB ADB 设备') }}
            </div>
            <div v-else class="usb-device-list" role="radiogroup" :aria-label="t('HomeView.USBDevices', 'USB 设备')">
              <button
                v-for="device in discoveredUsbDevices"
                :key="device.serial"
                type="button"
                role="radio"
                class="usb-device-option"
                :class="{ selected: selectedUsbSerial === device.serial }"
                :aria-checked="selectedUsbSerial === device.serial"
                :disabled="!isUsbDeviceSelectable(device)"
                @click="selectUsbDevice(device)"
              >
                <span class="usb-device-option__radio" aria-hidden="true"></span>
                <span class="usb-device-option__info">
                  <span class="usb-device-option__name">{{ device.model || t('Devices.UnknownDevice', '未知设备') }}</span>
                  <span class="usb-device-option__serial">{{ device.serial }}</span>
                </span>
                <span
                  class="usb-device-option__status"
                  :class="{ available: isADBDeviceOnline(device) && !isUsbDeviceAdded(device.serial) }"
                >
                  {{ getUsbDeviceStatusText(device) }}
                </span>
              </button>
            </div>
          </div>
          <div v-if="addError" class="error-msg">{{ addError }}</div>
        </div>
        <div class="dialog-footer-grid">
          <button
            class="primary"
            @click="addDevice"
            :disabled="adding || (addDeviceMode === 'usb' && !canAddSelectedUsbDevice)"
          >
            {{ addDeviceActionText }}
          </button>
          <button class="transparent" @click="closeAddDeviceDialog">{{ t('Common.Cancel', '取消') }}</button>
        </div>
      </div>
    </div>

    <div v-if="showRenameDialog" class="dialog-overlay" @click.self="closeRenameDialog">
      <div class="dialog">
        <div class="dialog-header">
          <h3 class="dialog-title">{{ t('HomeView.RenameDevice', '重命名设备') }}</h3>
        </div>
        <div class="dialog-content">
          <p class="dialog-subtitle">{{ t('HomeView.RenameDeviceSubtitle', '为设备设置一个更容易识别的名称') }}</p>
          <div class="form-group">
            <input type="text" v-model="renameDeviceName" :placeholder="t('Devices.NameRequired', '请输入设备名称')" @keyup.enter="submitRenameDevice" />
          </div>
          <div v-if="renameError" class="error-msg">{{ renameError }}</div>
        </div>
        <div class="dialog-footer-grid">
          <button class="primary" @click="submitRenameDevice" :disabled="renaming">
            {{ renaming ? t('Settings.Saving', '保存中...') : t('Common.Save', '保存') }}
          </button>
          <button class="transparent" @click="closeRenameDialog">{{ t('Common.Cancel', '取消') }}</button>
        </div>
      </div>
    </div>
  </div>
</template>

<script lang="ts" src="./HomeView.ts"></script>

<style scoped src="./HomeView.css"></style>
