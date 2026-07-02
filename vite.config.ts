import { defineConfig } from 'vite';
import mkcert from 'vite-plugin-mkcert';

// HTTPS is opt-in (via `npm run dev:phone`, which sets VITE_HTTPS=1) rather than
// always-on. It's only needed to test the gyroscope from a real phone over the LAN --
// browsers only expose DeviceOrientationEvent on secure origins, except for localhost,
// which is exempt. Plain `npm run dev` (desktop/localhost testing) stays on HTTP so it
// never needs mkcert's local CA install (which can prompt for Windows UAC elevation).
const useHttps = process.env.VITE_HTTPS === '1';
const repoName = process.env.GITHUB_REPOSITORY?.split('/')[1] ?? 'bppv-simulator';
const base = process.env.VITE_BASE_PATH ?? (process.env.NODE_ENV === 'production' ? `/${repoName}/` : '/');

export default defineConfig({
  base,
  plugins: useHttps ? [mkcert()] : [],
  server: {
    https: useHttps,
  },
});
