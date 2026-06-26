// src/lib/notes.ts
// note record 与 editor draft 的转换；保存流程拼装。
//
// 设计缘由（施工单第 5 章 / 第 7 章）：
//   - **note record 是真值**：title / path / tags / 时间戳 / owner 公钥
//     都是明文；markdown 本体只以密文形式落库。
//   - 编辑器 draft 只在内存中存活（title / tags / markdown）；
//     一旦离开 note 就被丢弃。
//   - markdown 是**单真值**：保存时从 BlockNote 导出 markdown →
//     `cipher.encrypt` → 写入 `cipher` 字段。
//   - tag 规则：trim、去重、过滤空、转小写、最多 24 个、单 tag ≤ 32 字符。

import { normalizeNotePath, validateNotePath } from "./path";
import { slugifyPathSegment } from "./path";

/* ============== record schema ============== */

export interface StoredNoteRecord {
  v: 1;
  key: string;
  title: string;
  tags: string[];
  createdAt: number;
  updatedAt: number;
  ownerPublicKeyHex: string;
  cipher: {
    contentType: "keymaster.notes.markdown.v1";
    nonceBase64: string;
    cipherbytesBase64: string;
  };
}

export const MAX_TAGS_PER_NOTE = 24;
export const MAX_TAG_LENGTH = 32;

/** 校验 record 是否符合 schema；不合法返回 false。 */
export function isStoredNoteRecord(value: unknown): value is StoredNoteRecord {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  if (v.v !== 1) return false;
  if (typeof v.key !== "string") return false;
  if (typeof v.title !== "string") return false;
  if (!Array.isArray(v.tags)) return false;
  if (!v.tags.every((t) => typeof t === "string")) return false;
  if (typeof v.createdAt !== "number") return false;
  if (typeof v.updatedAt !== "number") return false;
  if (typeof v.ownerPublicKeyHex !== "string") return false;
  if (!v.cipher || typeof v.cipher !== "object") return false;
  const cipher = v.cipher as Record<string, unknown>;
  if (cipher.contentType !== "keymaster.notes.markdown.v1") return false;
  if (typeof cipher.nonceBase64 !== "string") return false;
  if (typeof cipher.cipherbytesBase64 !== "string") return false;
  return true;
}

/* ============== tags ============== */

export function normalizeTags(raw: string[] | string | undefined | null): string[] {
  const list = Array.isArray(raw)
    ? raw
    : (raw ?? "")
        .split(/[,\n]/)
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

/** 编辑器 draft 是前端内存态；与 record 不一一对应。 */
export interface NoteDraft {
  path: string;
  title: string;
  tags: string[];
  markdown: string;
  /** 解密是否失败：失败时 markdown 仍为旧密文时拿到的明文占位。 */
  decryptFailed: boolean;
}

export function emptyDraft(path: string): NoteDraft {
  return {
    path,
    title: "",
    tags: [],
    markdown: "",
    decryptFailed: false
  };
}

/* ============== path 生成 ============== */

/**
 * 用当前 segments 推断下一个不冲突的 path。
 * - 默认父目录 `/workspace/inbox`；
 * - segment 由 title slug 化得到；
 * - 已存在则加 `-2` / `-3` ... 后缀。
 */
export function suggestNextPath(notes: Record<string, StoredNoteRecord>, title: string): string {
  const parent = "/workspace/inbox";
  const baseSeg = slugifyPathSegment(title || "untitled");
  let candidate = `${parent}/${baseSeg}`;
  let i = 2;
  while (candidate in notes) {
    candidate = `${parent}/${baseSeg}-${i}`;
    i += 1;
  }
  // 仍走一次 validate，因为 slug 在 path context 内有可能恰好命中边界。
  const check = validateNotePath(candidate);
  if (!check.ok) {
    // 兜底：使用 `untitled` segment。
    return normalizeNotePath(`${parent}/untitled`);
  }
  return check.path;
}
