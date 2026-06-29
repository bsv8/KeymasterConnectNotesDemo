// src/components/ConnectStatus.tsx
// notes 页头连接状态控件。
//
// 设计缘由：
//   - header 现在对标 Notion 这类应用壳，不再展示调试型元信息；
//   - transport 真值仍来自 session client（idle / opening / connected / disconnected）；
//   - 已登录态 header 只保留两个动作：
//       - 状态胶囊：已就绪 / 恢复连接 / 连接中
//       - 退出登录：真正调用 `connect.logout`
//   - 恢复连接按钮仍然直接复用 `connect.resume`，不引入新的状态机。

import { useI18n } from "../i18n/useI18n";

export type PopupUiState = "idle" | "opening" | "connected" | "disconnected";

export interface ConnectStatusProps {
  state: PopupUiState;
  /** 是否正在跑 login / resume / logout 中的任一 connect 流程。 */
  isLoggingIn: boolean;
  /** 恢复 session 按钮：用本地 sessionId 调 `connect.resume`。 */
  onResume: () => void;
  /** 真正的 `connect.logout`：调服务端吊销并清本地 session。 */
  onLogout: () => void;
}

export function ConnectStatus(props: ConnectStatusProps) {
  const { t } = useI18n();
  const tone = stateTone(props.state);
  const label = stateActionLabel(props.state, t);
  const compactLabel = stateActionCompactLabel(props.state, t);
  const canResume = props.state === "idle" || props.state === "disconnected";
  const isPending = props.state === "opening";

  return (
    <div className="connect-status">
      <button
        type="button"
        className={`connect-status__pill connect-status__pill--${tone}`}
        onClick={canResume ? props.onResume : undefined}
        disabled={!canResume || props.isLoggingIn}
        title={canResume ? t("connect.action.resume.title") : label}
      >
        <span className="connect-status__pill-dot" aria-hidden="true" />
        <span className="connect-status__label connect-status__label--full">{label}</span>
        <span className="connect-status__label connect-status__label--compact">{compactLabel}</span>
      </button>
      <button
        type="button"
        className="connect-status__logout"
        onClick={props.onLogout}
        disabled={props.isLoggingIn || isPending}
        title={t("connect.action.logout.title")}
      >
        <span className="connect-status__label connect-status__label--full">{t("connect.action.logout")}</span>
        <span className="connect-status__label connect-status__label--compact">{t("connect.action.logout.compact")}</span>
      </button>
    </div>
  );
}

function stateActionLabel(state: PopupUiState, t: (key: import("../i18n/types").MessageKey) => string): string {
  switch (state) {
    case "opening":
      return t("connect.state.opening");
    case "connected":
      return t("connect.state.connected");
    case "idle":
    case "disconnected":
      return t("connect.action.resume");
  }
}

function stateTone(state: PopupUiState): "success" | "danger" | "pending" {
  switch (state) {
    case "connected":
      return "success";
    case "opening":
      return "pending";
    case "idle":
    case "disconnected":
      return "danger";
  }
}

function stateActionCompactLabel(
  state: PopupUiState,
  t: (key: import("../i18n/types").MessageKey) => string
): string {
  switch (state) {
    case "opening":
      return t("connect.state.opening.compact");
    case "connected":
      return t("connect.state.connected.compact");
    case "idle":
    case "disconnected":
      return t("connect.action.resume.compact");
  }
}
