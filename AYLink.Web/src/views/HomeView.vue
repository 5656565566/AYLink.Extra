<template>
  <div class="page-container">
    <div class="header">
      <div class="title-bar">
        <div class="group-select">
          <span class="label">设备分组</span>
          <select>
            <option>全部设备</option>
          </select>
        </div>
        <div class="actions">
          <button v-if="canManageDevices" class="transparent" @click="showAddDialog = true">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M8 3V13M3 8H13" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>
            添加设备
          </button>
          
          <div class="dropdown-container">
            <button class="transparent" @click.stop="toggleMoreActionsMenu">
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M3.5 8C3.5 8.55228 3.05228 9 2.5 9C1.94772 9 1.5 8.55228 1.5 8C1.5 7.44772 1.94772 7 2.5 7C3.05228 7 3.5 7.44772 3.5 8ZM9 8C9 8.55228 8.55228 9 8 9C7.44772 9 7 8.55228 7 8C7 7.44772 7.44772 7 8 7C8.55228 7 9 7.44772 9 8ZM14.5 8C14.5 8.55228 14.0523 9 13.5 9C12.9477 9 12.5 8.55228 12.5 8C12.5 7.44772 12.9477 7 13.5 7C14.0523 7 14.5 7.44772 14.5 8Z" fill="currentColor"/></svg>
              更多操作
            </button>
            <div v-if="showMoreActionsMenu" class="dropdown-menu">
              <button class="dropdown-item" @click.stop="handleRefreshDevices">
                <svg class="item-icon" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
                  <path d="M13.6498 2.3502C12.193 0.893427 10.2037 0 8 0C3.58172 0 0 3.58172 0 8C0 12.4183 3.58172 16 8 16C11.7346 16 14.8735 13.4475 15.7335 10H13.6393C12.8631 12.3514 10.6309 14 8 14C4.68629 14 2 11.3137 2 8C2 4.68629 4.68629 2 8 2C9.65685 2 11.1569 2.67157 12.2355 3.76446L9 7H16V0L13.6498 2.3502Z" fill="currentColor" stroke-width="0.5"/>
                </svg>
                刷新设备
              </button>
              <button class="dropdown-item" @click.stop="toggleMultiSelectMode">
                <svg class="item-icon" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
                  <path d="M2.5 4H13.5M2.5 8H13.5M2.5 12H13.5M1.5 4H1.51M1.5 8H1.51M1.5 12H1.51" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
                </svg>
                多选模式
              </button>
              <button class="dropdown-item danger" disabled>
                <svg class="item-icon" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
                  <path d="M5.5 3.5V2.5C5.5 1.94772 5.94772 1.5 6.5 1.5H9.5C10.0523 1.5 10.5 1.94772 10.5 2.5V3.5M3 3.5H13M4 3.5V12.5C4 13.3284 4.67157 14 5.5 14H10.5C11.3284 14 12 13.3284 12 12.5V3.5" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"/>
                </svg>
                删除设备
              </button>
              <button class="dropdown-item" disabled>
                <svg class="item-icon" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
                  <path d="M5 3L11 8L5 13V3Z" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round"/>
                  <path d="M12 3V13" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/>
                </svg>
                运行脚本
              </button>
              <button class="dropdown-item" disabled>
                <svg class="item-icon" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
                  <path d="M8 2V5M8 11V14M11 8H14M2 8H5M5.5 5.5L4 4M10.5 10.5L12 12M10.5 5.5L12 4M5.5 10.5L4 12" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/>
                </svg>
                同步控制
              </button>
              <button class="dropdown-item" disabled>
                <svg class="item-icon" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
                  <path d="M8 3V13M3 8H13" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
                </svg>
                添加分组
              </button>
              <button class="dropdown-item danger" disabled>
                <svg class="item-icon" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
                  <path d="M5.5 3.5V2.5C5.5 1.94772 5.94772 1.5 6.5 1.5H9.5C10.0523 1.5 10.5 1.94772 10.5 2.5V3.5M3 3.5H13M4 3.5V12.5C4 13.3284 4.67157 14 5.5 14H10.5C11.3284 14 12 13.3284 12 12.5V3.5" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"/>
                </svg>
                删除分组
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
    
    <div class="content-area">
      <div class="list-header">
        <div class="col-info">设备信息</div>
        <div class="col-conn">连接方式</div>
        <div class="col-actions">操作</div>
      </div>

      <div v-if="loading" class="empty-state">
        <div class="spinner"></div>
        <p>正在加载设备列表...</p>
      </div>
      <div v-else-if="devices.length === 0" class="empty-state">
        <p>没有可用的设备，请点击「添加设备」按钮</p>
      </div>
      <div v-else class="list-body">
        <div v-for="device in devices" :key="device.Id" class="list-row">
          <div class="col-info">
            <div class="device-name">{{ device.Name || device.Serial || '未知设备' }}</div>
            <div class="device-ip">{{ device.IpAddress ? `${device.IpAddress}:${device.Port}` : device.Serial }}</div>
          </div>
          <div class="col-conn">
            <div class="wifi-badge">
              <svg class="wifi-icon" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M12 19C13.1046 19 14 18.1046 14 17C14 15.8954 13.1046 15 12 15C10.8954 15 10 15.8954 10 17C10 18.1046 10.8954 19 12 19Z" fill="currentColor"/>
                <path d="M12 12C9.23858 12 6.73858 13.1193 4.92893 14.9289L6.34315 16.3431C7.79086 14.8954 9.79086 14 12 14C14.2091 14 16.2091 14.8954 17.6569 16.3431L19.0711 14.9289C17.2614 13.1193 14.7614 12 12 12Z" fill="currentColor"/>
                <path d="M12 8C7.58172 8 3.58172 9.79086 0.686295 12.6863L2.10051 14.1005C4.63959 11.5614 8.13959 10 12 10C15.8604 10 19.3604 11.5614 21.8995 14.1005L23.3137 12.6863C20.4183 9.79086 16.4183 8 12 8Z" fill="currentColor"/>
              </svg>
              <span>WiFi</span>
            </div>
          </div>
          <div class="col-actions">
            <button v-if="canControlDevices" class="icon-btn" title="启动投屏" @click="openScreencast(device)">
              <svg viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M4.5 3.5L12.5 8L4.5 12.5V3.5Z" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"/></svg>
            </button>
            <button v-if="canAccessFiles" class="icon-btn" title="文件管理" @click="openFileManager(device)">
              <svg viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M2 3.5C2 2.67157 2.67157 2 3.5 2H6.5L8 4H12.5C13.3284 4 14 4.67157 14 5.5V12.5C14 13.3284 13.3284 14 12.5 14H3.5C2.67157 14 2 13.3284 2 12.5V3.5Z" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"/></svg>
            </button>
            <button v-if="canControlDevices" class="icon-btn" title="应用管理" @click="openAppManager(device)">
              <svg viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M6 4.5H13M6 8H13M6 11.5H13M3 4.5H3.01M3 8H3.01M3 11.5H3.01" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>
            </button>
            <div v-if="canControlDevices || canAccessTerminal || canManageDevices" class="dropdown-container">
              <button class="icon-btn" title="更多操作" @click.stop="toggleMenu(device.Id)">
                <svg viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M3.5 8C3.5 8.55228 3.05228 9 2.5 9C1.94772 9 1.5 8.55228 1.5 8C1.5 7.44772 1.94772 7 2.5 7C3.05228 7 3.5 7.44772 3.5 8ZM9 8C9 8.55228 8.55228 9 8 9C7.44772 9 7 8.55228 7 8C7 7.44772 7.44772 7 8 7C8.55228 7 9 7.44772 9 8ZM14.5 8C14.5 8.55228 14.0523 9 13.5 9C12.9477 9 12.5 8.55228 12.5 8C12.5 7.44772 12.9477 7 13.5 7C14.0523 7 14.5 7.44772 14.5 8Z" fill="currentColor"/></svg>
              </button>
              <div v-if="activeMenuDeviceId === device.Id" class="dropdown-menu">
                <button v-if="canControlDevices" class="dropdown-item" @click.stop="openNewDisplayScreencast(device)">新建显示</button>
                <button v-if="canAccessTerminal" class="dropdown-item" @click.stop="openTerminal(device)">打开终端</button>
                <button v-if="canManageDevices" class="dropdown-item" @click.stop="openDeviceSettings(device)">设备设置</button>
                <button v-if="canControlDevices" class="dropdown-item" @click.stop="showEncoderList(device)">编码器列表</button>
                <div v-if="canManageDevices" class="dropdown-divider"></div>
                <button v-if="canManageDevices" class="dropdown-item danger" @click.stop="deleteDevice(device.Id)">
                  <svg class="item-icon" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
                    <path d="M5.5 3.5V2.5C5.5 1.94772 5.94772 1.5 6.5 1.5H9.5C10.0523 1.5 10.5 1.94772 10.5 2.5V3.5M3 3.5H13M4 3.5V12.5C4 13.3284 4.67157 14 5.5 14H10.5C11.3284 14 12 13.3284 12 12.5V3.5" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"/>
                  </svg>
                  删除设备
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- 编码器列表弹窗 -->
    <div v-if="showEncodersDialog" class="dialog-overlay" @click.self="showEncodersDialog = false">
      <div class="dialog encoders-dialog">
        <div class="dialog-header">
          <h3 class="dialog-title">编码器列表</h3>
        </div>
        <div class="dialog-content">
          <div v-if="fetchingEncoders" class="empty-state-dialog">
            <div class="spinner"></div>
            <p>正在获取编码器...</p>
          </div>
          <div v-else class="encoders-list">
            <div v-if="deviceEncoders.length === 0" class="no-encoders">未找到可用的编码器</div>
            <div v-else class="encoder-item" v-for="(encoder, index) in deviceEncoders" :key="index">{{ encoder }}</div>
          </div>
        </div>
        <div class="dialog-footer-grid" style="grid-template-columns: 1fr;">
          <button class="primary" @click="showEncodersDialog = false">关闭</button>
        </div>
      </div>
    </div>

    <!-- 添加设备弹窗 -->
    <div v-if="showAddDialog" class="dialog-overlay" @click.self="showAddDialog = false">
      <div class="dialog">
        <div class="dialog-header">
          <h3 class="dialog-title">添加设备</h3>
        </div>
        <div class="dialog-content">
          <p class="dialog-subtitle">通过网络调试 (Wi-Fi) 连接设备</p>
          <div class="form-group">
            <input type="text" v-model="newDeviceIp" placeholder="IP 地址 (例如: 127.0.0.1)" autofocus />
          </div>
          <div class="form-group">
            <input type="text" v-model="newDevicePort" placeholder="端口号 (可选, 默认为 5555)" />
          </div>
          <div class="form-group">
            <input type="text" v-model="newDevicePairingPort" placeholder="配对端口 (可选 安卓 无线调试配对 流程)" />
          </div>
          <div class="form-group">
            <input type="text" v-model="newDevicePairingCode" placeholder="配对码 (可选)" @keyup.enter="addDevice" />
          </div>
          <div v-if="addError" class="error-msg">{{ addError }}</div>
        </div>
        <div class="dialog-footer-grid">
          <button class="primary" @click="addDevice" :disabled="adding">
            {{ adding ? '连接中...' : '连接' }}
          </button>
          <button class="transparent" @click="showAddDialog = false">取消</button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, onMounted, onUnmounted } from 'vue';
