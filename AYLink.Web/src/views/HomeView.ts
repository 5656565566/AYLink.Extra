import { defineComponent } from 'vue';
import { useHomeDevices } from '../features/home/useHomeDevices';

export default defineComponent({
  name: 'HomeView',
  setup() {
    return useHomeDevices();
  }
});
