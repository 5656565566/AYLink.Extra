import { ref } from 'vue';

export type DialogKind = 'alert' | 'confirm' | 'prompt';

interface DialogRequestBase {
  id: number;
  kind: DialogKind;
  title: string;
  message: string;
  confirmText?: string;
  cancelText?: string;
}

export interface AlertDialogRequest extends DialogRequestBase {
  kind: 'alert';
}

export interface ConfirmDialogRequest extends DialogRequestBase {
  kind: 'confirm';
}

export interface PromptDialogRequest extends DialogRequestBase {
  kind: 'prompt';
  value: string;
  placeholder?: string;
}

export type DialogRequest = AlertDialogRequest | ConfirmDialogRequest | PromptDialogRequest;

const currentDialog = ref<DialogRequest | null>(null);
let nextDialogId = 1;
let pendingResolver: ((value: unknown) => void) | null = null;

function openDialog<T, TRequest extends DialogRequest>(request: Omit<TRequest, 'id'>) {
  if (pendingResolver) {
    pendingResolver(currentDialog.value?.kind === 'prompt' ? null : false);
    pendingResolver = null;
  }

  const id = nextDialogId++;
  currentDialog.value = {
    ...request,
    id
  } as TRequest;

  return new Promise<T>((resolve) => {
    pendingResolver = resolve as (value: unknown) => void;
  });
}

function resolveDialog(result: unknown) {
  if (!pendingResolver) {
    currentDialog.value = null;
    return;
  }

  const resolver = pendingResolver;
  pendingResolver = null;
  currentDialog.value = null;
  resolver(result);
}

export function resetDialogServiceForTests() {
  currentDialog.value = null;
  pendingResolver = null;
  nextDialogId = 1;
}

export function useDialog() {
  const alert = (title: string, message: string, confirmText?: string) => {
    return openDialog<void, AlertDialogRequest>({
      kind: 'alert',
      title,
      message,
      confirmText
    });
  };

  const confirm = (title: string, message: string, confirmText?: string, cancelText?: string) => {
    return openDialog<boolean, ConfirmDialogRequest>({
      kind: 'confirm',
      title,
      message,
      confirmText,
      cancelText
    });
  };

  const prompt = (
    title: string,
    message: string,
    value = '',
    placeholder?: string,
    confirmText?: string,
    cancelText?: string
  ) => {
    return openDialog<string | null, PromptDialogRequest>({
      kind: 'prompt',
      title,
      message,
      value,
      placeholder,
      confirmText,
      cancelText
    });
  };

  return {
    currentDialog,
    alert,
    confirm,
    prompt,
    resolveDialog
  };
}
