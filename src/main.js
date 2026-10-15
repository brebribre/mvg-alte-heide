import { createApp } from 'vue'
import App from './App.vue'
// Roboto ships with the app (Latin only; that covers German): a board on a kiosk should not depend on Google Fonts.
import '@fontsource/roboto/latin-400.css'
import '@fontsource/roboto/latin-500.css'
import './style.css'

createApp(App).mount('#app')
