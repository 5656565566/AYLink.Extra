<template>
  <div class="setting-item">
    <div class="setting-info">
      <div class="setting-title">{{ title }}</div>
      <div v-if="description" class="setting-description">{{ description }}</div>
    </div>
    <div class="setting-action" v-if="$slots.default">
      <slot></slot>
    </div>
  </div>
</template>

<script lang="ts" src="./SettingItem.ts"></script>

<style scoped src="./SettingItem.css"></style>
