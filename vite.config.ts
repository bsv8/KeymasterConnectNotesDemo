import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// 设计缘由：施工单要求最小 vite 配置。仅启用 React 插件与开发端口，
// 不引入额外插件（HMR / SSR / 路径别名 / 全局 CSS 框架）。
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    strictPort: false
  }
});
