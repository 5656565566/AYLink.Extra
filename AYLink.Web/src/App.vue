<script setup lang="ts">
import { ref, computed } from 'vue';
import { useRoute } from 'vue-router';
import { useI18n } from './composables/useI18n';
import AppDialogHost from './components/AppDialogHost.vue';
import NotificationToast from './components/NotificationToast.vue';
import { hasPermission, useAuth } from './services/auth';
import { backgroundEnabled, currentBackgroundImage } from './services/background';

const route = useRoute();
const isCollapsed = ref(false);
const { t } = useI18n();
const auth = useAuth();

const isStandalonePage = computed(() => route.name === 'login');
const canViewHome = computed(() => hasPermission('devices.view'));
const canViewFiles = computed(() => hasPermission('files.access'));
const canUseScreencast = computed(() => hasPermission('devices.control'));
const canUseApps = computed(() => hasPermission('devices.control'));
const canUseTerminal = computed(() => hasPermission('terminal.access'));
const canViewSettings = computed(() => auth.isAuthenticated.value);

const toggleSidebar = () => {
  isCollapsed.value = !isCollapsed.value;
};
</script>

<template>
  <div id="app-bg" :class="{ 'is-active': backgroundEnabled && currentBackgroundImage }" :style="backgroundEnabled && currentBackgroundImage ? { backgroundImage: `url(${currentBackgroundImage})` } : {}"></div>
  <div class="layout" v-if="!isStandalonePage">
    <!-- 左侧导航栏 -->
    <nav class="sidebar" :class="{ 'collapsed': isCollapsed }">
      <div class="sidebar-header">
        <button class="transparent icon-btn hamburger-btn" @click="toggleSidebar">
          <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M3 6H21M3 12H21M3 18H21" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
          </svg>
        </button>
      </div>
      
      <div class="nav-items">
        <router-link v-if="canViewHome" to="/" class="nav-item" active-class="active">
          <div class="nav-indicator"></div>
          <svg class="nav-icon" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M8 2.5L3 6.5V13.5H6V9.5H10V13.5H13V6.5L8 2.5Z" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"/>
          </svg>
          <span class="nav-label">{{ t('Nav.Home', '首页') }}</span>
        </router-link>
        
        <router-link v-if="canViewFiles" to="/files" class="nav-item" active-class="active">
          <div class="nav-indicator"></div>
          <svg class="nav-icon" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M1.5 3C1.5 2.17157 2.17157 1.5 3 1.5H5.80155C6.19266 1.5 6.5685 1.65215 6.84928 1.9242L8.25667 3.28781C8.35026 3.3785 8.47554 3.42928 8.60533 3.42928H13C13.8284 3.42928 14.5 4.10085 14.5 4.92928V12C14.5 12.8284 13.8284 13.5 13 13.5H3C2.17157 13.5 1.5 12.8284 1.5 12V3ZM3 2.5C2.72386 2.5 2.5 2.72386 2.5 3V12C2.5 12.2761 2.72386 12.5 3 12.5H13C13.2761 12.5 13.5 12.2761 13.5 12V4.92928C13.5 4.65314 13.2761 4.42928 13 4.42928H8.39467C8.13506 4.42928 7.8845 4.32773 7.69733 4.14652L6.15072 2.64966C6.05713 2.55896 5.93185 2.50818 5.80206 2.50818H3Z" fill="currentColor" stroke="currentColor" stroke-width="0.5"/>
          </svg>
          <span class="nav-label">{{ t('Nav.Files', '文件管理') }}</span>
        </router-link>

        <router-link v-if="canUseScreencast" to="/screencast" class="nav-item" active-class="active">
          <div class="nav-indicator"></div>
          <svg class="nav-icon" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M4.5 3.5L12.5 8L4.5 12.5V3.5Z" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"/>
          </svg>
          <span class="nav-label">{{ t('Nav.Screencast', '投屏') }}</span>
        </router-link>

        <router-link v-if="canUseApps" to="/apps" class="nav-item" active-class="active">
          <div class="nav-indicator"></div>
          <svg class="nav-icon" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M6 4.5H13M6 8H13M6 11.5H13M3 4.5H3.01M3 8H3.01M3 11.5H3.01" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
          </svg>
          <span class="nav-label">{{ t('Nav.Apps', '应用管理') }}</span>
        </router-link>

        <router-link v-if="canUseTerminal" to="/terminal" class="nav-item" active-class="active">
          <div class="nav-indicator"></div>
          <svg class="nav-icon" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M5.5 3.5C4 3.5 3.5 4.5 3.5 6V7C3.5 7.5 3 8 2.5 8C3 8 3.5 8.5 3.5 9V10C3.5 11.5 4 12.5 5.5 12.5M10.5 3.5C12 3.5 12.5 4.5 12.5 6V7C12.5 7.5 13 8 13.5 8C13 8 12.5 8.5 12.5 9V10C12.5 11.5 12 12.5 10.5 12.5" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"/>
          </svg>
          <span class="nav-label">{{ t('Nav.Terminal', '终端') }}</span>
        </router-link>
      </div>

      <div class="sidebar-footer">
        <router-link v-if="canViewSettings" to="/settings" class="nav-item" active-class="active">
          <div class="nav-indicator"></div>
          <svg class="nav-icon" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>
            <circle cx="12" cy="12" r="3" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>
          </svg>
          <span class="nav-label">{{ t('Nav.Settings', '设置') }}</span>
        </router-link>
      </div>
    </nav>

    <!-- 右侧内容区 -->
    <main class="content">
      <router-view v-slot="{ Component }">
        <transition name="fade-slide" mode="out-in">
          <keep-alive>
            <component :is="Component" />
          </keep-alive>
        </transition>
      </router-view>
    </main>
    
    <NotificationToast />
    <AppDialogHost />
  </div>
  <div v-else class="full-screen-layout">
    <router-view />
    <NotificationToast />
    <AppDialogHost />
  </div>
