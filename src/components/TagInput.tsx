// src/components/TagInput.tsx
// tag chip 输入控件：双段式真值（已提交的 `tags` + 控件内部临时输入 `tagInputValue`）。
//
// 设计缘由（施工单 2026-06-26 save-tag-folder-ux 第 4.3 / 7 章）：
//   - **不**把 `tags.join(", ")` 当另一份真值；React state 本身就是隐藏真值。
//   - 用户敲回车 / 半角逗号 / 全角逗号 / 空格 → 触发提交；连续分隔符 = 空 token 直接丢弃。
//   - 粘贴多 tag（例如 `alpha beta,gamma，delta`）一次拆成多个 chip。
//   - 重复 tag：直接忽略；已有 chip 不动。
//   - 超长 / 超量：超长 token 不入列；超过 `MAX_TAGS_PER_NOTE` 的不入列。
//   - 中文输入法 composition 期间回车**不**触发提交，等 `compositionend` 后再处理。
//   - 输入框为空时按退格：删除最后一个 chip。
//   - `disabled` 时：输入框禁用，chip 删除按钮禁用。

import { useEffect, useRef, useState } from "react";
import { MAX_TAGS_PER_NOTE, MAX_TAG_LENGTH, normalizeTags, splitTagTokens } from "../lib/notes";

export interface TagInputProps {
  /** 已提交的 tag 数组（业务真值）。 */
  value: string[];
  /** tag 变化回调（提交后 / 删除后）。 */
  onChange: (next: string[]) => void;
  disabled?: boolean;
  /** placeholder 文案。 */
  placeholder?: string;
}

