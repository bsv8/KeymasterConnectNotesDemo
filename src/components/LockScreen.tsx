// src/components/LockScreen.tsx
// 登录壳：未登录态下唯一渲染的页面。
//
// 设计缘由（施工单 2026-06-26 lock-screen-custom-provider 第 3-7 章 +
//          施工单 2026-06-27 005-i18n-header-language-switch 8.8 章 +
//          施工单 2026-06-28 001 connect-session-bound-key-integration
//          硬切换第 4.3 / 8.5 章 +
//          施工单 2026-06-28 003 lock-screen-popup-close-and-relogin
//          硬切换第 4-5 章）：
//   - LockScreen 只在 `session === null` 时显示。
//   - 职责：产品介绍 + 协议能力说明 + target origin 输入 + 默认地址快捷入口 +
//     主按钮（登录 / 重新登录）+ 最近错误 + **resume 状态 + 恢复失败提示**。
//   - 明确不承载 notes 数据、不显示文件树预览、不显示最近 owner 摘要。
//   - 用户输入可以是完整 URL 或 origin 字符串；最终系统只取 `URL().origin`。
//   - 非法 URL / origin 直接阻断，不自动修正、不 fallback 默认值。
//   - 所有用户可见文案走 i18n 字典；不直接写中文/英文/日文。
//   - mode 区分三种语义：
//       - `"login"`        —— 没有本地 session，显示真正的登录入口；
//       - `"resume"`       —— 有本地 session、正在 resume（popup 可能要求解锁）；
//       - `"resumeFailed"` —— resume 失败 / 跨 origin / 记录损坏，提示重新登录。
//   - 主按钮文案**不**由 mode 决定，而是由"是否存在本地 session"决定：
//       - 无本地 session → 登录；
//       - 有本地 session → 重新登录；
//     想换 key / 换 provider / 放弃当前本地 session 的用户直接点"重新登录"。
//   - 锁屏页**不再**展示"忘掉当前 session"按钮（施工单 2026-06-28 003）。
//   - 锁屏页里的 `popup_closed` **不**展示成错误横幅（施工单 2026-06-28 003
//     第 4.2 / 5.1 / 5.2 章）；transport 真实 `popup_blocked` 仍正常暴露。

import { useEffect, useMemo, useState } from "react";
import { normalizeOrigin } from "../lib/connectClient";
import { useI18n } from "../i18n/useI18n";

export const DEFAULT_TARGET_ORIGIN = "https://keymaster.cc";

/**
 * 锁屏层对外状态机（施工单 2026-06-28 001 第 4.3 / 8.5 章）。
 * - `login`：未登录态，等用户输入 + 点登录；
 * - `resume`：有本地 session，正在尝试 resume；不允许重复点击；
 * - `resumeFailed`：resume 失败，需要用户主动确认再 login。
 */
export type LockScreenMode = "login" | "resume" | "resumeFailed";

/**
 * 锁屏层用于展示"已记住 session"的最小视图（不再显示敏感材料）。
 * 与 `StoredConnectSessionRecord` 解耦——锁屏层只关心 id / owner / origin / 时间戳，
 * **不**读 claims。
 */
export interface LockScreenStoredSession {
  sessionId: string;
  ownerPublicKeyHex: string;
  targetOrigin: string;
  resolvedAt: number;
}

export interface LockScreenProps {
  /** 锁屏层当前模式（由 App 推导）。 */
  mode: LockScreenMode;
  /** 当前输入框的目标 origin / url（用户原始输入字符串）。 */
  targetInput: string;
  /** 默认值，用于"使用默认地址"快捷入口。 */
  defaultTargetOrigin: string;
  /** 最近一次协议 / transport 错误；null 表示没有。 */
  lastError: string | null;
  /** 是否正在拉起 popup（含 login / resume / logout 三种）。 */
  isLoggingIn: boolean;
  /**
   * 本地已记住的 connect session 摘要。
   * - `null` ⇒ 没有本地 session；
   * - 有值 ⇒ 锁屏层可以显示"已记住 session"信息 + 提供 resume 入口。
   */
  storedSession: LockScreenStoredSession | null;
  /** 用户编辑输入框 → App 同步回锁屏。 */
  onTargetInputChange: (value: string) => void;
  /** 点击"使用默认地址"。 */
  onUseDefault: () => void;
  /** 点击登录按钮（首次登录或重新登录入口）。 */
  onLogin: () => void;
  /** 点击"恢复 session"按钮。 */
  onResume: () => void;
}

