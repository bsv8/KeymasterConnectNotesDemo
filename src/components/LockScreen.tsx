// src/components/LockScreen.tsx
// 登录壳：未登录态下唯一渲染的页面。
//
// 设计缘由（施工单 2026-06-26 lock-screen-custom-provider 第 3-7 章）：
//   - LockScreen 只在 `identity === null` 时显示。
//   - 职责：产品介绍 + 协议能力说明 + target origin 输入 + 默认地址快捷入口 + 登录按钮 + 最近错误。
//   - 明确不承载 notes 数据、不显示文件树预览、不显示最近 owner 摘要。
//   - 用户输入可以是完整 URL 或 origin 字符串；最终系统只取 `URL().origin`。
//   - 非法 URL / origin 直接阻断，不自动修正、不 fallback 默认值。

import { useEffect, useMemo, useState } from "react";
import { normalizeOrigin } from "../lib/connectClient";

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
 * - 非法 URL → 阻断登录 + 明确提示 `Target origin 非法。`；
 * - 不做自动猜测、自动修正、自动回退默认 origin。
 */
export function LockScreen(props: LockScreenProps) {
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
          <span className="lock-screen__eyebrow">Keymaster Notes</span>
          <h1 className="lock-screen__title">Notes Demo</h1>
          <p className="lock-screen__subtitle">
            一个使用 <code>identity.get</code> 与 <code>cipher.*</code> 的加密笔记工作区。
            所有正文真值由 Keymaster 提供方负责加解密，本 demo 仅做协议调用方。
          </p>
        </header>

        <section className="lock-screen__capabilities" aria-label="依赖的协议能力">
          <h2 className="lock-screen__section-title">依赖的协议能力</h2>
          <ul>
            <li>
              <code>identity.get</code>
              <span>拉起登录器 popup，取回身份与 publicKey。</span>
            </li>
            <li>
              <code>cipher.encrypt</code>
              <span>保存 note 时把 markdown UTF-8 字节加密为 nonce + cipherbytes。</span>
            </li>
            <li>
              <code>cipher.decrypt</code>
              <span>打开 note 时把密文还原为 markdown 明文。</span>
            </li>
          </ul>
        </section>

        <form className="lock-screen__form" onSubmit={handleSubmit}>
          <label className="lock-screen__field">
            <span className="lock-screen__field-label">Target origin / URL</span>
            <input
              type="text"
              className="lock-screen__input"
              value={localInput}
              onChange={(e) => {
                const next = e.target.value;
                setLocalInput(next);
                props.onTargetInputChange(next);
              }}
              placeholder={`例如 ${props.defaultTargetOrigin}`}
              spellCheck={false}
              autoComplete="off"
              aria-invalid={originInvalid}
              disabled={props.isLoggingIn}
            />
            <span className="lock-screen__field-hint">
              {originInvalid
                ? "Target origin 非法：必须是可被 URL 解析出 origin 的字符串。"
                : normalized
                ? `将使用 origin：${normalized}`
                : "可填入完整 URL；系统只取 origin 部分。"}
            </span>
          </label>

          <div className="lock-screen__actions">
            <button
              type="button"
              className="secondary-button"
              onClick={handleUseDefault}
              disabled={props.isLoggingIn || localInput === props.defaultTargetOrigin}
              title={`回填默认值：${props.defaultTargetOrigin}`}
            >
              使用默认地址
            </button>
            <button
              type="submit"
              className="primary-button lock-screen__login"
              disabled={!canSubmit}
              title={!canSubmit && trimmed.length === 0 ? "请输入 target origin / URL" : undefined}
            >
              {props.isLoggingIn ? "拉起 popup..." : "登录"}
            </button>
          </div>
        </form>

        {props.lastError ? (
          <div className="lock-screen__error" role="alert">
            {props.lastError}
          </div>
        ) : null}

        <footer className="lock-screen__footer">
          <p>
            本 demo 不会持久化身份：刷新页面后会回到这里。
            一旦登录，notes 数据按当前 owner 的 publicKey 本地分区保存。
          </p>
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