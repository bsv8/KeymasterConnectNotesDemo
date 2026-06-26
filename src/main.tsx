// src/main.tsx
// 应用入口。
//
// 设计缘由：极简单页 demo；唯一职责是挂载 App + 引入全局样式。
import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./styles.css";

const rootEl = document.getElementById("root");
if (!rootEl) {
  throw new Error("Root element #root not found");
}

ReactDOM.createRoot(rootEl).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
