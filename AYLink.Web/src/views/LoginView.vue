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

<script lang="ts" src="./LoginView.ts"></script>

<style scoped src="./LoginView.css"></style>
