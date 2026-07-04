<template>
  <div ref="stageElement" class="stream-stage" @contextmenu="emitContextMenu">
    <img
      v-if="showLastFrameOverlay && lastFrameOverlayUrl"
      ref="lastFrameOverlayElement"
      class="last-frame-overlay"
      :class="{ 'fill-mode': fillMode }"
      :src="lastFrameOverlayUrl"
      alt=""
      @pointerdown="emitPointerDown"
      @pointerup="emitPointerUp"
      @pointermove="emitPointerMove"
      @pointercancel="emitPointerCancel"
      @lostpointercapture="emitPointerCaptureLost"
      @mousedown="emitMouseDown"
      @contextmenu.prevent
    />
    <video
      ref="videoElement"
      autoplay
      playsinline
      :class="{ 'fill-mode': fillMode }"
      @pointerdown="emitPointerDown"
      @pointerup="emitPointerUp"
      @pointermove="emitPointerMove"
      @pointercancel="emitPointerCancel"
      @lostpointercapture="emitPointerCaptureLost"
      @mousedown="emitMouseDown"
      @contextmenu.prevent
    ></video>
    <audio ref="audioElement" autoplay playsinline style="display: none"></audio>
    <slot></slot>
  </div>
</template>

<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';

interface ScreencastStageRefs {
  stageElement: HTMLDivElement | null;
  videoElement: HTMLVideoElement | null;
  audioElement: HTMLAudioElement | null;
  lastFrameOverlayElement: HTMLImageElement | null;
}

const props = defineProps<{
  fillMode: boolean;
  showLastFrameOverlay: boolean;
  lastFrameOverlayUrl: string | null;
}>();

const emit = defineEmits<{
  refsChange: [refs: ScreencastStageRefs];
  pointerdown: [event: PointerEvent];
  pointerup: [event: PointerEvent];
  pointermove: [event: PointerEvent];
  pointercancel: [event: PointerEvent];
  lostpointercapture: [event: PointerEvent];
  mousedown: [event: MouseEvent];
  contextmenu: [event: MouseEvent];
}>();

const stageElement = ref<HTMLDivElement | null>(null);
const videoElement = ref<HTMLVideoElement | null>(null);
const audioElement = ref<HTMLAudioElement | null>(null);
const lastFrameOverlayElement = ref<HTMLImageElement | null>(null);

const emitRefsChange = () => {
  emit('refsChange', {
    stageElement: stageElement.value,
    videoElement: videoElement.value,
    audioElement: audioElement.value,
    lastFrameOverlayElement: lastFrameOverlayElement.value
  });
};

const scheduleRefsChange = () => {
  void nextTick(emitRefsChange);
};

const emitPointerDown = (event: PointerEvent) => emit('pointerdown', event);
const emitPointerUp = (event: PointerEvent) => emit('pointerup', event);
const emitPointerMove = (event: PointerEvent) => emit('pointermove', event);
const emitPointerCancel = (event: PointerEvent) => emit('pointercancel', event);
const emitPointerCaptureLost = (event: PointerEvent) => emit('lostpointercapture', event);
const emitMouseDown = (event: MouseEvent) => emit('mousedown', event);
const emitContextMenu = (event: MouseEvent) => emit('contextmenu', event);

onMounted(emitRefsChange);
onBeforeUnmount(() => {
  emit('refsChange', {
    stageElement: null,
    videoElement: null,
    audioElement: null,
    lastFrameOverlayElement: null
  });
});

watch(() => [props.showLastFrameOverlay, props.lastFrameOverlayUrl], scheduleRefsChange);
</script>

<style scoped>
.stream-stage {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 100%;
  flex: 1;
  min-height: 0;
  padding: 0;
  background: var(--fluent-bg-layer);
  touch-action: none;
  position: relative;
  overflow: hidden;
}

.last-frame-overlay {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  object-fit: contain;
  pointer-events: none;
  user-select: none;
  z-index: 2;
}

video {
  position: relative;
  z-index: 1;
  width: 100%;
  max-width: 100%;
  height: 100%;
  max-height: 100%;
  object-fit: contain;
  background: transparent;
  border-radius: 0;
  touch-action: none;
  user-select: none;
  display: block;
}

video.fill-mode {
  width: 100%;
  max-width: 100%;
  object-fit: fill;
}

.last-frame-overlay.fill-mode {
  object-fit: fill;
}
</style>
