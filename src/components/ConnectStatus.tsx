// src/components/ConnectStatus.tsx
// 顶部连接状态 + 最近错误条。
//
// 设计缘由：
//   - popup 连接状态机来自 session client（idle / opening / connected / disconnected）。
//   - 最近错误展示来自 App 持有的"最后一次协议错误"真值。
//   - 登录按钮由 App 控制：未登录时高亮；已登录时显示当前身份摘要。

import type { ReactNode } from "react";

export type PopupUiState = "idle" | "opening" | "connected" | "disconnected";

export interface ConnectStatusProps {
  state: PopupUiState;
  currentOrigin: string;
  targetOrigin: string;
  publicKeyHex: string | null;
  lastLoginAt: number | null;
  lastError: string | null;
  isLoggingIn: boolean;
  onLogin: () => void;
  onForget: () => void;
}

export function ConnectStatus(props: ConnectStatusProps) {
  return (
    <div className="connect-status">
      <div className="connect-status__indicator">
        <span className={`connect-status__dot connect-status__dot--${props.state}`} aria-hidden="true" />
        <span className="connect-status__label">{stateLabel(props.state)}</span>
      </div>

      <div className="connect-status__meta">
        <Row label="page origin" value={props.currentOrigin || "n/a"} />
        <Row label="target origin" value={props.targetOrigin || "n/a"} />
        <Row
          label="publicKey"
          value={props.publicKeyHex ? truncate(props.publicKeyHex, 14) : "未登录"}
          title={props.publicKeyHex ?? undefined}
        />
        <Row
          label="last login"
          value={props.lastLoginAt ? new Date(props.lastLoginAt).toLocaleString() : "—"}
        />
      </div>

      <div className="connect-status__actions">
        {props.publicKeyHex ? (
          <>
            <button type="button" className="secondary-button" onClick={props.onLogin} disabled={props.isLoggingIn}>
              重新登录
            </button>
            <button type="button" className="secondary-button connect-status__forget" onClick={props.onForget}>
              切换身份
            </button>
          </>
        ) : (
          <button
            type="button"
            className="primary-button"
            onClick={props.onLogin}
            disabled={props.isLoggingIn}
          >
            {props.isLoggingIn ? "拉起 popup..." : "登录"}
          </button>
        )}
      </div>

      {props.lastError ? (
        <div className="connect-status__error" role="alert">
          {props.lastError}
        </div>
      ) : null}
    </div>
  );
}

function Row({ label, value, title }: { label: string; value: ReactNode; title?: string }) {
  return (
    <div className="connect-status__row">
      <span>{label}</span>
      <strong title={title}>{value}</strong>
    </div>
  );
}

function stateLabel(state: PopupUiState): string {
  switch (state) {
    case "idle":
      return "未连接";
    case "opening":
      return "拉起 popup…";
    case "connected":
      return "已就绪";
    case "disconnected":
      return "已断开";
  }
}

function truncate(value: string, head: number): string {
  if (value.length <= head + 4) return value;
  return `${value.slice(0, head)}…${value.slice(-4)}`;
}
