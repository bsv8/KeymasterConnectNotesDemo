// src/components/ConnectStatus.tsx
// notes 页头连接状态条。
//
// 设计缘由（施工单 2026-06-26 lock-screen-custom-provider 第 9.3 节 +
//          2026-06-26 delete-current-owner-space 第 3.1 / 7.3 节 +
//          2026-06-27 notion-document-toolbar-and-mobile-sidebar
//          第 4.7 / 8.2 章 +
//          施工单 2026-06-27 005-i18n-header-language-switch 8.9 章）：
//   - 只服务于已登录态（notes 页面顶部），不再承担未登录主入口页面职责。
//   - popup 连接状态机来自 session client（idle / opening / connected / disconnected）。
//   - **不再**在本组件内部展示"最近错误"横条——应用级 `lastError` 已统一
//     收口到 App 的 banner 上；本组件**不**与 banner 重复展示同一条错误。
//   - 已登录态按钮区收口三个动作：重新登录 / 切换身份 / 删除当前本地数据。
//   - "删除当前本地数据"语义上比"切换身份"更强：会清掉当前 owner 本地空间。
//     因此按钮在视觉上需要明显是危险动作，但仍弱于主操作，不能喧宾夺主。
//   - 未登录态由 `LockScreen` 接管登录入口；本组件不再渲染登录按钮。
//   - 所有用户可见文案走 i18n 字典；不直接写中文/英文/日文。

import type { ReactNode } from "react";
import { useI18n } from "../i18n/useI18n";

export type PopupUiState = "idle" | "opening" | "connected" | "disconnected";

export interface ConnectStatusProps {
  state: PopupUiState;
  currentOrigin: string;
  targetOrigin: string;
  publicKeyHex: string | null;
  lastLoginAt: number | null;
  isLoggingIn: boolean;
  onLogin: () => void;
  onForget: () => void;
  /** 删除当前 owner 本地空间入口；语义与"切换身份"完全不同，必须再走二次确认。 */
  onDeleteCurrentData: () => void;
}

export function ConnectStatus(props: ConnectStatusProps) {
  const { t, language } = useI18n();
  return (
    <div className="connect-status">
      <div className="connect-status__indicator">
        <span className={`connect-status__dot connect-status__dot--${props.state}`} aria-hidden="true" />
        <span className="connect-status__label">{stateLabel(props.state, t)}</span>
      </div>

      <div className="connect-status__meta">
        <Row label={t("connect.row.pageOrigin")} value={props.currentOrigin || t("common.value.notAvailable")} />
        <Row label={t("connect.row.targetOrigin")} value={props.targetOrigin || t("common.value.notAvailable")} />
        <Row
          label={t("connect.row.publicKey")}
          value={props.publicKeyHex ? truncate(props.publicKeyHex, 14) : t("connect.row.publicKey.empty")}
          title={props.publicKeyHex ?? undefined}
        />
        <Row
          label={t("connect.row.lastLogin")}
          value={props.lastLoginAt ? new Date(props.lastLoginAt).toLocaleString(language) : "—"}
        />
      </div>

      <div className="connect-status__actions">
        {props.publicKeyHex ? (
          <>
            <button type="button" className="secondary-button" onClick={props.onLogin} disabled={props.isLoggingIn}>
              {t("connect.action.login")}
            </button>
            <button
              type="button"
              className="secondary-button connect-status__forget"
              onClick={props.onForget}
              title={t("connect.action.forget.title")}
            >
              {t("connect.action.forget")}
            </button>
            <button
              type="button"
              className="secondary-button connect-status__delete"
              onClick={props.onDeleteCurrentData}
              disabled={props.isLoggingIn}
              title={t("connect.action.delete.title")}
            >
              {t("connect.action.delete")}
            </button>
          </>
        ) : null}
      </div>
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

function stateLabel(state: PopupUiState, t: (key: import("../i18n/types").MessageKey) => string): string {
  switch (state) {
    case "idle":
      return t("connect.state.idle");
    case "opening":
      return t("connect.state.opening");
    case "connected":
      return t("connect.state.connected");
    case "disconnected":
      return t("connect.state.disconnected");
  }
}

function truncate(value: string, head: number): string {
  if (value.length <= head + 4) return value;
  return `${value.slice(0, head)}…${value.slice(-4)}`;
}