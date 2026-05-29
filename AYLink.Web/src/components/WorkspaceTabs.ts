import { defineComponent, type PropType } from 'vue';
import { useI18n } from '../composables/useI18n';

export interface WorkspaceTabItem {
  key: string;
  title: string;
  closable?: boolean;
}

export default defineComponent({
  name: 'WorkspaceTabs',
  props: {
    tabs: {
      type: Array as PropType<WorkspaceTabItem[]>,
      required: true
    },
    activeKey: {
      type: String,
      required: true
    }
  },
  emits: {
    select: (key: string) => typeof key === 'string',
    close: (key: string) => typeof key === 'string'
  },
  setup() {
    const { t } = useI18n();

    return {
      t
    };
  }
});
