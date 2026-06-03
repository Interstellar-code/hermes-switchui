import { defineConfig } from 'astro/config';

export default defineConfig({
  site: 'https://hermes-switchui.zi0n.space',
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
