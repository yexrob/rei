import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()]
  },
  preload: {
    // zod must be inlined: the sandboxed preload cannot require() node_modules
    // at runtime ("module not found: zod" otherwise).
    plugins: [externalizeDepsPlugin({ exclude: ['zod'] })]
  },
  renderer: {
    plugins: [react()]
  }
})
