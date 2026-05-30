import { defineComponent, nextTick, ref, watch } from 'vue';
import { useDialog } from '../services/dialog';

export default defineComponent({
  name: 'AppDialogHost',
  setup() {
    const { currentDialog, resolveDialog } = useDialog();
    const inputValue = ref('');
    const inputElement = ref<HTMLInputElement | null>(null);

    const focusPromptInput = () => {
      void nextTick(() => {
        inputElement.value?.focus();
        inputElement.value?.select();
      });
    };

    watch(currentDialog, (dialog) => {
      if (dialog?.kind === 'prompt') {
        inputValue.value = dialog.value;
        focusPromptInput();
        return;
      }

      inputValue.value = '';
    });

    const confirmDialog = () => {
      if (!currentDialog.value) {
        return;
      }

      if (currentDialog.value.kind === 'prompt') {
        resolveDialog(inputValue.value);
        return;
      }

      if (currentDialog.value.kind === 'confirm') {
        resolveDialog(true);
        return;
      }

      resolveDialog(undefined);
    };

    const cancelDialog = () => {
      if (!currentDialog.value) {
        return;
      }

      resolveDialog(currentDialog.value.kind === 'prompt' ? null : false);
    };

    const handleBackdropClick = () => {
      if (currentDialog.value?.kind === 'alert') {
        return;
      }

      cancelDialog();
    };

    const handleKeydown = (event: KeyboardEvent) => {
      if (!currentDialog.value) {
        return;
      }

      if (event.key === 'Escape' && currentDialog.value.kind !== 'alert') {
        event.preventDefault();
        cancelDialog();
        return;
      }

      if (event.key === 'Enter' && currentDialog.value.kind !== 'alert') {
        event.preventDefault();
        confirmDialog();
      }
    };

    return {
      currentDialog,
      inputValue,
      inputElement,
      confirmDialog,
      cancelDialog,
      handleBackdropClick,
      handleKeydown
    };
  }
});
