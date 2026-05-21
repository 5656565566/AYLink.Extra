<template>
  <div class="login-container">
    <div class="login-card">
      <div class="logo">
        <img src="/logo.ico" alt="AYLink Logo" style="width: 100%; height: 100%; object-fit: contain;" />
      </div>
      <h2 class="title">{{ t('LoginPage.Title', '登录 AYLink') }}</h2>
      <p class="subtitle">{{ t('LoginPage.Subtitle', '请输入用户名和密码以继续访问') }}</p>
      
      <form class="login-form" @submit.prevent="handleLogin">
        <div class="input-group">
          <input 
            type="text"
            v-model.trim="username" 
            :placeholder="t('LoginPage.UsernamePlaceholder', '请输入用户名')" 
            class="fluent-input" 
            :disabled="loading"
            autofocus
          />
        </div>
        <div class="input-group">
          <input 
            type="password" 
            v-model="password" 
            :placeholder="t('LoginPage.PasswordPlaceholder', '请输入密码')" 
            class="fluent-input" 
            :disabled="loading"
          />
        </div>
        <div v-if="errorMsg" class="error-text">{{ errorMsg }}</div>
        
        <button type="submit" class="primary login-btn" :disabled="loading || !password">
          <span v-if="loading" class="spinner-small"></span>
          <span v-else>{{ t('LoginPage.Submit', '登录') }}</span>
        </button>
      </form>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue';
import { useRouter, useRoute } from 'vue-router';
import { useI18n } from '../composables/useI18n';
import { applyAuthResponse } from '../services/auth';

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
      if (data.error && data.error.messageKey) {
        errorMsg.value = t(data.error.messageKey, data.error.message || '用户名或密码错误');
      } else {
        errorMsg.value = t('LoginPage.InvalidCredentials', '用户名或密码错误');
      }
    }
  } catch (error) {
    errorMsg.value = t('Common.NetworkRequestFailed', '网络请求失败');
  } finally {
    loading.value = false;
  }
};
</script>

<style scoped>
.login-container {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 100vw;
  height: 100vh;
  background-color: var(--fluent-bg-base);
  position: fixed;
  top: 0;
  left: 0;
  z-index: 9999;
}

.login-card {
  width: 360px;
  background-color: var(--fluent-bg-layer);
  border: 1px solid var(--fluent-stroke-default);
  border-radius: 8px;
  padding: 40px 32px;
  display: flex;
  flex-direction: column;
  align-items: center;
  box-shadow: 0 16px 32px rgba(0, 0, 0, 0.4);
  animation: slideUp 0.3s cubic-bezier(0.4, 0, 0.2, 1);
}

@keyframes slideUp {
  from { opacity: 0; transform: translateY(20px); }
  to { opacity: 1; transform: translateY(0); }
}

.logo {
  width: 56px;
  height: 56px;
  color: var(--fluent-accent-default);
  margin-bottom: 24px;
}

.logo svg {
  width: 100%;
  height: 100%;
}

.title {
  font-size: 24px;
  font-weight: 600;
  color: var(--fluent-text-primary);
  margin-bottom: 8px;
}

.subtitle {
  font-size: 14px;
  color: var(--fluent-text-secondary);
  margin-bottom: 32px;
}

.login-form {
  width: 100%;
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.input-group {
  width: 100%;
}

.fluent-input {
  width: 100%;
  padding: 10px 12px;
  font-size: 14px;
}

.error-text {
  color: #ff99a4;
  font-size: 13px;
  margin-top: -8px;
}

.login-btn {
  width: 100%;
  height: 36px;
  font-size: 15px;
  margin-top: 8px;
}

.spinner-small {
  width: 16px;
  height: 16px;
  border: 2px solid rgba(255, 255, 255, 0.3);
  border-top-color: #fff;
  border-radius: 50%;
  animation: spin 1s linear infinite;
  display: inline-block;
}
</style>
