import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      // Proxy Anthropic API requests to avoid CORS issues
      "/v1": {
        target: "https://api.deepseek.com/v1",
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/v1/, ""),
        secure: false,
        configure: (proxy, _options) => {
          proxy.on('proxyReq', (proxyReq, req, _res) => {
            // Log proxy requests for debugging
            console.log('Proxying:', req.method, req.url, '→', proxyReq.path);

            // Remove browser-specific headers that might cause 403
            proxyReq.removeHeader('origin');
            proxyReq.removeHeader('referer');
            proxyReq.removeHeader('sec-fetch-site');
            proxyReq.removeHeader('sec-fetch-mode');
            proxyReq.removeHeader('sec-fetch-dest');
          });
        },
      },
    },
  },
  test: {
    globals: true,
    environment: "jsdom",
    setupFiles: ["./tests/setup.ts"],
    exclude: ["**/node_modules/**", "**/dist/**", "**/.worktrees/**"],
  },
});
