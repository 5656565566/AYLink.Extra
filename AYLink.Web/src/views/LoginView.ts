import { defineComponent } from 'vue';
import { ref } from 'vue';
import { useRouter, useRoute } from 'vue-router';
import { useI18n } from '../composables/useI18n';
import { applyAuthResponse } from '../services/auth';
import { resolveApiErrorMessage } from '../utils/api';

export default defineComponent({
  name: 'LoginView',
  setup() {
    const { t } = useI18n();

    const username = ref('');

    const password = ref('');

    const loading = ref(false);

    const errorMsg = ref('');

    const router = useRouter();

    const route = useRoute();

    const handleLogin = async () => {    
      if (!username.value || !password.value) return;    
          
      loading.value = true;    
      errorMsg.value = '';    
          
      try {    
        const res = await fetch('/api/login', {    
          method: 'POST',    
          headers: { 'Content-Type': 'application/json' },    
          body: JSON.stringify({ username: username.value, password: password.value })    
        });    
            
        const data = await res.json();    
            
        if (res.ok && data.success !== false) { // data.success 可能没有    
          applyAuthResponse(data);    
              
          const redirectPath = route.query.redirect as string || '/';    
          router.push(redirectPath);    
        } else {
          errorMsg.value = resolveApiErrorMessage(data, t('LoginPage.InvalidCredentials', '用户名或密码错误'));
    
        }    
      } catch (error) {    
        errorMsg.value = t('Common.NetworkRequestFailed', '网络请求失败');    
      } finally {    
        loading.value = false;    
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
