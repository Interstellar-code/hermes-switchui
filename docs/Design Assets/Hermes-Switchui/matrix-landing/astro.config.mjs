import { defineConfig } from 'astro/config';

export default defineConfig({
  srcDir: './src',
  outDir: './dist',
  publicDir: './public',
  base: '.',
  vite: {
    build: {
      cssMinify: false,
    },
  },
});