import { useRouter } from 'vue-router';
import { hasPermission } from '../services/auth';
import { useI18n } from '../composables/useI18n';
import { apiFetch } from '../utils/api';
import { requestWorkspaceOpen } from '../services/workspaceNavigation';
import { useNotification } from '../services/notification';

const router = useRouter();
const notificationService = useNotification();
const { t } = useI18n();
const devices = ref<any[]>([]);
const loading = ref(true);
const showAddDialog = ref(false);
const showMoreActionsMenu = ref(false);
const isMultiSelectMode = ref(false);
const adding = ref(false);
const addError = ref('');

const newDeviceIp = ref('');
const newDevicePort = ref<string>('');
const newDevicePairingPort = ref<string>('');
const newDevicePairingCode = ref('');

const showEncodersDialog = ref(false);
const fetchingEncoders = ref(false);
const deviceEncoders = ref<string[]>([]);
const encodersDeviceName = ref('');

const activeMenuDeviceId = ref<number | null>(null);
const canManageDevices = computed(() => hasPermission('devices.manage'));
const canControlDevices = computed(() => hasPermission('devices.control'));
const canAccessFiles = computed(() => hasPermission('files.access'));
const canAccessTerminal = computed(() => hasPermission('terminal.access'));

const toggleMenu = (deviceId: number) => {
  if (activeMenuDeviceId.value === deviceId) {
    activeMenuDeviceId.value = null;
  } else {
    activeMenuDeviceId.value = deviceId;
  }
};

