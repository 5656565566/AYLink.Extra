<template>
  <div class="setting-section">
    <h3 v-if="title" class="section-title">{{ title }}</h3>
    <div class="section-content">
      <slot></slot>
    </div>
  </div>
</template>

<script setup lang="ts">
defineProps<{
  title?: string;
}>();
</script>

<style scoped>
.setting-section {
  margin-bottom: 32px;
}

.section-title {
  font-size: 16px;
  font-weight: 600;
  margin: 0 0 12px 0;
  color: var(--fluent-text-primary);
}

.section-content {
  display: flex;
  flex-direction: column;
  gap: 2px;
}
</style>
