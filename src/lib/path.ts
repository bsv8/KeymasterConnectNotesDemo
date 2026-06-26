// src/lib/path.ts
// note path 真值收口。
//
// 设计缘由（施工单 5.1 / 5.2 / 5.3）：
//   - path 是**绝对路径字符串**，模拟文件树。
//   - 校验规则是工程键，不是用户自由文本：
//       - 必须以 `/` 开头；
//       - 不能等于 `/`；
//       - 不能以 `/` 结尾；
//       - 不能含 `//`；
//       - segment 不能为空、不能是 `.` / `..`；
//       - 字符集 `^[a-z0-9][a-z0-9._-]*$`；
//       - path 总长 ≤ 240；单 segment ≤ 64。
//   - 写入前先 normalize 再 validate。
//   - `slugifyPathSegment` 把用户自由文本收成合法 segment。
//
// 这一层是**唯一**的 path 校验入口：UI 与 store 不许再写第二套规则。

export const MAX_PATH_LENGTH = 240;
export const MAX_SEGMENT_LENGTH = 64;
const SEGMENT_REGEX = /^[a-z0-9][a-z0-9._-]*$/;

export interface PathValidationFailure {
  code:
    | "empty"
    | "missing_leading_slash"
    | "root_only"
    | "trailing_slash"
    | "empty_segment"
    | "double_slash"
    | "dot_segment"
    | "segment_too_long"
    | "path_too_long"
    | "invalid_chars";
  message: string;
  segment?: string;
}

export type PathValidationResult =
  | { ok: true; path: string }
  | { ok: false; failure: PathValidationFailure };

/** 把用户输入的 path 收口到合法形态。不抛异常；不通过返回 failure。 */
export function normalizeNotePath(raw: string): string {
  if (typeof raw !== "string") return "";
  let value = raw.trim();
  // 合并多余斜杠：把 `//` → `/`。
  value = value.replace(/\/+/g, "/");
  // 去掉末尾斜杠（但保留单独的 `/` 给后续规则拒绝）。
  while (value.length > 1 && value.endsWith("/")) {
    value = value.slice(0, -1);
  }
  // 把大小写统一到小写；path 是工程键。
  value = value.toLowerCase();
  return value;
}

/** 校验 path 是否合法；返回 `{ ok, path }` 或 `{ ok: false, failure }`。 */
export function validateNotePath(raw: string): PathValidationResult {
  const normalized = normalizeNotePath(raw);
  if (normalized.length === 0) {
    return {
      ok: false,
      failure: { code: "empty", message: "Path is empty." }
    };
  }
  if (!normalized.startsWith("/")) {
    return {
      ok: false,
      failure: {
        code: "missing_leading_slash",
        message: "Path must start with '/'."
      }
    };
  }
  if (normalized === "/") {
    return {
      ok: false,
      failure: { code: "root_only", message: "Path cannot be just '/'." }
    };
  }
  if (normalized.endsWith("/")) {
    return {
      ok: false,
      failure: {
        code: "trailing_slash",
        message: "Path must not end with '/'."
      }
    };
  }
  if (normalized.includes("//")) {
    return {
      ok: false,
      failure: {
        code: "double_slash",
        message: "Path must not contain '//'."
      }
    };
  }
  if (normalized.length > MAX_PATH_LENGTH) {
    return {
      ok: false,
      failure: {
        code: "path_too_long",
        message: `Path must be ≤ ${MAX_PATH_LENGTH} characters.`
      }
    };
  }
  const segments = normalized.slice(1).split("/");
  for (const segment of segments) {
    if (segment.length === 0) {
      return {
        ok: false,
        failure: {
          code: "empty_segment",
          message: "Path segment cannot be empty."
        }
      };
    }
    if (segment === "." || segment === "..") {
      return {
        ok: false,
        failure: {
          code: "dot_segment",
          message: `Path segment '${segment}' is not allowed.`,
          segment
        }
      };
    }
    if (segment.length > MAX_SEGMENT_LENGTH) {
      return {
        ok: false,
        failure: {
          code: "segment_too_long",
          message: `Segment must be ≤ ${MAX_SEGMENT_LENGTH} characters.`,
          segment
        }
      };
    }
    if (!SEGMENT_REGEX.test(segment)) {
      return {
        ok: false,
        failure: {
          code: "invalid_chars",
          message: `Segment '${segment}' must match ^[a-z0-9][a-z0-9._-]*$.`,
          segment
        }
      };
    }
  }
  return { ok: true, path: normalized };
}

