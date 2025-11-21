import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  // 公開先が https://USERNAME.github.io/REPO_NAME/ の場合は以下を置き換えてください:
  base: '/prsk-trend/',
  plugins: [react()]
})
