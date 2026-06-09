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
          <label v-if="selectedInputMappingRapidTapAction">
            <span>操作方式</span>
            <select class="input-mapping-config-panel__select" :value="selectedInputMappingRapidTapAction.mode" @change="updateSelectedInputMappingRapidTapMode">
              <option value="whileHeld">长按连击</option>
              <option value="burst">按键后连击</option>
            </select>
          </label>
          <label v-if="selectedInputMappingRapidTapAction">
            <span>{{ selectedInputMappingRapidTapAction.mode === 'burst' ? '连击次数' : '每秒连击次数' }}</span>
            <input
              type="number"
              min="1"
              :max="selectedInputMappingRapidTapAction.mode === 'burst' ? 200 : 60"
              :value="selectedInputMappingRapidTapAction.mode === 'burst' ? (selectedInputMappingRapidTapAction.tapCount || 20) : selectedInputMappingRapidTapAction.tapsPerSecond"
              @change="updateSelectedInputMappingRapidTapCount"
            />
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

    <div v-if="isInputMappingProfileDialogVisible" class="input-mapping-profile-dialog-backdrop" @click.self="closeInputMappingProfileDialog">
      <div class="input-mapping-profile-dialog">
        <div class="input-mapping-profile-dialog__header">
          <div class="input-mapping-profile-dialog__title">
            {{ inputMappingProfileDialogMode === 'new' ? t('InputMapping.SaveNewProfile', '保存新增方案') : t('InputMapping.EditProfileInfo', '编辑方案信息') }}
          </div>
          <button type="button" class="input-mapping-profile-dialog__close" @click="closeInputMappingProfileDialog">
            <svg viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M4 4L12 12M12 4L4 12" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>
          </button>
        </div>
        <div class="input-mapping-profile-dialog__body">
          <label>
            <span>{{ t('InputMapping.ProfileName', '名称') }}</span>
            <input v-model="inputMappingProfileForm.name" type="text" maxlength="40" :placeholder="t('InputMapping.ProfileNamePlaceholder', '例如：和平精英三指方案')" />
          </label>
          <label>
            <span>{{ t('InputMapping.Author', '作者') }}</span>
            <input v-model="inputMappingProfileForm.author" type="text" maxlength="32" :placeholder="t('InputMapping.AuthorPlaceholder', '可选')" />
          </label>
          <label>
            <span>{{ t('InputMapping.PackageName', '包名') }}</span>
            <input v-model="inputMappingProfileForm.packageName" type="text" maxlength="120" :placeholder="t('InputMapping.PackageNamePlaceholder', '自动获取当前应用包名，可手动调整')" />
          </label>
          <label>
            <span>{{ t('Common.Description', '说明') }}</span>
            <textarea v-model="inputMappingProfileForm.description" maxlength="160" rows="3" :placeholder="t('InputMapping.DescriptionPlaceholder', '可选')" />
          </label>
        </div>
        <div class="input-mapping-profile-dialog__footer">
          <button type="button" class="input-mapping-profile-dialog__btn" @click="closeInputMappingProfileDialog">{{ t('Common.Cancel', '取消') }}</button>
          <button type="button" class="input-mapping-profile-dialog__btn input-mapping-profile-dialog__btn--primary" @click="submitInputMappingProfileDialog">
            {{ t('Common.Save', '保存') }}
          </button>
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

      <div v-if="isMenuExpanded" class="menu-items">
        <button
          v-for="item in activeFloatingMenuItems"
          :key="item.id"
          type="button"
          class="menu-item"
          :class="{ 'menu-item--danger': item.danger, 'menu-item--disabled': item.disabled }"
          :disabled="item.disabled"
          :title="item.title"
          @click="item.action"
        >
          <component :is="item.iconComponent" />
        </button>
      </div>
    </div>
  </div>
</template>

<script lang="ts" src="./ScreenCastView.ts"></script>

<style scoped src="./ScreenCastView.css"></style>
