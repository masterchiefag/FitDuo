/// <reference types="vitest/config" />
import { existsSync, readFileSync } from 'node:fs'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'

/**
 * Personal profiles are injected at DEV time only.
 *
 * They used to be imported from src via import.meta.glob, which meant Vite
 * inlined names, weights and injury notes straight into the production bundle
 * — i.e. `npm run build` published them. Deployed builds now compile to
 * `null` here and load real profiles at runtime (Supabase, behind auth, M4).
 */
function localProfiles(mode: string): string {
  if (mode !== 'development') return 'null'
  return existsSync('profiles.local.json') ? readFileSync('profiles.local.json', 'utf8') : 'null'
}

export default defineConfig(({ mode }) => ({
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
  define: {
    __LOCAL_PROFILES__: localProfiles(mode),
  },
  test: {
    include: ['src/**/*.test.ts', 'tests/**/*.test.ts'],
    environment: 'node',
  },
}))
