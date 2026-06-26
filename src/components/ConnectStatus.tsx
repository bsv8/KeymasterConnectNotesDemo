// src/components/ConnectStatus.tsx
// notes 页头连接状态条。
//
// 设计缘由（施工单 2026-06-26 lock-screen-custom-provider 第 9.3 节 +
//          2026-06-26 delete-current-owner-space 第 3.1 / 7.3 节）：
//   - 只服务于已登录态（notes 页面顶部），不再承担未登录主入口页面职责。
//   - popup 连接状态机来自 session client（idle / opening / connected / disconnected）。
//   - 最近错误展示来自 App 持有的"最后一次协议错误"真值。
//   - 已登录态按钮区收口三个动作：重新登录 / 切换身份 / 删除当前本地数据。
//   - "删除当前本地数据"语义上比"切换身份"更强：会清掉当前 owner 本地空间。
//     因此按钮在视觉上需要明显是危险动作，但仍弱于主操作，不能喧宾夺主。
//   - 未登录态由 `LockScreen` 接管登录入口；本组件不再渲染登录按钮。

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
  /** 删除当前 owner 本地空间入口；语义与"切换身份"完全不同，必须再走二次确认。 */
  onDeleteCurrentData: () => void;
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
            <button
              type="button"
              className="secondary-button connect-status__forget"
              onClick={props.onForget}
              title="退回登录壳；不删除本地数据"
            >
              切换身份 / 更换登录器
            </button>
            <button
              type="button"
              className="secondary-button connect-status__delete"
              onClick={props.onDeleteCurrentData}
              disabled={props.isLoggingIn}
              title="删除当前 publicKey 对应的全部本地 notes 数据并退出工作区；不会删除 Keymaster 身份本身"
            >
              删除当前本地数据
            </button>
          </>
        ) : null}
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
