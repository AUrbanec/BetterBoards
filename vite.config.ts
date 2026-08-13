/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

/**
 * base './' so the built dist/ works from any static server or a file:// path.
 * `npm run build:single` inlines everything into one index.html you can email to
 * yourself and open in the shop with no server at all.
 *
 * The single-file plugin is imported lazily, and only when that build is
 * actually requested: it is needed by one script, and a top-level import made a
 * plain `npm run dev` die with "failed to load config" on any checkout whose
 * node_modules predated it.
 */
export default defineConfig(async () => {
  const singleFile = process.env.SINGLE_FILE === '1';
  const plugins = [react()];

  if (singleFile) {
    const { viteSingleFile } = await import('vite-plugin-singlefile');
    plugins.push(viteSingleFile());
  }

  return {
    plugins,
    base: './',
    build: {
      outDir: singleFile ? 'dist-single' : 'dist',
    },
    test: {
      include: ['tests/**/*.test.ts', 'src/**/*.test.ts'],
      environment: 'node',
    },
  };
});
