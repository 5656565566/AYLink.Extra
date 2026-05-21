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

<script setup lang="ts">
defineProps<{
  title: string;
  description?: string;
}>();
</script>

<style scoped>
.setting-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 16px 20px;
  background-color: var(--fluent-control-fill-default, rgba(255, 255, 255, 0.03));
  border: 1px solid var(--fluent-stroke-default, rgba(255, 255, 255, 0.05));
  border-radius: 4px;
  transition: background-color 0.2s;
}

.setting-item:hover {
  background-color: var(--fluent-control-fill-secondary, rgba(255, 255, 255, 0.05));
}

.setting-info {
  display: flex;
  flex-direction: column;
  gap: 4px;
  flex: 1;
}

.setting-title {
  font-size: 14px;
  font-weight: 500;
  color: var(--fluent-text-primary);
}

.setting-description {
  font-size: 12px;
  color: var(--fluent-text-secondary);
  line-height: 1.4;
}

.setting-action {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-left: 16px;
}
</style>
