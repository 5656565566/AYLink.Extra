<template>
  <div class="setting-section">
    <h3 v-if="title" class="section-title">{{ title }}</h3>
    <div class="section-content">
      <slot></slot>
    </div>
  </div>
</template>

<script lang="ts" src="./SettingSection.ts"></script>

<style scoped src="./SettingSection.css"></style>
