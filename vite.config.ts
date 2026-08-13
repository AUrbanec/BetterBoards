/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { viteSingleFile } from 'vite-plugin-singlefile';

/**
 * base './' so the built dist/ works from any static server or a file:// path.
 * `SINGLE_FILE=1 npm run build` inlines everything into one index.html you can
 * email to yourself and open in the shop with no server at all.
 */
const singleFile = process.env.SINGLE_FILE === '1';

export default defineConfig({
  plugins: [react(), ...(singleFile ? [viteSingleFile()] : [])],
  base: './',
  build: {
    outDir: singleFile ? 'dist-single' : 'dist',
  },
  test: {
    include: ['tests/**/*.test.ts', 'src/**/*.test.ts'],
    environment: 'node',
  },
});
