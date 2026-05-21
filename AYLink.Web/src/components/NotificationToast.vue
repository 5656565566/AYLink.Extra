<template>
  <div class="notification-container">
    <TransitionGroup name="notification-fade">
      <div 
        v-for="item in notifications" 
        :key="item.id" 
        class="notification-toast"
        :class="`notification-${item.type}`"
      >
        <div class="notification-icon">
          <svg v-if="item.type === 'info'" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
            <circle cx="8" cy="8" r="7" stroke="currentColor" stroke-width="1.5"/>
            <path d="M8 11V7" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
            <circle cx="8" cy="4.5" r="1" fill="currentColor"/>
          </svg>
          <svg v-else-if="item.type === 'success'" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
            <circle cx="8" cy="8" r="7" stroke="currentColor" stroke-width="1.5"/>
            <path d="M5 8.5L7 10.5L11 5.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
          </svg>
          <svg v-else-if="item.type === 'warning'" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M8 2L14 13H2L8 2Z" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/>
            <path d="M8 10V6" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
            <circle cx="8" cy="11.5" r="1" fill="currentColor"/>
          </svg>
          <svg v-else-if="item.type === 'error'" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
            <circle cx="8" cy="8" r="7" stroke="currentColor" stroke-width="1.5"/>
            <path d="M5.5 5.5L10.5 10.5M10.5 5.5L5.5 10.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
          </svg>
        </div>
        <div class="notification-content">
          <div v-if="item.title" class="notification-title">{{ item.title }}</div>
          <div class="notification-message">{{ item.message }}</div>
        </div>
        <button class="notification-close" @click="remove(item.id)">
          <svg viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M4 4L12 12M12 4L4 12" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
          </svg>
        </button>
      </div>
    </TransitionGroup>
  </div>
</template>

<script setup lang="ts">
import { useNotification } from '../services/notification';

const { notifications, remove } = useNotification();
</script>

<style scoped>
.notification-container {
  position: fixed;
  bottom: 24px;
  right: 24px;
  display: flex;
  flex-direction: column;
  gap: 12px;
  z-index: 9999;
  pointer-events: none;
}

.notification-toast {
  pointer-events: auto;
  display: flex;
  align-items: flex-start;
  gap: 12px;
  background: var(--fluent-bg-layer, #202020);
  border: 1px solid var(--fluent-stroke-default, rgba(255, 255, 255, 0.08));
  border-radius: 8px;
  padding: 12px 16px;
  min-width: 300px;
  max-width: 400px;
  box-shadow: 0 8px 16px rgba(0, 0, 0, 0.4);
}

.notification-info .notification-icon {
  color: #60cdff;
}

.notification-success .notification-icon {
  color: #6ccb5f;
}

.notification-warning .notification-icon {
  color: #fce100;
}

.notification-error .notification-icon {
  color: #ff99a4;
}

.notification-icon {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  padding-top: 2px;
}

.notification-icon svg {
  width: 16px;
  height: 16px;
}

.notification-content {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.notification-title {
  font-weight: 600;
  font-size: 14px;
  color: var(--fluent-text-primary, #ffffff);
}

.notification-message {
  font-size: 13px;
  color: var(--fluent-text-secondary, #cccccc);
  word-break: break-word;
}

.notification-close {
  flex-shrink: 0;
  background: transparent;
  border: none;
  padding: 4px;
  margin: -4px -8px -4px 0;
  color: var(--fluent-text-secondary, #cccccc);
  cursor: pointer;
  border-radius: 4px;
  transition: all 0.2s ease;
  display: flex;
  align-items: center;
  justify-content: center;
}

.notification-close svg {
  width: 14px;
  height: 14px;
}

.notification-close:hover {
  background: var(--fluent-control-fill-secondary, rgba(255, 255, 255, 0.08));
  color: var(--fluent-text-primary, #ffffff);
}

/* Transitions */
.notification-fade-enter-active,
.notification-fade-leave-active {
  transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
}

.notification-fade-enter-from {
  opacity: 0;
  transform: translateX(100%) scale(0.95);
}

.notification-fade-leave-to {
  opacity: 0;
  transform: scale(0.95);
}

.notification-fade-move {
  transition: transform 0.3s cubic-bezier(0.4, 0, 0.2, 1);
}
</style>
