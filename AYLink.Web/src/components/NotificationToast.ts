import { defineComponent } from 'vue';
import { useI18n } from '../composables/useI18n';
import { useNotification } from '../services/notification';

export default defineComponent({
  name: 'NotificationToast',
  setup() {
    const { t } = useI18n();
    const { notifications, remove } = useNotification();

    return {
      t,
      notifications,
      remove
    };
  }
});
