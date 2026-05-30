import { defineComponent } from 'vue';
import { ref } from 'vue';
import { useRouter, useRoute } from 'vue-router';
import { useI18n } from '../composables/useI18n';
import { useAsyncAction } from '../features/async/useAsyncAction';
import { login } from '../services/auth';
import { resolveApiErrorMessage } from '../utils/api';

export default defineComponent({
  name: 'LoginView',
  setup() {
    const { t } = useI18n();

    const username = ref('');
    const password = ref('');
    const errorMsg = ref('');
    const { isRunning: loading, run } = useAsyncAction();

    const router = useRouter();
    const route = useRoute();

    const handleLogin = async () => {
      if (!username.value || !password.value) return;

      errorMsg.value = '';

      try {
        const result = await run(() => login(username.value, password.value));
        if (result.ok) {
          const redirectPath = route.query.redirect as string || '/';
          router.push(redirectPath);
          return;
        }

        errorMsg.value = resolveApiErrorMessage(
          result.payload,
          t('LoginPage.InvalidCredentials', '用户名或密码错误')
        );
      } catch {
        errorMsg.value = t('Common.NetworkRequestFailed', '网络请求失败');
      }
    };

    return {
      t,
      username,
      password,
      loading,
      errorMsg,
      router,
      route,
      handleLogin
    };
  }
});
