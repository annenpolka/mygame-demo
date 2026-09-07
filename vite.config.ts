import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: { watch: { usePolling: true, interval: 300 } },
  test: { include: ['tests/**/*.test.ts'] },
});
