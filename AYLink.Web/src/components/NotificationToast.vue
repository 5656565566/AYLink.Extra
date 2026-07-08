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
          <div v-if="item.showProgress" class="notification-progress" :class="{ indeterminate: item.isIndeterminate }">
            <div
              class="notification-progress__bar"
              :style="{ width: item.isIndeterminate ? '42%' : `${item.progress || 0}%` }">
            </div>
          </div>
        </div>
        <button
          v-if="item.isCancelable"
          class="notification-action"
          type="button"
          @click="item.onCancel?.()">
          {{ t('Common.Cancel', '取消') }}
        </button>
        <button class="notification-close" @click="remove(item.id)">
          <svg viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M4 4L12 12M12 4L4 12" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
          </svg>
        </button>
      </div>
    </TransitionGroup>
  </div>
</template>

<script lang="ts" src="./NotificationToast.ts"></script>

<style scoped src="./NotificationToast.css"></style>