const toggleMoreActionsMenu = () => {
  showMoreActionsMenu.value = !showMoreActionsMenu.value;
};

const closeMenu = (e: MouseEvent) => {
  const target = e.target as HTMLElement;
  if (!target.closest('.dropdown-container')) {
    activeMenuDeviceId.value = null;
    showMoreActionsMenu.value = false;
  }
};

const fetchDevices = async () => {
  loading.value = true;
  try {
    const res = await apiFetch('/api/devices');
    if (res.ok) {
      devices.value = await res.json();
    }
  } catch (error) {
    console.error('Failed to fetch devices', error);
  } finally {
    loading.value = false;
  }
};

const handleRefreshDevices = async () => {
  showMoreActionsMenu.value = false;
  await fetchDevices();
};

const toggleMultiSelectMode = () => {
  showMoreActionsMenu.value = false;
  isMultiSelectMode.value = !isMultiSelectMode.value;
  
  notificationService.show({
    type: 'info',
    title: t('HomePage.MultiSelectState', '状态切换'),
    message: isMultiSelectMode.value ? t('HomePage.MultiSelectEnabled', '已开启多选模式') : t('HomePage.MultiSelectDisabled', '已退出多选模式')
  });
};

const addDevice = async () => {
  if (!newDeviceIp.value.trim()) {
    addError.value = '请输入 IP 地址';
    return;
  }
  adding.value = true;
  addError.value = '';
  
  const port = newDevicePort.value.trim() || '5555';
  const serial = `${newDeviceIp.value.trim()}:${port}`;
  
  const payload: any = { Serial: serial };
  const pairingPortVal = parseInt(newDevicePairingPort.value.trim(), 10);
  if (!isNaN(pairingPortVal) && newDevicePairingCode.value.trim()) {
    payload.PairingPort = pairingPortVal;
    payload.PairingCode = newDevicePairingCode.value.trim();
  }
  
  try {
    const res = await apiFetch('/api/devices', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    
    const data = await res.json();
    if (!res.ok) {
      addError.value = data.error || '添加失败';
    } else {
      showAddDialog.value = false;
      newDeviceIp.value = '';
      newDevicePort.value = '';
      newDevicePairingPort.value = '';
      newDevicePairingCode.value = '';
      await fetchDevices();
    }
  } catch (error) {
    addError.value = t('Common.NetworkRequestFailed', '网络请求失败');
  } finally {
    adding.value = false;
  }
};

const deleteDevice = async (id: number) => {
  activeMenuDeviceId.value = null;
  if (confirm('确定要移除此设备吗？')) {
    try {
      const res = await apiFetch(`/api/devices/${id}`, { method: 'DELETE' });
      if (res.ok) {
        await fetchDevices();
      }
    } catch (error) {
      console.error('Failed to delete device', error);
    }
  }
};

const ensureDeviceInteractive = (device: any) => {
  if (String(device?.Status ?? '').toLowerCase() === 'online') {
    return true;
  }

  notificationService.show({
    type: 'warning',
    title: t('Devices.OfflineTitle', '设备已断开'),
    message: t('Devices.OfflineMessage', '该设备当前离线，系统正在尝试自动重连，请稍后再试。')
  });
  return false;
};

const openScreencast = (device: any) => {
  activeMenuDeviceId.value = null;
  if (!ensureDeviceInteractive(device)) return;
  requestWorkspaceOpen('screencast', {
    deviceId: String(device.Id),
    deviceName: device.Name || device.Serial || '设备投屏'
  });
  router.push({ name: 'screencast' });
};

const openNewDisplayScreencast = (device: any) => {
  activeMenuDeviceId.value = null;
  if (!ensureDeviceInteractive(device)) return;
  requestWorkspaceOpen('screencast', {
    deviceId: String(device.Id),
    deviceName: device.Name || device.Serial || '设备投屏',
    newDisplay: true
  });
  router.push({ name: 'screencast' });
};

const openTerminal = (device: any) => {
  activeMenuDeviceId.value = null;
  if (!ensureDeviceInteractive(device)) return;
  requestWorkspaceOpen('terminal', {
    deviceId: String(device.Id),
    deviceName: device.Name || device.Serial || '设备终端'
  });
  router.push({ name: 'terminal' });
};

const openFileManager = (device: any) => {
  activeMenuDeviceId.value = null;
  if (!ensureDeviceInteractive(device)) return;
  requestWorkspaceOpen('files', {
    deviceId: String(device.Id),
    deviceName: device.Name || device.Serial || '文件管理'
  });
  router.push({ name: 'files' });
};

const openAppManager = (device: any) => {
  activeMenuDeviceId.value = null;
  if (!ensureDeviceInteractive(device)) return;
  requestWorkspaceOpen('apps', {
    deviceId: String(device.Id),
    deviceName: device.Name || device.Serial || '应用管理'
  });
  router.push({ name: 'apps' });
};

const showEncoderList = async (device: any) => {
  activeMenuDeviceId.value = null;
  fetchingEncoders.value = true;
  showEncodersDialog.value = true;
  encodersDeviceName.value = device.Name || device.Serial || '未知设备';
  deviceEncoders.value = [];
  
  try {
    const res = await apiFetch(`/api/devices/${device.Id}/encoders`);
    if (res.ok) {
      deviceEncoders.value = await res.json();
    }
  } catch (error) {
    console.error('Failed to fetch encoders', error);
  } finally {
    fetchingEncoders.value = false;
  }
};

const openDeviceSettings = (device: any) => {
  activeMenuDeviceId.value = null;
  router.push({ name: 'device-settings', params: { id: String(device.Id) } });
};

onMounted(() => {
  fetchDevices();
  document.addEventListener('click', closeMenu);
});

onUnmounted(() => {
  document.removeEventListener('click', closeMenu);
});
</script>

<style scoped>
.page-container {
  display: flex;
  flex-direction: column;
  height: 100%;
}

.header {
  padding: 16px 24px;
}

.title-bar {
  display: flex;
  align-items: center;
  gap: 24px;
}

.group-select {
  display: flex;
  align-items: center;
  gap: 12px;
}

.label {
  font-weight: 600;
  font-size: 14px;
}

select {
  min-width: 140px;
}

.actions {
  display: flex;
  gap: 8px;
}

.content-area {
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  flex: 1;
  color: var(--fluent-text-secondary);
  font-size: 14px;
}

.spinner {
  width: 24px;
  height: 24px;
  border: 3px solid var(--fluent-control-fill-secondary);
  border-top-color: var(--fluent-accent-default);
  border-radius: 50%;
  animation: spin 1s linear infinite;
  margin-bottom: 16px;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}

/* List Styles */
.list-header {
  display: grid;
  grid-template-columns: 1fr 150px 180px;
  padding: 12px 24px;
  font-weight: 600;
  font-size: 14px;
  color: var(--fluent-text-primary);
  border-bottom: 1px solid var(--fluent-stroke-default);
}

.list-body {
  flex: 1;
  overflow-y: auto;
}

.list-row {
  display: grid;
  grid-template-columns: 1fr 150px 180px;
  padding: 16px 24px;
  align-items: center;
  transition: background-color 0.2s ease;
}

.list-row:hover {
  background-color: var(--fluent-control-fill-secondary);
}

.col-info {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.device-name {
  font-size: 14px;
  font-weight: 600;
  color: var(--fluent-text-primary);
}

.device-ip {
  font-size: 12px;
  color: var(--fluent-text-secondary);
}

.col-conn {
  display: flex;
  align-items: center;
  justify-content: center;
}

.list-header .col-conn {
  text-align: center;
  display: block;
}

.wifi-badge {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 13px;
  color: var(--fluent-text-primary);
}

.wifi-icon {
  width: 16px;
  height: 16px;
  color: var(--fluent-text-primary);
}

.col-actions {
  display: flex;
  gap: 8px;
  justify-content: flex-end;
  position: relative;
}

.list-header .col-actions {
  display: block;
  text-align: right;
}

.icon-btn {
  width: 32px;
  height: 32px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  background: var(--fluent-control-fill-default);
  border: 1px solid var(--fluent-stroke-default);
  border-radius: 4px;
  color: var(--fluent-text-primary);
  padding: 0;
  transition: all 0.2s ease;
}

.icon-btn svg {
  width: 16px;
  height: 16px;
}

.icon-btn:hover {
  background: var(--fluent-control-fill-secondary);
}

.icon-btn:active {
  background: var(--fluent-control-fill-tertiary);
  transform: scale(0.96);
}

/* Dropdown Menu */
.dropdown-container {
  position: relative;
  display: inline-flex;
}

.dropdown-menu {
  position: absolute;
  top: 100%;
  right: 0;
  margin-top: 4px;
  background-color: var(--fluent-bg-layer);
  border: 1px solid var(--fluent-stroke-default);
  border-radius: 8px;
  padding: 8px;
  min-width: 140px;
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.4);
  z-index: 100;
  display: flex;
  flex-direction: column;
}

.actions .dropdown-menu {
  left: 0;
  right: auto;
  min-width: 160px;
}

.dropdown-item {
  display: flex;
  align-items: center;
  justify-content: flex-start;
  gap: 8px;
  width: 100%;
  padding: 10px 12px;
  border: none;
  background: transparent;
  color: var(--fluent-text-primary);
  font-size: 14px;
  text-align: left;
  border-radius: 4px;
  cursor: pointer;
  transition: background-color 0.2s ease, opacity 0.2s ease;
}

.col-actions .dropdown-item {
  justify-content: center;
  text-align: center;
}

.dropdown-item:hover:not(:disabled) {
  background-color: var(--fluent-control-fill-secondary);
}

.dropdown-item:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.dropdown-item.danger {
  color: #ff99a4;
}

.dropdown-item.danger:hover:not(:disabled) {
  background-color: rgba(255, 153, 164, 0.1);
}

.dropdown-divider {
  height: 1px;
  background-color: var(--fluent-stroke-default);
  margin: 4px 0;
}

.item-icon {
  width: 16px;
  height: 16px;
}

/* Dialog */
.dialog-overlay {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background-color: rgba(0, 0, 0, 0.4);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
  animation: fadeIn 0.2s ease;
}

@keyframes fadeIn {
  from { opacity: 0; }
  to { opacity: 1; }
}

.dialog {
  background-color: var(--fluent-bg-layer);
  border: 1px solid var(--fluent-stroke-secondary);
  border-radius: 8px;
  width: 400px;
  max-width: 90vw;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.4);
  animation: slideUp 0.2s cubic-bezier(0.4, 0, 0.2, 1);
  display: flex;
  flex-direction: column;
}

@keyframes slideUp {
  from { opacity: 0; transform: scale(0.95) translateY(10px); }
  to { opacity: 1; transform: scale(1) translateY(0); }
}

.dialog-header {
  padding: 16px 24px;
}

.dialog-title {
  font-size: 20px;
  font-weight: 600;
  margin: 0;
}

.dialog-subtitle {
  font-size: 14px;
  margin-top: 0;
  margin-bottom: 16px;
  color: var(--fluent-text-primary);
}

.dialog-content {
  padding: 0 24px 24px;
}

.form-group {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-bottom: 12px;
}

.form-group label {
  font-size: 14px;
}

.form-group input {
  width: 100%;
}

.error-msg {
  color: #ff99a4;
  font-size: 12px;
  margin-top: 8px;
}

.dialog-footer-grid {
  padding: 16px 24px;
  background-color: var(--fluent-bg-solid);
  border-top: 1px solid var(--fluent-stroke-default);
  border-radius: 0 0 8px 8px;
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 16px;
}

.dialog-footer-grid button {
  width: 100%;
  justify-content: center;
}
</style>
