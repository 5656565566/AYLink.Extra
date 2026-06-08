<template>
  <div class="screen-page" ref="shellElement">
    <WorkspaceTabs
      :tabs="castTabItems"
      :active-key="activeTabKey"
      @select="activateTab"
      @close="closeTab">
      <template #icon>
        <svg class="workspace-tab__icon" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M4.5 3.5L12.5 8L4.5 12.5V3.5Z" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"/></svg>
      </template>
    </WorkspaceTabs>

    <div class="stream-stage" ref="videoContainer" @contextmenu="handleInputMappingStageContextMenu">

    <div v-if="!hasCastTabs" class="empty-state">
      <svg class="empty-state__icon" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
        <path d="M7 5.5L18 12L7 18.5V5.5Z" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
      </svg>
      <div class="empty-state__title">{{ t('Screencast.NoDeviceSelected', '未选中设备') }}</div>
      <div class="empty-state__desc">{{ t('Screencast.SelectDevicePrompt', '请在首页选择一个设备来启动投屏') }}</div>
    </div>
      <img
        v-if="shouldShowLastFrameOverlay && lastFrameOverlayUrl"
        ref="lastFrameOverlayElement"
        class="last-frame-overlay"
        :class="{ 'fill-mode': effectiveFillMode }"
        :src="lastFrameOverlayUrl"
        alt=""
        @pointerdown="handlePointerDown"
        @pointerup="handlePointerUp"
        @pointermove="handlePointerMove"
        @pointercancel="handlePointerCancel"
        @lostpointercapture="handlePointerCaptureLost"
        @mousedown="handleMouseDown"
        @contextmenu.prevent
      />
      <video
        ref="videoElement"
        autoplay
        playsinline
        :class="{ 'fill-mode': effectiveFillMode }"
        @pointerdown="handlePointerDown"
        @pointerup="handlePointerUp"
        @pointermove="handlePointerMove"
        @pointercancel="handlePointerCancel"
        @lostpointercapture="handlePointerCaptureLost"
        @mousedown="handleMouseDown"
        @contextmenu.prevent
      ></video>
      <audio ref="audioElement" autoplay playsinline style="display: none"></audio>
      <div
        v-if="isInputMappingEditMode"
        class="input-mapping-edit-scrim"
        aria-hidden="true"
        @pointerdown="blockInputMappingEditPointer"
        @pointermove="blockInputMappingEditPointer"
        @pointerup="blockInputMappingEditPointer"
        @mousedown="blockInputMappingEditPointer"
        @mouseup="blockInputMappingEditPointer"
        @wheel="blockInputMappingEditPointer"
      ></div>
      <div v-if="hasCastTabs && inputMappingStickers.length > 0 && (isInputMappingEditMode || isInputMappingHintsVisible)" class="input-mapping-sticker-layer" aria-hidden="true">
        <div
          v-for="sticker in inputMappingStickers"
          :key="sticker.bindingId"
          class="input-mapping-sticker"
          :class="[
            `input-mapping-sticker--${sticker.shape}`,
            {
              'input-mapping-sticker--editing': isInputMappingEditMode,
              'input-mapping-sticker--selected': selectedInputMappingStickerId === sticker.bindingId
            }
          ]"
          :style="getInputMappingStickerStyle(sticker)"
          @click.stop="selectInputMappingSticker(sticker)"
          @pointerdown="startInputMappingStickerDrag($event, sticker)"
          @pointermove="moveInputMappingStickerDrag"
          @pointerup="finishInputMappingStickerDrag"
          @pointercancel="finishInputMappingStickerDrag"
          @contextmenu="openInputMappingStickerConfig($event, sticker)"
        >
          <template v-if="sticker.shape === 'joystick' && sticker.dpadKeys">
            <div class="input-mapping-sticker__dpad">
              <span></span>
              <span class="input-mapping-sticker__dpad-key">{{ sticker.dpadKeys.up }}</span>
              <span></span>
              <span class="input-mapping-sticker__dpad-key">{{ sticker.dpadKeys.left }}</span>
              <span></span>
              <span class="input-mapping-sticker__dpad-key">{{ sticker.dpadKeys.right }}</span>
              <span></span>
              <span class="input-mapping-sticker__dpad-key">{{ sticker.dpadKeys.down }}</span>
              <span></span>
            </div>
          </template>
          <template v-else>
            <div class="input-mapping-sticker__key">{{ sticker.keyText }}</div>
            <div v-if="sticker.label" class="input-mapping-sticker__label">{{ sticker.label }}</div>
          </template>
        </div>
      </div>
      <div
        v-if="isInputMappingEditMode && inputMappingContextMenu.visible"
        class="input-mapping-palette"
        :style="{ left: `${inputMappingContextMenu.x}px`, top: `${inputMappingContextMenu.y}px` }"
        @pointerdown.stop
        @click.stop
      >
        <button
          v-for="item in inputMappingStickerPaletteItems"
          :key="item.type"
          type="button"
          class="input-mapping-palette__item"
          @click="addInputMappingStickerFromPalette(item.type)"
        >
          <span class="input-mapping-palette__icon">
            <component :is="item.iconComponent" />
          </span>
          <span>{{ item.title }}</span>
        </button>
      </div>
      <div
        v-if="isInputMappingEditMode && selectedInputMappingSticker"
        class="input-mapping-config-panel"
        :style="getInputMappingConfigPanelStyle()"
        @pointerdown.stop
        @click.stop
      >
        <div class="input-mapping-config-panel__body">
          <div class="input-mapping-config-panel__title">{{ selectedInputMappingConfigTitle }}</div>
          <label>
            <span>触发按键</span>
            <button
              type="button"
              class="input-mapping-config-panel__select"
              @click="startInputMappingTriggerCapture"
              @mousedown="captureSelectedInputMappingMouseButton"
              @contextmenu.prevent
            >
              {{ inputMappingCaptureBindingId ? '按下按键...' : (selectedInputMappingSticker.keyText || '捕获按键') }}
            </button>
          </label>
          <label>
            <span>备注</span>
            <input type="text" maxlength="5" :value="selectedInputMappingStickerLabelText" placeholder="建议 5 字以内" @change="updateSelectedInputMappingLabel" />
          </label>
          <label>
            <span>开启此提示</span>
            <button
              type="button"
              class="input-mapping-config-panel__switch"
              :class="{ 'is-off': selectedInputMappingSticker.labelEnabled === false }"
              @click="toggleSelectedInputMappingStickerEnabled"
            ></button>
          </label>
          <button type="button" class="input-mapping-config-panel__delete" @click="deleteSelectedInputMappingBinding">
            删除按键
          </button>
        </div>
      </div>
    </div>

    <div v-if="hasCastTabs && isClipboardWindowVisible" ref="clipboardFloatElement" class="clipboard-float" :style="clipboardWindowStyle">
      <div class="clipboard-float__header" @pointerdown="startClipboardDrag">
        <span class="clipboard-float__title">{{ t('Screencast.RemoteClipboard', '远端剪贴板') }}</span>
        <div class="clipboard-float__actions" @pointerdown.stop>
          <button type="button" class="clipboard-float__btn" @click="readClipboard">{{ t('Screencast.ClipboardRead', '读取') }}</button>
          <button type="button" class="clipboard-float__btn" @click="syncClipboard">{{ t('Screencast.ClipboardSync', '同步') }}</button>
          <button type="button" class="clipboard-float__btn" @click="pasteClipboard">{{ t('Screencast.ClipboardPaste', '粘贴') }}</button>
          <button type="button" class="clipboard-float__btn clipboard-float__btn--close" @click="closeClipboardWindow">
            <svg viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M4 4L12 12M12 4L4 12" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>
          </button>
        </div>
      </div>

      <textarea
        v-model="clipboardText"
        class="clipboard-float__editor"
        :placeholder="t('Screencast.ClipboardPlaceholder', '这里显示远端设备当前剪贴板内容')"
        spellcheck="false"
      ></textarea>

      <div class="clipboard-float__footer">
        <span class="clipboard-float__status">{{ clipboardStatusText }}</span>
        <div class="clipboard-float__indicators">
          <span v-if="isClipboardLoading" class="clipboard-float__hint">{{ t('Screencast.ClipboardReading', '读取中...') }}</span>
          <span v-else-if="isClipboardSaving" class="clipboard-float__hint">{{ t('Screencast.ClipboardSyncing', '同步中...') }}</span>
          <div class="clipboard-float__sync-indicator" :class="{ 'is-active': isClipboardLoading || isClipboardSaving }"></div>
        </div>
      </div>
    </div>

    <div
      v-if="hasCastTabs"
      class="floating-menu"
      :class="[
        `dock-${dockedEdge}`,
        {
          expanded: isMenuExpanded,
          'is-docked': isDocked,
          'is-dragging': isMenuDragActive,
          'layout-horizontal': isHorizontalLayout,
          'layout-vertical': !isHorizontalLayout
        }
      ]"
      :style="menuStyle"
      @pointerenter="handleMenuPointerEnter"
      @pointerleave="handleMenuPointerLeave"
    >
      <button type="button" class="menu-toggle" @pointerdown.stop="startMenuDrag" @click.stop="toggleMenu">
        <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
          <path d="M5 7H19M5 12H19M5 17H19" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" />
        </svg>
      </button>

      <div class="status-indicator">
        <div class="dot" :class="statusDotClass"></div>
      </div>

      <div v-if="isMenuExpanded && isInputMappingEditMode" class="menu-items input-mapping-edit-menu-items">
        <button type="button" class="menu-item" :title="t('InputMapping.SaveProfile', '保存方案')" @click="saveInputMappingProfileFromEditMenu">
          <svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M5 5.75C5 4.78 5.78 4 6.75 4H15.25L19 7.75V18.25C19 19.22 18.22 20 17.25 20H6.75C5.78 20 5 19.22 5 18.25V5.75Z" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/><path d="M8 4V9H15V4M8 17V13H16V17" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/></svg>
        </button>
        <button type="button" class="menu-item" :title="t('InputMapping.ExitEdit', '退出编辑')" @click="exitInputMappingEditMode">
          <svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M6 6L18 18M18 6L6 18" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>
        </button>
        <button type="button" class="menu-item" :title="t('InputMapping.BackToProfiles', '返回管理')" @click="backToInputMappingProfiles">
          <svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M4 7H20M4 12H20M4 17H14" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/><path d="M15 15L18 18L21 15" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg>
        </button>
      </div>

      <div v-else-if="isMenuExpanded" class="menu-items">
        <button type="button" class="menu-item" :title="t('Screencast.Back', '返回')" @click="sendAndroidCommand('back')">
          <ChevronLeft20Regular />
        </button>
        <button type="button" class="menu-item" :title="t('Screencast.Home', '主页')" @click="sendAndroidCommand('home')">
          <Home20Regular />
        </button>
        <button type="button" class="menu-item" :title="t('Screencast.Menu', '菜单')" @click="sendAndroidCommand('menu')">
          <List20Regular />
        </button>
        <button type="button" class="menu-item" :title="t('Screencast.RecentApps', '最近任务')" @click="sendAndroidCommand('recent')">
          <AppRecent20Regular />
        </button>
        <button type="button" class="menu-item" :title="t('Screencast.Power', '电源')" @click="sendAndroidCommand('power')">
          <Power20Regular />
        </button>
        <button type="button" class="menu-item" :title="effectiveFillMode ? t('Screencast.FitDisplay', '适应显示') : t('Screencast.FillDisplay', '拉伸填充')" @click="toggleFillMode">
          <ArrowExpand24Regular />
        </button>
        <button type="button" class="menu-item" :title="t('Screencast.Fullscreen', '全屏')" @click="toggleFullscreen">
          <FullScreenMaximize20Regular />
        </button>
        <button type="button" class="menu-item" :title="t('Screencast.RemoteClipboard', '远端剪贴板')" @click="toggleClipboardWindow">
          <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
            <path d="M9 4.75C9 3.78 9.78 3 10.75 3H13.25C14.22 3 15 3.78 15 4.75V5H16.25C17.22 5 18 5.78 18 6.75V18.25C18 19.22 17.22 20 16.25 20H7.75C6.78 20 6 19.22 6 18.25V6.75C6 5.78 6.78 5 7.75 5H9V4.75Z" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>
            <path d="M9 7H15" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>
          </svg>
        </button>
        <button type="button" class="menu-item" :title="t('Screencast.VolumeUp', '音量加')" @click="sendAndroidCommand('volumeup')">
          <Speaker220Regular />
        </button>
        <button type="button" class="menu-item" :title="t('Screencast.VolumeDown', '音量减')" @click="sendAndroidCommand('volumedown')">
          <Speaker020Regular />
        </button>
        <button type="button" class="menu-item" :title="t('Screencast.Mute', '静音')" @click="sendAndroidCommand('mute')">
          <SpeakerMute20Regular />
        </button>
        <button type="button" class="menu-item" :title="t('Screencast.ScreenOn', '亮屏')" @click="sendAndroidCommand('screenon')">
          <Phone20Regular />
        </button>
        <button type="button" class="menu-item menu-item--danger" :title="t('Screencast.ScreenOff', '熄屏')" @click="sendAndroidCommand('screenoff')">
          <Phone20Regular />
        </button>
      </div>
    </div>
  </div>
</template>

<script lang="ts" src="./ScreenCastView.ts"></script>

<style scoped src="./ScreenCastView.css"></style>
