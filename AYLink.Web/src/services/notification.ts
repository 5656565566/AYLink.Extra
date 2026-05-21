import { ref } from 'vue';

export type NotificationType = 'info' | 'success' | 'warning' | 'error';

export interface Notification {
  id: number;
  type: NotificationType;
  title: string;
  message: string;
  duration?: number;
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

  const remove = (id: number) => {
    const index = notifications.value.findIndex(n => n.id === id);
    if (index !== -1) {
      notifications.value.splice(index, 1);
    }
  };

  return {
    notifications,
    show,
    remove
  };
}
