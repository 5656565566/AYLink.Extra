import { createApp } from 'vue'
import './style.css'
import App from './App.vue'
import router from './router'
import { initializeTheme } from './services/theme'
import { initializeI18n } from './services/i18n'
import { initializeAuth } from './services/auth'
import './services/background'

async function bootstrap() {
  initializeTheme()
  await initializeAuth()
  await initializeI18n()

  const app = createApp(App)
  app.use(router)
  await router.isReady()
  app.mount('#app')
}

void bootstrap()