/**
 * 把人类可读的标题收口成合法 segment。
 * - 转小写；
 * - 把空白与标点替换为 `-`；
 * - 去掉首尾 `-` / `.` / `_`；
 * - 若首字符不是 `[a-z0-9]`，加 `n-` 前缀；
 * - 截断到 `MAX_SEGMENT_LENGTH`；
 * - 兜底空字符串为 `untitled`。
 */
export function slugifyPathSegment(input: string): string {
  let value = (input ?? "").toString().toLowerCase().normalize("NFKD");
  // 把任何非 `[a-z0-9._-]` 字符替换为 `-`。
  value = value.replace(/[^a-z0-9._-]+/g, "-");
  // 压缩连续 `-`。
  value = value.replace(/-+/g, "-");
  // 去掉首尾 `-` / `.` / `_`。
  value = value.replace(/^[-._]+|[-._]+$/g, "");
  // 截断。
  if (value.length > MAX_SEGMENT_LENGTH) {
    value = value.slice(0, MAX_SEGMENT_LENGTH);
  }
  // 保证首字符合法。
  if (value.length === 0) {
    return "untitled";
  }
  if (!/^[a-z0-9]/.test(value)) {
    value = `n-${value}`;
  }
  if (value.length > MAX_SEGMENT_LENGTH) {
    value = value.slice(0, MAX_SEGMENT_LENGTH);
  }
  // 末段再扫一次首字符。
  if (!/^[a-z0-9]/.test(value)) {
    value = `n-${value}`.slice(0, MAX_SEGMENT_LENGTH);
  }
  return value;
}

/**
 * 用 parent path + segment 拼出完整 path；若 parent 是 `/`，只返回 `/segment`。
 * 仍需走 `validateNotePath` 才能确认整体合法。
 */
export function joinNotePath(parent: string, segment: string): string {
  const base = parent === "/" ? "" : parent.replace(/\/+$/, "");
  return `${base}/${segment}`;
}

/** 把 path 切成 segments（不含前导 `/`）。 */
export function splitNotePath(path: string): string[] {
  return path.replace(/^\/+/, "").split("/").filter((s) => s.length > 0);
}

/**
 * 把所有 path 折成一棵以 `/` 为根的树。
 *
 * 设计缘由（施工单 5.x）：
 *   - 树**完全由 key path 派生**，不维护额外 folder 真值。
 *   - `children` 直接持有子节点引用，便于 UI 直接递归。
 *   - `path` 唯一标识；同 path 命中两次时折叠。
 */
export interface NoteTreeNode {
  name: string;
  path: string;
  children: NoteTreeNode[];
}

export function buildNoteTree(allPaths: string[]): NoteTreeNode {
  const root: NoteTreeNode = { name: "", path: "/", children: [] };
  const nodeByPath = new Map<string, NoteTreeNode>([["/", root]]);
  for (const path of allPaths) {
    if (path === "/") continue;
    if (nodeByPath.has(path)) continue;
    const segments = splitNotePath(path);
    let acc = "";
    let parent = root;
    for (let i = 0; i < segments.length; i += 1) {
      const seg = segments[i]!;
      acc = acc ? `${acc}/${seg}` : `/${seg}`;
      let node = nodeByPath.get(acc);
      if (!node) {
        node = { name: seg, path: acc, children: [] };
        nodeByPath.set(acc, node);
        parent.children.push(node);
      }
      parent = node;
    }
  }
  const sortRec = (node: NoteTreeNode) => {
    node.children.sort((a, b) => a.name.localeCompare(b.name));
    for (const child of node.children) sortRec(child);
  };
  sortRec(root);
  return root;
}

/** 递归判断子树里是否存在"path 命中 `visible`"的叶子。 */
export function treeContainsVisibleLeaf(node: NoteTreeNode, visible: Set<string>): boolean {
  if (node.children.length === 0) {
    return visible.has(node.path);
  }
  for (const child of node.children) {
    if (treeContainsVisibleLeaf(child, visible)) return true;
  }
  return false;
}
