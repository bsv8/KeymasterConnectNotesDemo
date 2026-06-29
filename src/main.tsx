// src/main.tsx
// 应用入口。
//
// 设计缘由：极简单页应用；唯一职责是挂载 App + 引入全局样式。
//
// 多语言硬切换（施工单 2026-06-27 005-i18n-header-language-switch 4.5 / 8.6 章）：
//   - React 挂载前**先**决定语言并写到 `<html lang>`，与主题首屏应用并行；
//   - 主题首屏同步避免页面先闪白再切黑；语言首屏同步避免页面先闪默认语言
//     再切到目标语言——两者逻辑完全对称。
import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { applyResolvedAppTheme, loadAppThemePreference, resolveAppTheme } from "./lib/theme";
import { getI18nStore, resolveInitialLanguage } from "./i18n/i18nStore";
import "./styles.css";

const rootEl = document.getElementById("root");
if (!rootEl) {
  throw new Error("Root element #root not found");
}

// React 挂载前先同步主题，避免首屏闪到错误的黑/白模式。
applyResolvedAppTheme(resolveAppTheme(loadAppThemePreference()));

// React 挂载前先解析并落定语言 + 写 `<html lang>`。
// store 单例在首次调用时构造；这里故意在 React 之外预先触发，
// 让语言状态在 React mount 时立即可用。
getI18nStore(resolveInitialLanguage());

ReactDOM.createRoot(rootEl).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
