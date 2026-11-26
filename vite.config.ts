import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/api/Documents': {
        target: 'https://docaskapi20261125234329-cwanhnbufjc7e3gg.westus3-01.azurewebsites.net',
        changeOrigin: true,
        // The local ASP.NET development certificate is self-signed.
        secure: false,
      },
      '/api/Conversation': {
        target: 'https://docaskapi20261125234329-cwanhnbufjc7e3gg.westus3-01.azurewebsites.net',
        changeOrigin: true,
        secure: false,
      },
      '/api/AgentV1': {
        target: 'https://docaskapi20261125234329-cwanhnbufjc7e3gg.westus3-01.azurewebsites.net',
        changeOrigin: true,
        secure: false,
      },
    },
  },
})
