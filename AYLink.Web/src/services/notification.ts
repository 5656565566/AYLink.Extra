import { ref } from 'vue';

export type NotificationType = 'info' | 'success' | 'warning' | 'error';

export interface Notification {
  id: number;
  type: NotificationType;
  title: string;
  message: string;
  duration?: number;
  progress?: number;
  showProgress?: boolean;
  isIndeterminate?: boolean;
  isCancelable?: boolean;
  onCancel?: () => void;
}

const notifications = ref<Notification[]>([]);
let nextId = 1;

export function useNotification() {
  const show = (options: Omit<Notification, 'id'>) => {
    const id = nextId++;
    const notification: Notification = {
      ...options,
      id,
      duration: options.duration ?? 3000
    };

    notifications.value.push(notification);

    if (notification.duration && notification.duration > 0) {
      setTimeout(() => {
        remove(id);
      }, notification.duration);
    }
    
    return id;
  };

  const showProgress = (options: Omit<Notification, 'id' | 'showProgress'>) => {
    return show({
      ...options,
      duration: options.duration ?? 0,
      showProgress: true,
      progress: options.progress ?? 0,
      isIndeterminate: options.isIndeterminate ?? true
    });
  };

  const update = (id: number, patch: Partial<Omit<Notification, 'id'>>) => {
    const notification = notifications.value.find(n => n.id === id);
    if (!notification) {
      return;
    }

    Object.assign(notification, patch);
  };

  const remove = (id: number) => {
    const index = notifications.value.findIndex(n => n.id === id);
    if (index !== -1) {
      notifications.value.splice(index, 1);
    }
  };

  return {
    notifications,
    show,
    showProgress,
    update,
    dismiss: remove,
    remove
  };
}
