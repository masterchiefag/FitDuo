/// <reference types="vitest/config" />
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      strategies: 'injectManifest',
      srcDir: 'src',
      filename: 'sw.ts',
      registerType: 'prompt',
      injectRegister: false,
      manifest: {
        name: 'FitDuo',
        short_name: 'FitDuo',
        description: 'Guided dumbbell workouts for two',
        display: 'standalone',
        background_color: '#0f172a',
        theme_color: '#0f172a',
        // icons added in M5 (PWA polish)
      },
      // ~70 exercises × 2 WebP frames + app shell stays well under this
      injectManifest: { maximumFileSizeToCacheInBytes: 4 * 1024 * 1024 },
      devOptions: { enabled: false },
    }),
  ],
  test: {
    include: ['src/**/*.test.ts', 'tests/**/*.test.ts'],
    environment: 'node',
  },
})
