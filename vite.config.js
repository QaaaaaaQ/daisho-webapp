import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { execSync } from 'node:child_process'

// ビルド時にバージョン情報を注入（Vercel ではコミットSHAを自動取得、ローカルでは git から）
function gitCommit() {
  if (process.env.VERCEL_GIT_COMMIT_SHA) return process.env.VERCEL_GIT_COMMIT_SHA.slice(0, 7)
  try { return execSync('git rev-parse --short HEAD').toString().trim() } catch { return 'dev' }
}
function buildTime() {
  // YYYY-MM-DD HH:mm（UTC・ビルドマシン時刻）
  return new Date().toISOString().slice(0, 16).replace('T', ' ')
}

export default defineConfig({
  plugins: [react()],
  define: {
    __APP_VERSION__: JSON.stringify(process.env.npm_package_version || '1.0.0'),
    __GIT_COMMIT__: JSON.stringify(gitCommit()),
    __BUILD_TIME__: JSON.stringify(buildTime()),
  },
})
