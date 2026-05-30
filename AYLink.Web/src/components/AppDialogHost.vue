<template>
  <div
    v-if="currentDialog"
    class="app-dialog-backdrop"
    @click.self="handleBackdropClick"
    @keydown="handleKeydown"
    tabindex="-1"
  >
    <div class="app-dialog">
      <div class="app-dialog__header">
        <div class="app-dialog__title">{{ currentDialog.title }}</div>
      </div>
      <div class="app-dialog__content">
        <div class="app-dialog__message">{{ currentDialog.message }}</div>
        <input
          v-if="currentDialog.kind === 'prompt'"
          ref="inputElement"
          v-model="inputValue"
          type="text"
          class="app-dialog__input"
          :placeholder="currentDialog.placeholder || ''"
          @keyup.enter="confirmDialog"
        />
      </div>
      <div class="app-dialog__footer">
        <button
          v-if="currentDialog.kind !== 'alert'"
          class="transparent"
          type="button"
          @click="cancelDialog"
        >
          {{ currentDialog.cancelText || '取消' }}
        </button>
        <button class="primary" type="button" @click="confirmDialog">
          {{ currentDialog.confirmText || '确定' }}
        </button>
      </div>
    </div>
  </div>
</template>

<script lang="ts" src="./AppDialogHost.ts"></script>

<style scoped src="./AppDialogHost.css"></style>