/**
 * 锁屏页面。
 *
 * 边界（施工单硬约束）：
 * - 这里只是登录壳，不承载任何 notes 数据；
 * - 不展示文件树预览、不展示最近 owner；
 * - 非法 URL → 阻断登录 + 明确提示；
 * - 不做自动猜测、自动修正、自动回退默认 origin。
 * - mode === "resume" 时按钮 disabled，避免重复触发。
 * - mode === "resumeFailed" 时显示恢复失败提示，并保留登录入口。
 */
export function LockScreen(props: LockScreenProps) {
  const { t } = useI18n();
  const [localInput, setLocalInput] = useState(props.targetInput);

  // 外部 targetInput 变更（例如"使用默认地址"快捷入口）→ 同步本地输入。
  useEffect(() => {
    setLocalInput(props.targetInput);
  }, [props.targetInput]);

  const trimmed = localInput.trim();
  // 校验规则必须与 `App.tsx` / `connectClient.normalizeOrigin` 严格一致：
  // 施工单 5.1 + 5.4：不做自动补 `https://`、不做自动修正——UI 允许什么，
  // 实际登录时就要能用同一份 `normalizeOrigin` 拿到同一份 origin。
  const normalized = useMemo(() => tryNormalizeOrigin(trimmed), [trimmed]);
  const originInvalid = trimmed.length > 0 && normalized === null;
  const canSubmit = trimmed.length > 0 && normalized !== null && !props.isLoggingIn;

  const handleSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!canSubmit) return;
    props.onLogin();
  };

  const handleUseDefault = () => {
    setLocalInput(props.defaultTargetOrigin);
    props.onUseDefault();
  };

  const handleResume = () => {
    if (props.isLoggingIn) return;
    props.onResume();
  };

  const showResumeEntry =
    props.storedSession !== null && props.mode !== "resumeFailed" && normalized === props.storedSession.targetOrigin;

  /**
   * 主按钮文案的真值（施工单 2026-06-28 003）：
   *   - 无本地 session → 登录；
   *   - 有本地 session → 重新登录；
   * 不由 `mode` 决定；由"是否存在 storedSession"决定。
   */
  const isReloginEntry = props.storedSession !== null;
  const mainButtonLabelKey =
    props.isLoggingIn && props.mode !== "resume"
      ? isReloginEntry
        ? "lock.action.relogin.opening"
        : "lock.action.login.opening"
      : isReloginEntry
        ? "lock.action.relogin"
        : "lock.action.login";

  return (
    <div className="lock-screen">
      <div className="lock-screen__panel">
        <header className="lock-screen__header">
          <span className="lock-screen__eyebrow">{t("app.brand")}</span>
          <h1 className="lock-screen__title">{t("app.demoName")}</h1>
          <p className="lock-screen__subtitle">{t("lock.subtitle")}</p>
        </header>

        <section className="lock-screen__capabilities" aria-label={t("lock.capabilities.title")}>
          <h2 className="lock-screen__section-title">{t("lock.capabilities.title")}</h2>
          <ul>
            <li>
              <code>{t("lock.capabilities.connect.login")}</code>
              <span>{t("lock.capabilities.connect.login.desc")}</span>
            </li>
            <li>
              <code>{t("lock.capabilities.connect.resume")}</code>
              <span>{t("lock.capabilities.connect.resume.desc")}</span>
            </li>
            <li>
              <code>{t("lock.capabilities.connect.logout")}</code>
              <span>{t("lock.capabilities.connect.logout.desc")}</span>
            </li>
            <li>
              <code>{t("lock.capabilities.cipher.encrypt")}</code>
              <span>{t("lock.capabilities.cipher.encrypt.desc")}</span>
            </li>
            <li>
              <code>{t("lock.capabilities.cipher.decrypt")}</code>
              <span>{t("lock.capabilities.cipher.decrypt.desc")}</span>
            </li>
          </ul>
        </section>

        {props.mode === "resume" ? (
          <section className="lock-screen__status lock-screen__status--resuming" role="status" aria-live="polite">
            <h3>{t("lock.status.resuming")}</h3>
            <p>{t("lock.status.resuming.description")}</p>
          </section>
        ) : null}

        {props.mode === "resumeFailed" ? (
          <section className="lock-screen__status lock-screen__status--failed" role="alert">
            <h3>{t("lock.status.resumeFailed")}</h3>
            <p>{t("lock.status.resumeFailed.description")}</p>
          </section>
        ) : null}

        <form className="lock-screen__form" onSubmit={handleSubmit}>
          <label className="lock-screen__field">
            <span className="lock-screen__field-label">{t("lock.field.target.label")}</span>
            <input
              type="text"
              className="lock-screen__input"
              value={localInput}
              onChange={(e) => {
                const next = e.target.value;
                setLocalInput(next);
                props.onTargetInputChange(next);
              }}
              placeholder={t("lock.field.target.placeholder", { defaultOrigin: props.defaultTargetOrigin })}
              spellCheck={false}
              autoComplete="off"
              aria-invalid={originInvalid}
              disabled={props.isLoggingIn}
            />
            <span className="lock-screen__field-hint">
              {originInvalid
                ? t("lock.field.target.hint.invalid")
                : normalized
                ? t("lock.field.target.hint.normalized", { origin: normalized })
                : t("lock.field.target.hint.partial")}
            </span>
          </label>

          <div className="lock-screen__actions">
            <button
              type="button"
              className="secondary-button"
              onClick={handleUseDefault}
              disabled={props.isLoggingIn || localInput === props.defaultTargetOrigin}
              title={t("lock.field.target.title.useDefault", { defaultOrigin: props.defaultTargetOrigin })}
            >
              {t("lock.action.useDefault")}
            </button>
            <button
              type="submit"
              className="primary-button lock-screen__login"
              disabled={!canSubmit}
              title={!canSubmit && trimmed.length === 0 ? t("lock.action.login.submitTitle") : undefined}
            >
              {t(mainButtonLabelKey)}
            </button>
          </div>
        </form>

        {showResumeEntry && props.storedSession ? (
          <section className="lock-screen__resume" aria-label={t("lock.action.resume")}>
            <div className="lock-screen__resume-meta">
              <div>
                <strong>{t("connect.row.sessionId")}:</strong>{" "}
                <code title={props.storedSession.sessionId}>{shortenId(props.storedSession.sessionId, 12)}</code>
              </div>
              <div>
                <strong>{t("connect.row.publicKey")}:</strong>{" "}
                <code title={props.storedSession.ownerPublicKeyHex}>
                  {shortenId(props.storedSession.ownerPublicKeyHex, 8)}
                </code>
              </div>
            </div>
            <div className="lock-screen__actions">
              <button
                type="button"
                className="primary-button"
                onClick={handleResume}
                disabled={props.isLoggingIn}
              >
                {props.isLoggingIn && props.mode === "resume"
                  ? t("lock.action.resume.opening")
                  : t("lock.action.resume")}
              </button>
            </div>
          </section>
        ) : null}

        {props.lastError ? (
          <div className="lock-screen__error" role="alert">
            {props.lastError}
          </div>
        ) : null}

        <footer className="lock-screen__footer">
          <p>{t("lock.footer")}</p>
        </footer>
      </div>
    </div>
  );
}

/**
 * 把任意字符串尽量归一到合法 origin；失败返回 null。
 * 不抛异常：仅供 UI 灰显与提示文案使用。
 *
 * **必须**与 `connectClient.normalizeOrigin` 严格同语义——
 * 这是硬切换的边界：UI 允许 = 登录能用；UI 禁用 = 登录会报错。
 * 因此这里直接复用 `normalizeOrigin` 而不是再写一份。
 */
function tryNormalizeOrigin(value: string): string | null {
  if (value.length === 0) return null;
  try {
    return normalizeOrigin(value);
  } catch {
    return null;
  }
}

function shortenId(value: string, head: number): string {
  if (value.length <= head + 4) return value;
  return `${value.slice(0, head)}…${value.slice(-4)}`;
}