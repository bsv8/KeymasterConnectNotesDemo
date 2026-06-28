// src/components/ConnectStatus.tsx
// notes 页头连接状态条。
//
// 设计缘由（施工单 2026-06-26 lock-screen-custom-provider 第 9.3 节 +
//          2026-06-26 delete-current-owner-space 第 3.1 / 7.3 节 +
//          2026-06-27 notion-document-toolbar-and-mobile-sidebar
//          第 4.7 / 8.2 章 +
//          施工单 2026-06-27 005-i18n-header-language-switch 8.9 章 +
//          施工单 2026-06-28 001 connect-session-bound-key-integration
//          硬切换第 8.6 章）：
//   - 只服务于已登录态（notes 页面顶部），不再承担未登录主入口页面职责。
//   - popup 连接状态机来自 session client（idle / opening / connected / disconnected）。
//   - **不再**在本组件内部展示"最近错误"横条——应用级 `lastError` 已统一
//     收口到 App 的 banner 上；本组件**不**与 banner 重复展示同一条错误。
//   - 已登录态按钮区收口四个动作：重新登录 / 恢复 session / 切换身份 / 删除当前本地数据 / 退出登录。
//   - **新增 session 语义**（施工单 2026-06-28 001 第 4.2 / 8.6 章）：
//       - 多一行 `sessionId`（owner publicKey 旁边的关键真值）；
//       - 提供"重新连接 / 恢复"按钮（`onResume`）—— transport 断线后用本地
//         sessionId 走 `connect.resume`；
//       - 提供真正的 `logout` 按钮（`onLogout`）—— 调 `connect.logout` 吊销
//         session 后退回登录壳；
//       - transport disconnected 只显示断线，**不**自动变成"未登录"。
//   - 所有用户可见文案走 i18n 字典；不直接写中文/英文/日文。

import type { ReactNode } from "react";
import { useI18n } from "../i18n/useI18n";

export type PopupUiState = "idle" | "opening" | "connected" | "disconnected";

export interface ConnectStatusProps {
  state: PopupUiState;
  currentOrigin: string;
  targetOrigin: string;
  /**
   * session 绑定 key 的公钥 hex。`null` 表示未登录。
   *
   * 设计缘由（施工单 2026-06-28 001 第 4.2 / 8.6 章）：
   *   - 这就是 "owner publicKey"——`cipher.*` / 数据分区都按它走；
   *   - **不再**用旧的 `identity.get` 一次性身份断言。
   */
  publicKeyHex: string | null;
  /** 当前 connect session 的 id；用于页头展示 + 调试。 */
  sessionId: string | null;
  /** session 解析时间（unix ms），页头 "last login" 用。 */
  lastLoginAt: number | null;
  /** 是否正在跑 login / resume / logout 中的任一 connect 流程。 */
  isLoggingIn: boolean;
  /** 重新登录按钮：调 `connect.login`，**不**走当前 sessionId。 */
  onLogin: () => void;
  /** 恢复 session 按钮：用本地 sessionId 调 `connect.resume`。 */
  onResume: () => void;
  /** 切换身份 / 更换登录器：只清本地工作区，**不**删除 owner 本地数据。 */
  onForget: () => void;
  /** 删除当前 owner 本地空间入口；语义与"切换身份"完全不同，必须再走二次确认。 */
  onDeleteCurrentData: () => void;
  /** 真正的 `connect.logout`：调服务端吊销并清本地 session。 */
  onLogout: () => void;
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
          label={t("connect.row.sessionId")}
          value={props.sessionId ? truncate(props.sessionId, 14) : t("connect.row.sessionId.empty")}
          title={props.sessionId ?? undefined}
        />
        <Row
          label={t("connect.row.lastLogin")}
          value={props.lastLoginAt ? new Date(props.lastLoginAt).toLocaleString(language) : "—"}
        />
      </div>

      <div className="connect-status__actions">
        {props.publicKeyHex ? (
          <>
            <button
              type="button"
              className="secondary-button"
              onClick={props.onResume}
              disabled={props.isLoggingIn}
              title={t("connect.action.resume.title")}
            >
              {t("connect.action.resume")}
            </button>
            <button
              type="button"
              className="secondary-button"
              onClick={props.onLogin}
              disabled={props.isLoggingIn}
              title={t("connect.action.login.title")}
            >
              {t("connect.action.login")}
            </button>
            <button
              type="button"
              className="secondary-button connect-status__logout"
              onClick={props.onLogout}
              disabled={props.isLoggingIn}
              title={t("connect.action.logout.title")}
            >
              {t("connect.action.logout")}
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