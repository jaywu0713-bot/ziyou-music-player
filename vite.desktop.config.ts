import tailwindcss from '@tailwindcss/postcss';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { defineConfig } from 'vite';

const root = fileURLToPath(new URL('.', import.meta.url));
const isGitHubPagesBuild = process.env.GITHUB_PAGES === 'true';

export default defineConfig({
  root,
  plugins: [react()],
  base: isGitHubPagesBuild ? '/ziyou-music-player/' : '/',
  resolve: { alias: { '@': resolve(root) } },
  css: { postcss: { plugins: [tailwindcss()] } },
  define: { __APP_BASE_PATH__: JSON.stringify(isGitHubPagesBuild ? '/ziyou-music-player' : '') },
  server: { strictPort: true },
  build: {
    outDir: 'dist-desktop',
    emptyOutDir: true,
    rolldownOptions: {
      input: {
        desktop: resolve(root, 'desktop.html'),
        lyrics: resolve(root, 'lyrics.html'),
        visualization: resolve(root, 'visualization.html'),
        mini: resolve(root, 'mini.html'),
      },
    },
  },
});
