import { defineComponent } from 'vue';

export default defineComponent({
  name: 'SettingSection',
  props: {
    title: {
      type: String,
      required: false,
      default: undefined
    }
  }
});
