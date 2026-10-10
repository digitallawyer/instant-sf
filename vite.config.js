import { defineConfig } from 'vite';
import { resolve } from 'node:path';

const page = p => resolve(import.meta.dirname, p);

export default defineConfig({
  build: {
    rollupOptions: {
      input: {
        main: page('index.html'),
        play: page('play/index.html'),
        game: page('game/index.html'),
        sights: page('sights/index.html'),
        streets: page('streets/index.html'),
        eat: page('eat/index.html'),
        privacy: page('privacy/index.html'),
        terms: page('terms/index.html'),
      },
    },
  },
  server: { host: '127.0.0.1' },
});