export function TagInput(props: TagInputProps) {
  const [inputValue, setInputValue] = useState("");
  // IME composition 状态：中文 / 日文等输入法在按下回车时表示"确认候选"，不是"提交"。
  const [isComposing, setIsComposing] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);

  // 父组件在外面把当前 note 切换到另一条时，已提交的 tag 也会跟着切。
  // 这里**不**清空 inputValue——用户在切换之间输入的临时文本视为"上一条 draft 残留"，
  // 但实际上我们切换 note 时整条 draft 会被替换，inputValue 应当回到空串。
  // 因此在 `value` 引用变化时清空临时输入。
  const lastValueRef = useRef<string[]>(props.value);
  useEffect(() => {
    if (lastValueRef.current !== props.value) {
      lastValueRef.current = props.value;
      setInputValue("");
      setIsComposing(false);
    }
  }, [props.value]);

  function commit(raw: string): boolean {
    const tokens = splitTagTokens(raw);
    if (tokens.length === 0) return false;
    // 与既有 tag 合并；normalizeTags 负责 trim / 小写 / 去重 / 长度 / 数量。
    const merged = [...props.value, ...tokens];
    const next = normalizeTags(merged);
    if (next.length === props.value.length && tokens.every((t) => props.value.includes(t.toLowerCase().trim()))) {
      // 提交后实际没有任何变化（重复 / 超长 / 超量），依旧清掉临时输入。
      setInputValue("");
      return false;
    }
    props.onChange(next);
    setInputValue("");
    return true;
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (props.disabled) return;
    // IME composition 进行中：跳过回车 / 退格的"提交"语义。
    if (isComposing || (e.nativeEvent as unknown as { isComposing?: boolean }).isComposing) {
      return;
    }
    if (e.key === "Enter" || e.key === ",") {
      e.preventDefault();
      commit(inputValue);
      return;
    }
    // 中文 / 全角逗号：在 keydown 时不一定能拿到，但 React 的 key 已经是「，」。
    if (e.key === "，" || e.key === " " || e.key === "Spacebar") {
      // 空格触发提交；但只在临时输入非空时。
      if (inputValue.trim().length === 0) return;
      e.preventDefault();
      commit(inputValue);
      return;
    }
    if (e.key === "Backspace" && inputValue.length === 0 && props.value.length > 0) {
      e.preventDefault();
      props.onChange(props.value.slice(0, -1));
      return;
    }
  }

  /**
   * change 兜底：正常路径下分隔符字符已被 keydown `preventDefault` 拦截，
   * onChange 不会看到含分隔符的 value。
   * 但浏览器自动补全 / 自动修正等场景下，value 仍可能含分隔符。
   * 这种场景按"离散提交"处理：所有 token 一次性入列，不保留尾段。
   */
  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    if (props.disabled) return;
    const next = e.target.value;
    if (/[,，\s\n\t]/.test(next)) {
      const tokens = splitTagTokens(next);
      if (tokens.length === 0) {
        setInputValue("");
        return;
      }
      const merged = [...props.value, ...tokens];
      const normalized = normalizeTags(merged);
      props.onChange(normalized);
      setInputValue("");
      return;
    }
    setInputValue(next);
  }

  function handleCompositionStart() {
    setIsComposing(true);
  }
  /**
   * IME composition 结束：候选词一旦确认，就是离散操作。
   * 若确认内容含分隔符，所有 token 一次性入列，不保留尾段。
   * （虽然候选词极少包含分隔符，这里仍按统一语义处理。）
   */
  function handleCompositionEnd(e: React.CompositionEvent<HTMLInputElement>) {
    setIsComposing(false);
    const next = (e.target as HTMLInputElement).value;
    if (/[,，\s\n\t]/.test(next)) {
      const tokens = splitTagTokens(next);
      if (tokens.length === 0) {
        setInputValue("");
        return;
      }
      const merged = [...props.value, ...tokens];
      const normalized = normalizeTags(merged);
      props.onChange(normalized);
      setInputValue("");
    }
  }

  /**
   * 粘贴多 tag：施工单 7.3 验收项要求**一次拆成多个 chip**，
   * 不保留"最后一个 token"作为未完成输入。
   *
   * 之前版本会把尾段留在输入框；如果用户接着直接点保存，尾段会丢。
   * 这里改为：当前 inputValue（若非空）+ 粘贴内容合并后，所有 token 一次性入列。
   */
  function handlePaste(e: React.ClipboardEvent<HTMLInputElement>) {
    if (props.disabled) return;
    const pasted = e.clipboardData.getData("text");
    if (!pasted) return;
    if (!/[,，\s\n\t]/.test(pasted)) {
      // 没有分隔符：走默认行为，让 onChange 自然处理。
      return;
    }
    e.preventDefault();
    const combined = `${inputValue}${pasted}`;
    const tokens = splitTagTokens(combined);
    if (tokens.length === 0) {
      setInputValue("");
      return;
    }
    const merged = [...props.value, ...tokens];
    const normalized = normalizeTags(merged);
    props.onChange(normalized);
    setInputValue("");
  }

  function handleRemove(index: number) {
    if (props.disabled) return;
    const next = props.value.slice();
    next.splice(index, 1);
    props.onChange(next);
  }

  return (
    <div
      className={`tag-input ${props.disabled ? "is-disabled" : ""}`}
      onClick={() => inputRef.current?.focus()}
    >
      <div className="tag-input__chips" role="list">
        {props.value.map((tag, idx) => (
          <span key={`${tag}-${idx}`} className="tag-chip" role="listitem">
            <span className="tag-chip__label">#{tag}</span>
            <button
              type="button"
              className="tag-chip__remove"
              aria-label={`删除 tag ${tag}`}
              onClick={(e) => {
                e.stopPropagation();
                handleRemove(idx);
              }}
              disabled={props.disabled}
            >
              ×
            </button>
          </span>
        ))}
        <input
          ref={inputRef}
          type="text"
          className="tag-input__field"
          value={inputValue}
          onChange={handleChange}
          onKeyDown={handleKeyDown}
          onCompositionStart={handleCompositionStart}
          onCompositionEnd={handleCompositionEnd}
          onPaste={handlePaste}
          disabled={props.disabled}
          spellCheck={false}
          autoComplete="off"
          placeholder={
            props.value.length === 0
              ? props.placeholder ?? `输入 tag，回车提交（最多 ${MAX_TAGS_PER_NOTE} 个）`
              : ""
          }
        />
      </div>
      <p className="tag-input__hint">
        回车 / 半角逗号 / 全角逗号 / 空格 提交；最多 {MAX_TAGS_PER_NOTE} 个，每个 ≤ {MAX_TAG_LENGTH} 字符。
      </p>
    </div>
  );
}