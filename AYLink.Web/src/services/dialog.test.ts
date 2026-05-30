import { beforeEach, describe, expect, it } from 'vitest';
import { resetDialogServiceForTests, useDialog } from './dialog';

describe('dialog service', () => {
  beforeEach(() => {
    resetDialogServiceForTests();
  });

  it('opens and resolves alert dialogs', async () => {
    const dialog = useDialog();
    const pending = dialog.alert('Title', 'Message');

    expect(dialog.currentDialog.value?.kind).toBe('alert');
    expect(dialog.currentDialog.value?.title).toBe('Title');

    dialog.resolveDialog(undefined);
    await expect(pending).resolves.toBeUndefined();
    expect(dialog.currentDialog.value).toBeNull();
  });

  it('opens and resolves confirm dialogs', async () => {
    const dialog = useDialog();
    const pending = dialog.confirm('Delete', 'Are you sure?');

    expect(dialog.currentDialog.value?.kind).toBe('confirm');

    dialog.resolveDialog(true);
    await expect(pending).resolves.toBe(true);
  });

  it('opens prompt dialogs with initial value and resolves input', async () => {
    const dialog = useDialog();
    const pending = dialog.prompt('Rename', 'Enter name', 'old', 'placeholder');

    expect(dialog.currentDialog.value?.kind).toBe('prompt');
    if (dialog.currentDialog.value?.kind === 'prompt') {
      expect(dialog.currentDialog.value.value).toBe('old');
      expect(dialog.currentDialog.value.placeholder).toBe('placeholder');
    }

    dialog.resolveDialog('new-name');
    await expect(pending).resolves.toBe('new-name');
  });

  it('closes the previous dialog when a new one is opened', async () => {
    const dialog = useDialog();
    const first = dialog.confirm('First', 'message');
    const second = dialog.prompt('Second', 'message', '');

    await expect(first).resolves.toBe(false);
    expect(dialog.currentDialog.value?.kind).toBe('prompt');

    dialog.resolveDialog(null);
    await expect(second).resolves.toBeNull();
  });
});
