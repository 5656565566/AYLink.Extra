<template>
  <div
    ref="rootElement"
    class="fluent-dropdown"
    :class="{ 'is-open': isOpen }"
    :style="{ width }">
    <button
      class="fluent-dropdown__trigger"
      type="button"
      :aria-expanded="isOpen"
      @click="toggleMenu"
      @keydown="onTriggerKeydown">
      <span>{{ selectedOption?.label || placeholder }}</span>
      <svg viewBox="0 0 16 16" fill="none" aria-hidden="true">
        <path d="M4.5 6.25L8 9.75L11.5 6.25" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/>
      </svg>
    </button>

    <div v-if="isOpen" class="fluent-dropdown__menu" @click.stop>
      <div v-if="searchable" class="fluent-dropdown__search">
        <input
          ref="searchInput"
          v-model="keyword"
          type="search"
          :placeholder="searchPlaceholder" />
      </div>
      <div class="fluent-dropdown__list">
        <button
          v-for="option in filteredOptions"
          :key="String(option.value)"
          class="fluent-dropdown__option"
          :class="{ selected: option.value === modelValue }"
          type="button"
          :disabled="option.disabled"
          @click="selectOption(option)">
          {{ option.label }}
        </button>
        <div v-if="filteredOptions.length === 0" class="fluent-dropdown__empty">
          {{ emptyText }}
        </div>
      </div>
    </div>
  </div>
</template>

<script lang="ts" src="./FluentDropdown.ts"></script>

<style scoped src="./FluentDropdown.css"></style>
