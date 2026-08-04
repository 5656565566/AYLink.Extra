import { defineComponent } from 'vue';
import {
  ArrowClockwise20Regular,
  Desktop20Regular,
  PlugConnected20Regular,
  Wifi120Regular,
} from '@vicons/fluent';
import FluentDropdown from '../components/FluentDropdown.vue';
import { useHomeDevices } from '../features/home/useHomeDevices';

export default defineComponent({
  name: 'HomeView',
  components: {
    ArrowClockwise20Regular,
    Desktop20Regular,
    FluentDropdown,
    PlugConnected20Regular,
    Wifi120Regular
  },
  setup() {
    return useHomeDevices();
  }
});
