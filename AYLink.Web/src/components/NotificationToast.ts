import { defineComponent } from 'vue';
import { useNotification } from '../services/notification';

export default defineComponent({
  name: 'NotificationToast',
  setup() {
    const { notifications, remove } = useNotification();

    return {
      notifications,
      remove
    };
  }
});
