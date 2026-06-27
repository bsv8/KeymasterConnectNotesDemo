// src/i18n/languageMap.ts
// 浏览器语言归一与映射到系统支持语言。
//
// 设计缘由（施工单 2026-06-27 005-i18n-header-language-switch 4.3 / 5.2 章）：
//   - 浏览器语言标签（`navigator.language` / `navigator.languages`）经常是
//     区域化的（`en-US` / `zh-HK` / `ja-JP`），需要归一到系统支持的少数语言。
//   - 规则固定：
//       - `en` / `en-*`      → `en`
//       - `zh` / `zh-*`      → `zh-CN`（`zh-TW` / `zh-HK` 也归到这里）
//       - `ja` / `ja-*`      → `ja`
//       - 其他所有           → `en`
//   - 不做地域猜测、IP 推断、时区推断或更细分脚本标签分流。
//   - **不**混入 localStorage 逻辑、**不**直接读 DOM、**不**原样返回浏览器标签。

import type { SupportedLanguage } from "./types";

const DEFAULT_LANGUAGE: SupportedLanguage = "en";

/**
 * 解析单个浏览器语言标签到系统支持语言。
 *
 * 接受 `navigator.language` 等任意输入（含区域后缀），
 * 归一到 `en` / `zh-CN` / `ja`；不在白名单统一回退 `en`。
 *
 * 规则（按 4.3 章硬定义）：
 *   - 空字符串 / 非法字符串 → 默认语言；
 *   - `en` / `en-XX`        → `en`；
 *   - `zh` / `zh-XX`        → `zh-CN`（含 `zh-TW` / `zh-HK` / `zh-Hans`）；
 *   - `ja` / `ja-XX`        → `ja`；
 *   - 其他                   → `en`。
 */
export function resolveLanguageTag(tag: string | null | undefined): SupportedLanguage {
  if (!tag || typeof tag !== "string") return DEFAULT_LANGUAGE;
  const lower = tag.toLowerCase().trim();
  if (lower.length === 0) return DEFAULT_LANGUAGE;
  if (lower === "en" || lower.startsWith("en-")) return "en";
  if (lower === "zh" || lower.startsWith("zh-")) return "zh-CN";
  if (lower === "ja" || lower.startsWith("ja-")) return "ja";
  return DEFAULT_LANGUAGE;
}

/**
 * 从浏览器声明的语言列表里挑出第一个系统支持的语言。
 *
 * 设计缘由：
 *   - `navigator.languages` 是用户优先级排序的列表；
 *   - 第一项是当前 UI 语言，但用户可能已经加入其他语言；
 *   - 遍历到第一个支持项；都不支持时回退默认。
 */
export function resolveBrowserLanguage(): SupportedLanguage {
  if (typeof navigator === "undefined") return DEFAULT_LANGUAGE;
  const candidates: string[] = [];
  if (typeof navigator.language === "string" && navigator.language.length > 0) {
    candidates.push(navigator.language);
  }
  if (Array.isArray(navigator.languages)) {
    for (const lang of navigator.languages) {
      if (typeof lang === "string" && lang.length > 0) candidates.push(lang);
    }
  }
  for (const tag of candidates) {
    const resolved = resolveLanguageTag(tag);
    if (resolved) return resolved;
  }
  return DEFAULT_LANGUAGE;
}

/** 暴露给 store 使用的"无外部依赖默认语言"——服务端 / 测试场景兜底。 */
export const FALLBACK_LANGUAGE: SupportedLanguage = DEFAULT_LANGUAGE;