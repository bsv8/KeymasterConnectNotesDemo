// src/lib/notes.ts
// folder / note record schema + draft / tag / title 规则。
//
// 设计缘由（施工单第 4-6 章）：
//   - folder 与 note 都是显式实体；底层真值是 `id + parentId/folderId + title`，
//     **不再**以完整 path 为主键。
//   - markdown 正文是单真值，但**仅以密文**落库；title / tags / 时间戳是明文。
//   - ownerPublicKeyHex 写在最外层 storage key 上，record 自身不重复携带。
//   - title 是用户感知上的"文件名"——允许任意字符串，但底线：非空、trim 后非空。
//   - tag 规则：`trim` → 过滤空 → 转小写 → 去重 → 截断到上限。

/* ============== record schema ============== */

export interface StoredFolderRecord {
  v: 1;
  id: string;
  /** 父文件夹 id；根目录下的文件夹为 `null`。 */
  parentId: string | null;
  title: string;
  createdAt: number;
  updatedAt: number;
}

export interface StoredNoteRecord {
  v: 2;
  id: string;
  /** 所属文件夹 id；根目录下的笔记为 `null`。 */
  folderId: string | null;
  title: string;
  tags: string[];
  createdAt: number;
  updatedAt: number;
  cipher: {
    contentType: "keymaster.notes.markdown.v1";
    nonceBase64: string;
    cipherbytesBase64: string;
  };
}

export const NOTE_CONTENT_TYPE = "keymaster.notes.markdown.v1";

/** 校验 record 是否符合 schema；不合法返回 false。 */
export function isStoredFolderRecord(value: unknown): value is StoredFolderRecord {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  if (v.v !== 1) return false;
  if (typeof v.id !== "string" || v.id.length === 0) return false;
  if (v.parentId !== null && typeof v.parentId !== "string") return false;
  if (typeof v.title !== "string") return false;
  if (typeof v.createdAt !== "number") return false;
  if (typeof v.updatedAt !== "number") return false;
  return true;
}

/** 校验 record 是否符合 schema；不合法返回 false。 */
export function isStoredNoteRecord(value: unknown): value is StoredNoteRecord {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  if (v.v !== 2) return false;
  if (typeof v.id !== "string" || v.id.length === 0) return false;
  if (v.folderId !== null && typeof v.folderId !== "string") return false;
  if (typeof v.title !== "string") return false;
  if (!Array.isArray(v.tags)) return false;
  if (!v.tags.every((t) => typeof t === "string")) return false;
  if (typeof v.createdAt !== "number") return false;
  if (typeof v.updatedAt !== "number") return false;
  if (!v.cipher || typeof v.cipher !== "object") return false;
  const cipher = v.cipher as Record<string, unknown>;
  if (cipher.contentType !== NOTE_CONTENT_TYPE) return false;
  if (typeof cipher.nonceBase64 !== "string") return false;
  if (typeof cipher.cipherbytesBase64 !== "string") return false;
  return true;
}

/* ============== title ============== */

export interface TitleValidationFailure {
  code: "empty";
  message: string;
}

export type TitleValidationResult =
  | { ok: true; title: string }
  | { ok: false; failure: TitleValidationFailure };

/**
 * 校验 title：trim 后必须非空。
 * 这是施工单要求的唯一底线；不再限制字符集 / 长度 / 路径合法。
 */
export function validateTitle(raw: string): TitleValidationResult {
  const trimmed = (raw ?? "").trim();
  if (trimmed.length === 0) {
    return {
      ok: false,
      failure: { code: "empty", message: "标题（文件名）不能为空。" }
    };
  }
  return { ok: true, title: trimmed };
}

/** 仅用于"建议初始名"；不做硬约束。 */
export function normalizeTitle(raw: string): string {
  return (raw ?? "").toString().trim();
}

/* ============== tags ============== */

export const MAX_TAGS_PER_NOTE = 24;
export const MAX_TAG_LENGTH = 32;

/**
 * 把任意字符串 / 数组归一为 tag 数组：
 *   - 支持分隔符：半角逗号 `,`、全角逗号 `，`、空格、换行；
 *   - `trim` → 过滤空 → 转小写 → 去重 → 单 tag ≤ 32 字符 → 总数 ≤ 24。
 */
export function normalizeTags(raw: string[] | string | undefined | null): string[] {
  const list = Array.isArray(raw)
    ? raw
    : (raw ?? "")
        .split(/[,，\s\n]+/)
        .map((s) => s.trim())
        .filter((s) => s.length > 0);
  const seen = new Set<string>();
  const out: string[] = [];
  for (const tag of list) {
    const trimmed = tag.trim();
    if (trimmed.length === 0) continue;
    const lowered = trimmed.toLowerCase();
    if (lowered.length > MAX_TAG_LENGTH) continue;
    if (seen.has(lowered)) continue;
    seen.add(lowered);
    out.push(lowered);
    if (out.length >= MAX_TAGS_PER_NOTE) break;
  }
  return out;
}

/* ============== editor draft ============== */

/**
 * 编辑器 draft 是前端内存态；与 record 不一一对应。
 * 新建态：`noteId === null`；选中已有 note：`noteId !== null`。
 */
export interface NoteDraft {
  noteId: string | null;
  title: string;
  tags: string[];
  markdown: string;
  /** 解密是否失败：失败时 markdown 仍为旧密文时拿到的明文占位。 */
  decryptFailed: boolean;
}

export function emptyDraft(): NoteDraft {
  return {
    noteId: null,
    title: "",
    tags: [],
    markdown: "",
    decryptFailed: false
  };
}

/* ============== id 生成 ============== */

export function makeRecordId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `id-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}