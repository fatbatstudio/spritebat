import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: 'prompt',
      includeAssets: ['bat-emoji.png', 'tutorial-character.spritebat'],
      manifest: {
        name: 'SpriteBat — Sprite Sheet Compositor',
        short_name: 'SpriteBat',
        description: 'Browser-based sprite sheet compositor for layering, tinting, and combining 2D game animation assets.',
        theme_color: '#111827',
        background_color: '#111827',
        display: 'standalone',
        icons: [
          { src: 'pwa-192x192.png', sizes: '192x192', type: 'image/png' },
          { src: 'pwa-512x512.png', sizes: '512x512', type: 'image/png' },
          { src: 'pwa-512x512.png', sizes: '512x512', type: 'image/png', purpose: 'any maskable' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,png,svg,ico,woff2,spritebat}'],
        maximumFileSizeToCacheInBytes: 5 * 1024 * 1024,
      },
    }),
  ],
})
