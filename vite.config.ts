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

/**
 * Hosts allowed to reach the dev/preview server.
 *
 * Vite ≥ 6 rejects any request whose Host header it does not recognise, with a
 * 403 "Blocked request. This host is not allowed." That is the right default on
 * a laptop, but it breaks every browser-in-the-cloud setup, where you reach the
 * server through a forwarded hostname rather than localhost — and the platform's
 * proxy often reports the refusal as a generic error page, so it does not look
 * like a host problem at all.
 *
 * A leading dot allows the domain and its subdomains.
 */
const FORWARDED_HOSTS = [
  '.app.github.dev',        // GitHub Codespaces
  '.github.dev',
  '.githubpreview.dev',     // older Codespaces domain
  '.gitpod.io',
  '.gitpod.dev',
  '.repl.co',
  '.csb.app',               // CodeSandbox
];

const inCodespaces = Boolean(process.env.CODESPACES);

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
    server: {
      // bind 0.0.0.0 so a container's port forwarding can reach the server
      host: true,
      allowedHosts: FORWARDED_HOSTS,
      // Codespaces terminates TLS at the proxy on 443; without this the HMR
      // socket tries the raw dev port and never connects, so edits look dead.
      hmr: inCodespaces ? { clientPort: 443, protocol: 'wss' } : undefined,
    },
    preview: {
      host: true,
      allowedHosts: FORWARDED_HOSTS,
    },
    build: {
      outDir: singleFile ? 'dist-single' : 'dist',
    },
    test: {
      include: ['tests/**/*.test.ts', 'src/**/*.test.ts'],
      environment: 'node',
    },
  };
});