</template>

<style scoped>
.layout, .full-screen-layout {
  display: flex;
  width: 100vw;
  height: 100vh;
  background-color: var(--fluent-bg-base);
  transition: background-color 0.3s ease;
}

#app-bg {
  position: fixed;
  top: 0;
  left: 0;
  width: 100vw;
  height: 100vh;
  z-index: -1;
  background-size: cover;
  background-position: center;
  background-repeat: no-repeat;
  opacity: 0;
  transition: opacity 0.5s ease;
  pointer-events: none;
}

#app-bg.is-active {
  opacity: 1;
}

.sidebar {
  width: 260px;
  display: flex;
  flex-direction: column;
  padding: 12px 8px;
  background-color: transparent;
  border-right: 0;
  transition: width 0.3s cubic-bezier(0.4, 0, 0.2, 1);
  flex-shrink: 0;
  overflow: hidden;
  white-space: nowrap;
}

.sidebar.collapsed {
  width: 56px;
}

.sidebar.collapsed .nav-item {
  padding: 0;
}

.sidebar-header {
  height: 40px;
  display: flex;
  align-items: center;
  margin-bottom: 16px;
  overflow: hidden;
}

.hamburger-btn {
  width: 40px;
  height: 40px;
  padding: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}

.hamburger-btn svg {
  width: 20px;
  height: 20px;
}

.nav-items {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.nav-item {
  display: flex;
  align-items: center;
  justify-content: flex-start;
  padding: 0 8px 0 44px;
  height: 40px;
  border-radius: 4px;
  color: var(--fluent-text-primary);
  text-decoration: none;
  transition: all 0.1s ease;
  cursor: pointer;
  position: relative;
  overflow: hidden;
  white-space: nowrap;
  text-align: left;
}

.nav-item:hover {
  background-color: var(--fluent-control-fill-secondary);
}

.nav-item:active {
  background-color: var(--fluent-control-fill-tertiary);
  color: var(--fluent-text-secondary);
  transform: scale(0.98);
}

.nav-item.active {
  background-color: var(--fluent-control-fill-default);
}

.nav-indicator {
  position: absolute;
  left: 3px;
  top: 50%;
  transform: translateY(-50%) scaleY(0);
  width: 3px;
  height: 16px;
  border-radius: 4px;
  background-color: var(--fluent-accent-default);
  transition: transform 0.2s cubic-bezier(0.4, 0, 0.2, 1);
}

.nav-item.active .nav-indicator {
  transform: translateY(-50%) scaleY(1);
}

.nav-icon {
  width: 18px;
  height: 18px;
  margin-right: 0;
  flex-shrink: 0;
  position: absolute;
  left: 20px;
  top: 50%;
  transform: translate(-50%, -50%);
}

.nav-label {
  display: block;
  position: absolute;
  left: 44px;
  right: 8px;
  top: 50%;
  transform: translateY(-50%);
  opacity: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  pointer-events: none;
  transition: opacity 0.2s cubic-bezier(0.4, 0, 0.2, 1);
}

.sidebar.collapsed .nav-label {
  opacity: 0;
}

.sidebar-footer {
  margin-top: auto;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.content {
  flex: 1;
  background-color: var(--fluent-bg-layer);
  border-top-left-radius: 8px;
  margin-top: 8px;
  overflow: hidden;
  position: relative;
  border: 1px solid var(--fluent-stroke-default);
  border-bottom: none;
  border-right: none;
  display: flex;
  flex-direction: column;
  transition: background-color 0.3s ease;
}
</style>
