import { defineComponent } from 'vue';
import '@xterm/xterm/css/xterm.css';
import WorkspaceTabs from '../components/WorkspaceTabs.vue';
import { useTerminalWorkspace } from '../features/terminal/useTerminalWorkspace';

export default defineComponent({
  name: 'TerminalView',
  components: {
    WorkspaceTabs
  },
  setup() {
    return useTerminalWorkspace();
  }
});
