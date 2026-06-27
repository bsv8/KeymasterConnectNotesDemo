// src/components/LockScreen.tsx
// 登录壳：未登录态下唯一渲染的页面。
//
// 设计缘由（施工单 2026-06-26 lock-screen-custom-provider 第 3-7 章 +
//          施工单 2026-06-27 005-i18n-header-language-switch 8.8 章）：
//   - LockScreen 只在 `identity === null` 时显示。
//   - 职责：产品介绍 + 协议能力说明 + target origin 输入 + 默认地址快捷入口 + 登录按钮 + 最近错误。
//   - 明确不承载 notes 数据、不显示文件树预览、不显示最近 owner 摘要。
//   - 用户输入可以是完整 URL 或 origin 字符串；最终系统只取 `URL().origin`。
//   - 非法 URL / origin 直接阻断，不自动修正、不 fallback 默认值。
//   - 所有用户可见文案走 i18n 字典；不直接写中文/英文/日文。

import { useEffect, useMemo, useState } from "react";
import { normalizeOrigin } from "../lib/connectClient";
import { useI18n } from "../i18n/useI18n";

export const DEFAULT_TARGET_ORIGIN = "https://keymaster.cc";

export interface LockScreenProps {
  /** 当前输入框的目标 origin / url（用户原始输入字符串）。 */
  targetInput: string;
  /** 默认值，用于"使用默认地址"快捷入口。 */
  defaultTargetOrigin: string;
  /** 最近一次协议 / transport 错误；null 表示没有。 */
  lastError: string | null;
  /** 是否正在拉起 popup。 */
  isLoggingIn: boolean;
  /** 用户编辑输入框 → App 同步回锁屏。 */
  onTargetInputChange: (value: string) => void;
  /** 点击"使用默认地址"。 */
  onUseDefault: () => void;
  /** 点击登录按钮。 */
  onLogin: () => void;
}

/**
 * 锁屏页面。
 *
 * 边界（施工单硬约束）：
 * - 这里只是登录壳，不承载任何 notes 数据；
 * - 不展示文件树预览、不展示最近 owner；
 * - 非法 URL → 阻断登录 + 明确提示；
 * - 不做自动猜测、自动修正、自动回退默认 origin。
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
              <code>identity.get</code>
              <span>{t("lock.capabilities.identity.get.desc")}</span>
            </li>
            <li>
              <code>cipher.encrypt</code>
              <span>{t("lock.capabilities.cipher.encrypt.desc")}</span>
            </li>
            <li>
              <code>cipher.decrypt</code>
              <span>{t("lock.capabilities.cipher.decrypt.desc")}</span>
            </li>
          </ul>
        </section>

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
              {props.isLoggingIn ? t("lock.action.login.opening") : t("lock.action.login")}
            </button>
          </div>
        </form>

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