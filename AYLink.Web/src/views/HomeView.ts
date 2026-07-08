import { defineComponent } from 'vue';
import FluentDropdown from '../components/FluentDropdown.vue';
import { useHomeDevices } from '../features/home/useHomeDevices';

export default defineComponent({
  name: 'HomeView',
  components: {
    FluentDropdown
  },
  setup() {
    return useHomeDevices();
  }
});
