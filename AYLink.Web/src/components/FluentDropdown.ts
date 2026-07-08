import { computed, defineComponent, nextTick, onMounted, onUnmounted, type PropType, ref, watch } from 'vue';

export type DropdownValue = string | number;

export interface DropdownOption {
  value: DropdownValue;
  label: string;
  disabled?: boolean;
}

export default defineComponent({
  name: 'FluentDropdown',
  props: {
    modelValue: {
      type: [String, Number],
      default: ''
    },
    options: {
      type: Array as PropType<DropdownOption[]>,
      default: () => []
    },
    placeholder: {
      type: String,
      default: ''
    },
    searchable: {
      type: Boolean,
      default: false
    },
    searchPlaceholder: {
      type: String,
      default: ''
    },
    emptyText: {
      type: String,
      default: ''
    },
    width: {
      type: String,
      default: '140px'
    }
  },
  emits: {
    'update:modelValue': (_value: DropdownValue) => true,
    open: () => true,
    close: () => true
  },
  setup(props, { emit }) {
    const isOpen = ref(false);
    const keyword = ref('');
    const rootElement = ref<HTMLElement | null>(null);
    const searchInput = ref<HTMLInputElement | null>(null);

    const selectedOption = computed(() => props.options.find((option) => option.value === props.modelValue) ?? null);
    const filteredOptions = computed(() => {
      const normalizedKeyword = keyword.value.trim().toLowerCase();
      if (!props.searchable || !normalizedKeyword) {
        return props.options;
      }

      return props.options.filter((option) => option.label.toLowerCase().includes(normalizedKeyword));
    });

    const openMenu = async () => {
      if (isOpen.value) {
        return;
      }

      isOpen.value = true;
      emit('open');
      if (props.searchable) {
        await nextTick();
        searchInput.value?.focus();
      }
    };

    const closeMenu = () => {
      if (!isOpen.value) {
        return;
      }

      isOpen.value = false;
      keyword.value = '';
      emit('close');
    };

    const toggleMenu = () => {
      if (isOpen.value) {
        closeMenu();
        return;
      }

      void openMenu();
    };

    const selectOption = (option: DropdownOption) => {
      if (option.disabled) {
        return;
      }

      emit('update:modelValue', option.value);
      closeMenu();
    };

    const onDocumentPointerDown = (event: PointerEvent) => {
      const target = event.target as Node | null;
      if (!target || rootElement.value?.contains(target)) {
        return;
      }

      closeMenu();
    };

    const onTriggerKeydown = (event: KeyboardEvent) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        toggleMenu();
      } else if (event.key === 'Escape') {
        closeMenu();
      }
    };

    watch(() => props.modelValue, () => {
      keyword.value = '';
    });

    onMounted(() => {
      document.addEventListener('pointerdown', onDocumentPointerDown);
    });

    onUnmounted(() => {
      document.removeEventListener('pointerdown', onDocumentPointerDown);
    });

    return {
      isOpen,
      keyword,
      rootElement,
      searchInput,
      selectedOption,
      filteredOptions,
      openMenu,
      closeMenu,
      toggleMenu,
      selectOption,
      onTriggerKeydown
    };
  }
});
