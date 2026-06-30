// src/components/AppViewLaunchShell.tsx
// appView 启动壳：URL 含 `launchToken` 时 JustNote 顶层渲染的唯一视图。
//
// 设计缘由（施工单 2026-06-29 001 open-app-appview-connect-launch 硬切换
//          第 6.五 / 6.六 / 7 章 +
//          施工单 2026-06-30 001 appview child ready + opener launch 硬切换
//          第 6.四 / 7 章）：
//   - appView 启动期**不**渲染 LockScreen——`launchToken` 是 Keymaster
//     launcher 已经预建 session 的一次性凭证，不存在"用户输入 target origin
//     后手工登录"的入口；
//   - 启动失败时**不**退回 LockScreen 的 login / resume / resumeFailed
//     三态，而是渲染本壳的失败态，明确告诉用户"请从 Keymaster 重新启动 app"；
//   - 文案统一通过 i18n 字典提供；
//   - 失败态**不**提供任何"重试"或"切到手工登录"按钮——appView 失败不能
//     自动 fallback 到 connect.login，必须由用户回到 Keymaster 重新拉起。
//
// 这一层**不**拥有：
//   - popup transport；
//   - 协议请求；
//   - 本地 session 持久化；
//   - 协议握手真值；
// 它只负责"启动期状态视觉"——真正的握手真值仍是：
//   1. URL `launchToken`（启动模式真值）
//   2. 发给 opener 的顶层 `ready`（child listener 就绪真值）
//   3. `connect.launch`（Open App 首登真值）

import { useI18n } from "../i18n/useI18n";

export type AppViewLaunchPhase = "launching" | "failed";

export interface AppViewLaunchShellProps {
  phase: AppViewLaunchPhase;
  /** 失败时附带的简短错误描述（用于调试 / 辅助说明）。 */
  reason?: string | null;
}

export function AppViewLaunchShell(props: AppViewLaunchShellProps) {
  const { t } = useI18n();
  return (
    <div className="lock-screen">
      <div className="lock-screen__panel">
        <header className="lock-screen__header">
          <span className="lock-screen__eyebrow">{t("app.brand")}</span>
          <h1 className="lock-screen__title">{t("appView.title")}</h1>
        </header>

        {props.phase === "launching" ? (
          <section
            className="lock-screen__status lock-screen__status--resuming"
            role="status"
            aria-live="polite"
          >
            <h3>{t("appView.launching.title")}</h3>
            <p>{t("appView.launching.description")}</p>
          </section>
        ) : (
          <section
            className="lock-screen__status lock-screen__status--failed"
            role="alert"
          >
            <h3>{t("appView.failed.title")}</h3>
            <p>{t("appView.failed.description")}</p>
            {props.reason ? (
              <p className="lock-screen__status-detail">{props.reason}</p>
            ) : null}
            <p>{t("appView.failed.hint")}</p>
          </section>
        )}
      </div>
    </div>
  );
}