import { defineComponent } from 'vue';

export default defineComponent({
  name: 'SettingItem',
  props: {
    title: {
      type: String,
      required: true
    },
    description: {
      type: String,
      required: false,
      default: undefined
    }
  }
});
