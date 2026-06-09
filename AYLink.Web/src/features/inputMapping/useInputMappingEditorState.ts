import { computed, ref, type Ref } from 'vue';
import { buildInputMappingStickers } from './inputMappingStickers';
import type {
  InputMappingBinding,
  InputMappingProfile,
  NormalizedPoint
} from './inputMappingSchema';

export type InputMappingProfileDialogMode = 'new' | 'info';

export interface InputMappingPaletteIconComponents {
  click: unknown;
  rapidTap: unknown;
  swipe: unknown;
  joystick: unknown;
  aim: unknown;
  look: unknown;
  fire: unknown;
}

export interface InputMappingStickerPaletteItem {
  type: string;
  title: string;
  iconComponent: unknown;
}

export function useInputMappingEditorState(options: {
  activeProfile: Ref<InputMappingProfile | null>;
  isEditMode: Ref<boolean>;
  isNewDraft: () => boolean;
  icons: InputMappingPaletteIconComponents;
}) {
  const selectedInputMappingStickerId = ref('');

  const isInputMappingProfileDialogVisible = ref(false);

  const inputMappingProfileDialogMode = ref<InputMappingProfileDialogMode>('info');

  const inputMappingProfileForm = ref({
    name: '',
    author: '',
    description: '',
    packageName: ''
  });

  const inputMappingContextMenu = ref({
    visible: false,
    x: 0,
    y: 0,
    point: { x: 0.5, y: 0.5 } as NormalizedPoint
  });

  const inputMappingCaptureBindingId = ref('');

  const inputMappingCaptureIgnoreMouseUntil = ref(0);

  const inputMappingCaptureSuppressClickUntil = ref(0);

  const inputMappingStickerDrag = ref<{
    bindingId: string;
    offsetX: number;
    offsetY: number;
  } | null>(null);

  const inputMappingAimAreaResize = ref<{
    bindingId: string;
    signX: -1 | 1;
    signY: -1 | 1;
  } | null>(null);

  const inputMappingStickerLayoutRevision = ref(0);

  const inputMappingSwipeRecordingBindingId = ref('');

  const inputMappingSwipeRecordingPath = ref<NormalizedPoint[]>([]);

  const inputMappingSwipeRecordingStartedAt = ref(0);

  const inputMappingSwipeDrawingBindingId = ref('');

  const inputMappingSwipeDrawingRestoreMenu = ref(false);

  const inputMappingStickers = computed(() => {
    const profile = options.activeProfile.value;
    return profile ? buildInputMappingStickers(profile) : [];
  });

  const isNewInputMappingProfileDraft = computed(() => options.isNewDraft());

  const selectedInputMappingSticker = computed(() => {
    return inputMappingStickers.value.find((sticker) => sticker.bindingId === selectedInputMappingStickerId.value) ?? null;
  });

  const getJoystickStickerBindingIds = (bindingId: string) => {
    if (!bindingId.startsWith('joystick:')) {
      return [];
    }

    const separatorIndex = bindingId.lastIndexOf(':');
    if (separatorIndex < 'joystick:'.length) {
      return [];
    }

    return bindingId
      .slice(separatorIndex + 1)
      .split('+')
      .filter(Boolean);
  };

  const findExistingJoystickSticker = () => {
    return inputMappingStickers.value.find((sticker) => sticker.bindingId.startsWith('joystick:')) ?? null;
  };

  const selectedInputMappingBinding = computed(() => {
    const profile = options.activeProfile.value;
    const sticker = selectedInputMappingSticker.value;
    if (!profile || !sticker || sticker.bindingId.startsWith('joystick:')) {
      return null;
    }

    return profile.bindings.find((binding) => binding.id === sticker.bindingId) ?? null;
  });

  const selectedInputMappingJoystickBindings = computed(() => {
    const profile = options.activeProfile.value;
    const sticker = selectedInputMappingSticker.value;
    if (!profile || !sticker || !sticker.bindingId.startsWith('joystick:')) {
      return [];
    }

    const bindingIds = getJoystickStickerBindingIds(sticker.bindingId);
    return profile.bindings.filter((binding) => bindingIds.includes(binding.id) && binding.action.type === 'virtualJoystick');
  });

  const selectedInputMappingJoystickControlMode = computed(() => {
    const action = selectedInputMappingJoystickBindings.value[0]?.action;
    return action?.type === 'virtualJoystick' ? (action.controlMode ?? 'slide') : 'slide';
  });

  const selectedInputMappingJoystickSizePercent = computed(() => {
    const action = selectedInputMappingJoystickBindings.value[0]?.action;
    return action?.type === 'virtualJoystick' ? Math.round((action.radius / 0.08) * 100) : 100;
  });

  const selectedInputMappingJoystickDirectionBindings = computed(() => {
    const directionOrder = [
      ['up', '上'] as const,
      ['left', '左'] as const,
      ['down', '下'] as const,
      ['right', '右'] as const
    ];
    const items: Array<{ directionKey: string; title: string; binding: InputMappingBinding }> = [];

    for (const [directionKey, title] of directionOrder) {
      const binding = selectedInputMappingJoystickBindings.value.find((item) => {
        if (item.action.type !== 'virtualJoystick') {
          return false;
        }
        if (directionKey === 'up') return item.action.direction.y < 0;
        if (directionKey === 'down') return item.action.direction.y > 0;
        if (directionKey === 'left') return item.action.direction.x < 0;
        return item.action.direction.x > 0;
      });

      if (binding) {
        items.push({ directionKey, title, binding });
      }
    }

    return items;
  });

  const selectedInputMappingIsAttackBinding = computed(() => {
    const binding = selectedInputMappingBinding.value;
    return binding?.sticker?.role === 'attack' || binding?.id.startsWith('fire-') === true;
  });

  const selectedInputMappingCanEditTrigger = computed(() => {
    const binding = selectedInputMappingBinding.value;
    return !!binding && binding.action.type !== 'mouseLook' && !selectedInputMappingIsAttackBinding.value;
  });

  const selectedInputMappingStickerLabelText = computed(() => {
    const binding = selectedInputMappingBinding.value;
    return binding?.sticker?.label ?? binding?.label ?? selectedInputMappingSticker.value?.label ?? '';
  });

  const selectedInputMappingConfigTitle = computed(() => {
    const sticker = selectedInputMappingSticker.value;
    const binding = selectedInputMappingBinding.value;
    const label = selectedInputMappingStickerLabelText.value;
    if (!sticker) {
      return '';
    }

    if (sticker.shape === 'joystick') {
      return '方向按键';
    }

    if (sticker.shape === 'look') {
      return '视角移动';
    }

    if (binding?.action.type === 'mouseLook') {
      return '准星键';
    }

    if (binding?.action.type === 'swipe') {
      return '滑动键位';
    }

    if (binding?.action.type === 'rapidTap') {
      return '连击按键';
    }

    if (binding?.trigger.type === 'mouseButton') {
      return label || '鼠标按键';
    }

    return label || '按键配置';
  });

  const selectedInputMappingRapidTapAction = computed(() => {
    const action = selectedInputMappingBinding.value?.action;
    return action?.type === 'rapidTap' ? action : null;
  });

  const selectedInputMappingPressMode = computed(() => {
    const binding = selectedInputMappingBinding.value;
    if (!binding || selectedInputMappingIsAttackBinding.value) {
      return '';
    }

    return binding.action.type === 'tap' || binding.action.type === 'hold' ? binding.action.type : '';
  });

  const selectedInputMappingSwipeAction = computed(() => {
    const action = selectedInputMappingBinding.value?.action;
    return action?.type === 'swipe' ? action : null;
  });

  const selectedInputMappingMouseLookAction = computed(() => {
    const action = selectedInputMappingBinding.value?.action;
    return action?.type === 'mouseLook' ? action : null;
  });

  const selectedInputMappingMouseLookRangePercent = computed(() => {
    const action = selectedInputMappingMouseLookAction.value;
    return {
      x: action ? Math.round(((action.rangeX ?? action.maxStep ?? 0.08) / 0.08) * 100) : 100,
      y: action ? Math.round(((action.rangeY ?? action.maxStep ?? 0.08) / 0.08) * 100) : 100
    };
  });

  const isSelectedInputMappingSwipeDrawing = computed(() =>
    !!selectedInputMappingBinding.value
    && inputMappingSwipeDrawingBindingId.value === selectedInputMappingBinding.value.id
  );

  const inputMappingStickerPaletteItems: InputMappingStickerPaletteItem[] = [
    { type: 'click', title: '点击按键', iconComponent: options.icons.click },
    { type: 'rapidTap', title: '连点按键', iconComponent: options.icons.rapidTap },
    { type: 'swipe', title: '滑动键位', iconComponent: options.icons.swipe },
    { type: 'joystick', title: '方向按键', iconComponent: options.icons.joystick },
    { type: 'aim', title: '准星键', iconComponent: options.icons.aim },
    { type: 'look', title: '视角移动', iconComponent: options.icons.look },
    { type: 'fire', title: '攻击键', iconComponent: options.icons.fire }
  ];

  const clearInputMappingEditorSelection = () => {
    selectedInputMappingStickerId.value = '';
    inputMappingCaptureBindingId.value = '';
    inputMappingCaptureIgnoreMouseUntil.value = 0;
  };

  const resetInputMappingCaptureState = () => {
    inputMappingCaptureBindingId.value = '';
    inputMappingCaptureIgnoreMouseUntil.value = 0;
    inputMappingCaptureSuppressClickUntil.value = 0;
  };

  return {
    selectedInputMappingStickerId,
    isInputMappingProfileDialogVisible,
    inputMappingProfileDialogMode,
    inputMappingProfileForm,
    inputMappingContextMenu,
    inputMappingCaptureBindingId,
    inputMappingCaptureIgnoreMouseUntil,
    inputMappingCaptureSuppressClickUntil,
    inputMappingStickerDrag,
    inputMappingAimAreaResize,
    inputMappingStickerLayoutRevision,
    inputMappingSwipeRecordingBindingId,
    inputMappingSwipeRecordingPath,
    inputMappingSwipeRecordingStartedAt,
    inputMappingSwipeDrawingBindingId,
    inputMappingSwipeDrawingRestoreMenu,
    inputMappingStickers,
    isNewInputMappingProfileDraft,
    selectedInputMappingSticker,
    selectedInputMappingBinding,
    selectedInputMappingJoystickBindings,
    selectedInputMappingJoystickControlMode,
    selectedInputMappingJoystickSizePercent,
    selectedInputMappingJoystickDirectionBindings,
    selectedInputMappingIsAttackBinding,
    selectedInputMappingCanEditTrigger,
    selectedInputMappingStickerLabelText,
    selectedInputMappingConfigTitle,
    selectedInputMappingRapidTapAction,
    selectedInputMappingPressMode,
    selectedInputMappingSwipeAction,
    selectedInputMappingMouseLookAction,
    selectedInputMappingMouseLookRangePercent,
    isSelectedInputMappingSwipeDrawing,
    inputMappingStickerPaletteItems,
    getJoystickStickerBindingIds,
    findExistingJoystickSticker,
    clearInputMappingEditorSelection,
    resetInputMappingCaptureState
  };
}
