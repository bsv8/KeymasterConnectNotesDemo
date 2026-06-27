// src/lib/theme.ts
// 应用主题偏好与解析。
//
// 设计缘由：
//   - 主题只需要三态：`light` / `dark` / `system`；
//   - 现有 CSS 已经基于根节点 `data-app-theme` 出 token，因此不引入额外主题框架；
//   - 在 React 挂载前先把根节点主题落上，避免首屏先闪白再切黑。

export type AppThemePreference = "system" | "light" | "dark";
export type ResolvedAppTheme = "light" | "dark";

const APP_THEME_STORAGE_KEY = "notes-demo:theme-preference";
const SYSTEM_THEME_MEDIA_QUERY = "(prefers-color-scheme: dark)";

/** 读取用户主题偏好；非法值直接回退到 `system`。 */
export function loadAppThemePreference(): AppThemePreference {
  try {
    const value = globalThis.localStorage?.getItem(APP_THEME_STORAGE_KEY);
    if (value === "light" || value === "dark" || value === "system") return value;
  } catch {
    // best-effort：读取失败不阻断应用启动。
  }
  return "system";
}

/** 记录用户主题偏好；失败时静默忽略。 */
export function saveAppThemePreference(preference: AppThemePreference): void {
  try {
    globalThis.localStorage?.setItem(APP_THEME_STORAGE_KEY, preference);
  } catch {
    // best-effort：写失败不影响当前会话主题切换。
  }
}

/** 解析系统主题；无 `matchMedia` 时保守回退到 `light`。 */
export function resolveSystemTheme(): ResolvedAppTheme {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
    return "light";
  }
  return window.matchMedia(SYSTEM_THEME_MEDIA_QUERY).matches ? "dark" : "light";
}

/** 把三态偏好解析成真正落到页面上的黑/白主题。 */
export function resolveAppTheme(preference: AppThemePreference): ResolvedAppTheme {
  if (preference === "system") return resolveSystemTheme();
  return preference;
}

/** 返回系统主题媒体查询对象；供 React 订阅系统黑白切换。 */
export function getSystemThemeMediaQuery(): MediaQueryList | null {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
    return null;
  }
  return window.matchMedia(SYSTEM_THEME_MEDIA_QUERY);
}

/** 把已解析的主题写入根节点，让整站 token 一次性切换。 */
export function applyResolvedAppTheme(theme: ResolvedAppTheme): void {
  if (typeof document === "undefined") return;
  document.documentElement.dataset.appTheme = theme;
}
