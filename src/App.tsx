// src/App.tsx
// Notes Demo 页面级状态与编排。
//
// 设计缘由（施工单 2026-06-26 save-switch-current-editor-state 第 4-10 章 +
//          施工单 2026-06-27 note-open-cancel-and-transport-hard-switch
//          第 4-10 章 +
//          施工单 2026-06-27 notion-document-toolbar-and-mobile-sidebar
//          第 3 / 4 / 5 / 6 章 +
//          施工单 2026-06-27 note-search-results-and-tree-expand-persistence
//          第 4-11 章）：
//   - 顶层固定二态：`identity === null` 时只渲染 `LockScreen`；已登录才渲染工作区。
//   - **当前编辑内存态单真值**：整页只允许存在一份"当前正在编辑的内存态"
//     `currentEditorState`。它同时承担：
//       - 当前正在编辑哪条 note（持久化 note 或尚未落库的新建 note）；
//       - 当前 title / tags / markdown；
//       - 当前已保存基线（baseline）；
//       - 是否 `decryptFailed`。
//   - **不再**有 `pendingDrafts` 这套并行容器——新建 note 一出现就只活在
//     `currentEditorState`（`kind: "new"`），第一次成功保存后变 `kind: "persisted"`。
//   - **不再**有 `decryptedCacheRef`——`baseline.markdown` 就是上次解密缓存的明文。
//   - **不再**用 effect 监听 `space.notes` 变化来覆盖编辑器：
//     hydration 只在 selection 真正变化到另一个 note 时跑一次；
//     save 成功只 patch `currentEditorState.baseline`，不重选 note、不重灌。
//   - **保存阻塞态**统一收口在 `saveOverlay`：用户点击"加密保存"或"保存并切换"时，
//     页面进入阻塞遮罩，等待 Keymaster 许可；按钮集合随 mode 区分。
//   - **切换拦截**：未保存修改时点击其他 note / folder / root，弹"保存并切换"遮罩，
//     不静默切换；decryptFailed 时直接允许切走（无未保存修改）。
//   - **新建 note** 默认 title 已存在 + save 立即可点；不向 `space.notes` 写空密文占位。
//   - **文件树标题**：已保存 note 显示 `space.notes` 的 title；当前未保存新 note
//     显示 `currentEditorState.title`（以 `ephemeralNote` 形式注入 sidebar）。
//   - 持久化真值 = `space.folders + space.notes`（localStorage）。
//   - 退出工作区时统一收口清空内存态（包含 `currentEditorState` / `saveOverlay`）。
//   - 命名交互：新建文件夹 / 重命名文件夹 / 重命名 note 全部走 `NameInputDialog`；
//     新建时若重名走自动补编号；重命名时若重名直接阻断。
//   - **note 打开链路不再串行排队**（施工单 2026-06-27）：
//       - `openPersistedNote` 不再 `await previous`——切 note 时立即发新 decrypt；
//       - 旧 pending decrypt 立即 `cancelRequest(oldId)`（fire-and-forget）；
//       - 业务层只关心"当前打开代际"+"当前正在等的 decrypt requestId"；
//       - 旧请求晚回来的结果一律丢弃（代际隔离）；
//       - popup session client 已是 multi-pending，不再有 `session_busy`；
//       - 当前 note 切到 folder / root / 切换 owner / 退出工作区时，
//         也要对旧 pending decrypt 发 cancel，并清空代际。
//   - **硬切换后的工作区布局**（施工单 2026-06-27 notion-document-toolbar）：
//       - 顶层：header → banner → workspace；
//       - workspace = sidebar + document-panel 两栏，不再有右栏 inspector；
//       - document-panel 内部固定 = document-toolbar → document-head →
//         document-editor；title 回到 document-head；
//       - 应用级提示（lastError / decryptError / 移动模式）统一进 banner；
//       - saveOverlay 仍是阻塞遮罩，不被降级成 banner；
//       - sidebar 内不再保留移动模式横条（搬至 banner）；
//       - 选中 folder 时 sidebar 根目录上方显示简化 folder 工具条；
//       - 窄屏下文件树支持手工展开 / 收起；选中 root / folder / note 后自动收起。
//   - **搜索 / tag 过滤 / 文件树开合的硬切换**（施工单 2026-06-27）：
//       - sidebar **不再**用 `searchQuery` / `activeTag` 过滤——树永远展示真实完整树。
//       - 搜索 / tag 过滤**只**驱动右侧"搜索结果页"（SearchResultsPanel）；
//       - `isSearchMode = searchQuery.trim() !== "" || activeTag !== null` 时，
//         文档区切到搜索结果页；否则回到现有 note / folder / root 视图。
//       - 搜索结果只包含 note（不含 folder），按树自然顺序排列。
//       - 结果项固定两行：标题（大字）+ path（小字）。
//       - 文件树 folder **真实可开合**：`expandedFolderIds: Set<string>` 由 App
//         持有单真值，sidebar 只接收 + 回调开合。
//       - folder 行点击 = 只选中；folder 前开合按钮 = 只展开/折叠。
//       - `expandedFolderIds` **按 owner 分区持久化**到 localStorage
//         （`notes-demo:sidebar:{publicKeyHex}`），不写进 `StoredNotesSpace`。
//       - 加载时：缺失/非法值 → 默认全部展开；已不存在的 folderId 静默丢弃。
//       - 点击搜索结果后：走 `trySelect`；切换**成功**后再把"祖先路径"
//         写进 `expandedFolderIds`。
//       - folder 删除 / 重命名 / 移动时：根据 id 是否还在 tree 里清理无效 id。

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { normalizeOrigin, ProtocolTransportError, type ProtocolLogEvent } from "./lib/connectClient";
import { PopupSessionClient } from "./lib/popupSessionClient";
import type { ProtocolErrorCode } from "./lib/protocol";
import {
  buildCipherDecryptRequest,
  buildCipherEncryptRequest,
  buildIdentityGetRequest,
  parseCipherDecryptResult,
  parseCipherEncryptResult,
  parseIdentityResult
} from "./lib/keymaster";
import {
  NOTE_CONTENT_TYPE,
  normalizeTags,
  validateTitle,
  type NoteDraft,
  type StoredFolderRecord,
  type StoredNoteRecord
} from "./lib/notes";
// 注：`emptyDraft` 不再被使用——编辑真值统一收口到 `currentEditorState`。
import {
  createFolder,
  deleteFolder,
  deleteNote,
  deleteOwnerSpace,
  findAvailableName,
  getFolder,
  isFolderEmpty,
  isFolderTitleConflict,
  isNoteTitleConflict,
  loadOwnerSpace,
  moveFolder,
  moveNote,
  putNote,
  renameFolder,
  saveOwnerSpace,
  type StoredNotesSpace
} from "./lib/storage";
import {
  ancestorFolderIds,
  buildTree,
  checkDragLegality,
  collectNotesInTreeOrder,
  describeDragLegalityReason,
  folderPathLabel
} from "./lib/path";
import {
  applyResolvedAppTheme,
  getSystemThemeMediaQuery,
  loadAppThemePreference,
  resolveSystemTheme,
  saveAppThemePreference,
  type AppThemePreference
} from "./lib/theme";
import {
  loadOwnerSidebarState,
  saveOwnerSidebarState
} from "./lib/sidebarState";
import { ConnectStatus, type PopupUiState } from "./components/ConnectStatus";
import { NotesSidebar, type FolderAction, type MoveState, type NoteAction, type RootAction, type SidebarContextMenuState, type SidebarSelection } from "./components/NotesSidebar";
import { NoteEditor } from "./components/NoteEditor";
import { DocumentToolbar } from "./components/DocumentToolbar";
import { LockScreen } from "./components/LockScreen";
import { NameInputDialog } from "./components/NameInputDialog";
import { SaveOverlayDialog } from "./components/SaveOverlayDialog";
import { SearchResultsPanel, buildSearchResults } from "./components/SearchResultsPanel";

/** 新建 note / folder 的默认基名（自动补编号时按 "基名 N" 递增）。 */
const DEFAULT_NOTE_BASE_NAME = "新 note";
const DEFAULT_FOLDER_BASE_NAME = "新文件夹";

const DEFAULT_TARGET_ORIGIN = "https://keymaster.cc";
const READY_TIMEOUT_MS = 10_000;
const RESULT_TIMEOUT_MS = 60_000;
const POPUP_WIDTH = 520;
const POPUP_HEIGHT = 760;

/** 窄屏判定阈值：与 styles.css 中的媒体查询保持一致。 */
const MOBILE_BREAKPOINT = 720;

interface IdentitySnapshot {
  publicKeyHex: string;
  claims: Record<string, unknown>;
  resolvedAt: number;
}

/**
 * 当前编辑内存态：全页唯一。
 * 边界：永远只存在 0 份或 1 份；不进 localStorage。
 *
 * - `kind: "new"`：尚未落库的新建 note；保存成功后变 `kind: "persisted"`。
 * - `kind: "persisted"`：与 `space.notes[id]` 一一对应。
 *   `baseline` 记录的是"最近一次解密/保存时的快照"——dirty 比较的基线。
 * - `loading: true` 时正在解密 / 加载中，markdown 是占位符；
 *   该状态下**不能**视为 dirty、**不能**编辑、**不能**保存。
 * - `decryptFailed: true` 时 markdown 不可编辑；title / tags 也被锁住。
 *
 * 设计缘由（施工单 2026-06-26 save-switch-current-editor-state 第 4.2 / 5 章 +
 *          后续修复："解密中..." 占位态不能被算成 dirty）：
 *   - 这是页面"编辑真值"的唯一来源。
 *   - 文件树 / 持久层 / 侧栏都派生自此 + `space.notes`；不互相反向覆盖。
 *   - `loading` 与 `decryptFailed` 是两个独立维度：loading 是过程，decryptFailed 是结果。
 */
export interface CurrentEditorState {
  /** 该 note 的 id。`kind: "new"` 时是新生成的临时 id（首次保存后变 persisted id）。 */
  noteId: string;
  kind: "new" | "persisted";
  /** 所属文件夹 id；根目录下为 null。 */
  folderId: string | null;
  /** 当前 title（用户可编辑；loading / decryptFailed / saving 时锁住）。 */
  title: string;
  /** 当前 tags（用户可编辑；loading / decryptFailed / saving 时锁住）。 */
  tags: string[];
  /** 当前 markdown（用户可编辑；loading / decryptFailed / saving 时锁住）。 */
  markdown: string;
  /** 已保存基线：title / tags / markdown 跟这里比对决定 dirty。 */
  baseline: {
    title: string;
    tags: string[];
    markdown: string;
  };
  /**
   * 是否处于"加载中"（仅 `kind: "persisted"` 才有意义）：
   * 切换 note 后 `openPersistedNote` 同步置 true，await 解密完才置 false。
   * `kind: "new"` 永远 false。
   */
  loading: boolean;
  /** 解密失败态。 */
  decryptFailed: boolean;
}

interface PendingDialog {
  title: string;
  message: string;
  /** 阻断动作；confirm 后回到正常态。 */
  onDismiss: () => void;
}

interface ConfirmDialog {
  title: string;
  message: string;
  onConfirm: () => void;
  onCancel: () => void;
  confirmLabel: string;
  cancelLabel: string;
}

/**
 * "保存成功之后要做的事"：
 *   - `none`：什么都不做（主动保存路径）；
 *   - `switch`：切到 `target`；
 *   - `create-note`：在 `parentId` 下创建新 note。
 */
type AfterSaveAction =
  | { kind: "none" }
  | { kind: "switch"; target: SidebarSelection }
  | { kind: "create-note"; parentId: string | null };

/**
 * 保存阻塞遮罩状态机。
 *   - `mode: "save"`：用户主动点 save；按钮只有 `取消`；成功后停留在 action。
 *   - `mode: "save-and-switch"`：用户有未保存修改并尝试切换 / 新建；
 *     按钮只有 `保存并切换` / `取消`；保存成功后按 `action` 派发。
 *
 * `action` 在两种模式下都有意义——`save` 模式下也是 `none`（停留）。
 */
interface SaveOverlayState {
  mode: "save" | "save-and-switch";
  action: AfterSaveAction;
}

/**
 * 页面内命名弹层的输入定义。
 */
type NameDialogMode =
  | {
      kind: "create-folder";
      parentId: string | null;
    }
  | {
      kind: "rename-folder";
      folderId: string;
    }
  | {
      kind: "rename-note";
      noteId: string;
    };

interface NameDialogState {
  mode: NameDialogMode;
  title: string;
  description?: string;
  initialValue: string;
  placeholder?: string;
  confirmLabel: string;
}

export default function App() {
  const currentOrigin = typeof window === "undefined" ? "" : window.location.origin;

  /* ============== 状态真值 ============== */

  const [targetOrigin, setTargetOrigin] = useState(DEFAULT_TARGET_ORIGIN);
  const [popupState, setPopupState] = useState<PopupUiState>("idle");
  const [identity, setIdentity] = useState<IdentitySnapshot | null>(null);
  const [isLoggingIn, setIsLoggingIn] = useState(false);
  const [lastError, setLastError] = useState<string | null>(null);

  /** 持久化真值：folder + 已落库 note。 */
  const [space, setSpace] = useState<StoredNotesSpace>({ v: 1, folders: {}, notes: {} });

  /**
   * 侧栏高亮：folder / root / note。note 选中态一定与 `currentEditorState.noteId` 同步。
   * folder / root 选中态是独立的"上一次点过的位置"。
   */
  const [selection, setSelection] = useState<SidebarSelection>({ kind: "root", id: null });

  /**
   * 当前编辑内存态：全页唯一。null = 没有正在编辑的 note。
   * 边界：永远只存在 0 份或 1 份；不进 localStorage；切换 note 时整块替换。
   */
  const [currentEditorState, setCurrentEditorState] = useState<CurrentEditorState | null>(null);
  /**
   * 镜像 `currentEditorState` 的 ref。
   * - 在每个 setCurrentEditorState 之后同步写入；
   * - 让 `openPersistedNote` 的异步分支能读到"截至此刻的"最新 noteId，
   *   避免 stale closure 误判"应该应用结果"。
   */
  const currentEditorStateRef = useRef<CurrentEditorState | null>(null);

  /** 解密错误文案（用于 banner 摘要 + 文档区提示）。 */
  const [decryptError, setDecryptError] = useState<string | null>(null);

  /** 保存阻塞遮罩。null = 不显示。 */
  const [saveOverlay, setSaveOverlay] = useState<SaveOverlayState | null>(null);

  const [pendingDialog, setPendingDialog] = useState<PendingDialog | null>(null);
  const [confirmDialog, setConfirmDialog] = useState<ConfirmDialog | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [activeTag, setActiveTag] = useState<string | null>(null);
  /** 主题偏好三态：白 / 黑 / 跟随系统。 */
  const [themePreference, setThemePreference] = useState<AppThemePreference>(() =>
    loadAppThemePreference()
  );
  /** 系统黑白态单独镜像，避免 theme=system 时把系统查询逻辑散落到渲染分支。 */
  const [systemTheme, setSystemTheme] = useState<"light" | "dark">(() => resolveSystemTheme());

  const [contextMenu, setContextMenu] = useState<SidebarContextMenuState | null>(null);
  const [dragging, setDragging] = useState<
    | { kind: "folder" | "note"; id: string }
    | null
  >(null);
  const [dropHover, setDropHover] = useState<
    | { kind: "folder" | "root"; id: string | null }
    | null
  >(null);
  const [moveState, setMoveState] = useState<MoveState | null>(null);
  /**
   * folder 展开状态：单真值。**不**写进 `StoredNotesSpace`（那是业务真值）；
   * 持久化走 `sidebarState.ts`（按 owner 分区）。
   *
   * 设计缘由（施工单 2026-06-27 第 4.6 / 4.7 章）：
   *   - folder / note 手动开合只改这份；
   *   - 点击搜索结果后自动展开祖先路径也只改这份；
   *   - **不**再维护并行的"临时 auto expanded"状态。
   */
  const [expandedFolderIds, setExpandedFolderIds] = useState<Set<string>>(
    () => new Set<string>()
  );
  /** 页面内命名弹层：null = 不显示。 */
  const [nameDialog, setNameDialog] = useState<NameDialogState | null>(null);

  /**
   * 窄屏文件树开合状态。null = 还未初始化（用窗口宽度判定初始值）。
   * - 桌面端（>= MOBILE_BREAKPOINT）始终视为"展开"，但 state 仍为 null 时
   *   UI 也按"展开"处理；这避免桌面端误收起。
   * - 窄屏（< MOBILE_BREAKPOINT）默认收起；用户点"目录"按钮时展开；
   *   选中 root / folder / note 后自动收起；用户可再次手动展开。
   */
  const [isSidebarOpenOnMobile, setIsSidebarOpenOnMobile] = useState<boolean | null>(null);

  const sessionRef = useRef<PopupSessionClient | null>(null);
  /**
   * 用户在 save 遮罩上点 `取消` 的标志。
   * 见 `performSave` / `handleSaveOverlayCancel` 详细设计缘由。
   */
  const saveCancelledRef = useRef(false);
  /**
   * 递增的"当前打开操作"id。每次 `openPersistedNote` 调用都自增并捕获。
   * 异步结果回来时，只有 `openOperationRef.current === myOp` 的那次才允许应用结果；
   * 否则丢弃（用户已切到别的 note，或当前 note 已被更新打开）。
   *
   * 切到 folder / root、退出工作区、切换 owner 时也要自增——
   * 这样任何"晚回来的旧 decrypt"都会落在过期代际上被静默收尾。
   */
  const openOperationRef = useRef(0);
  /**
   * 当前正在等待的 decrypt request 引用。
   * - key 字段（`requestId` / `noteId` / `generation`）让"打开结果回来时"
   *   能精确判断这一条是否仍是当前代际、是否是当前 note 的请求。
   * - 切 note 时由新 `openPersistedNote` 覆盖；切 folder / root / 切 owner /
   *   退出工作区时由 `cancelCurrentPendingDecrypt()` 清空。
   * - 旧请求被 cancel 后**仍可能**回结果（protocol 没有 ack）；代际隔离保证
   *   它们不会写回 UI。
   */
  const pendingDecryptRef = useRef<{
    requestId: string;
    noteId: string;
    generation: number;
  } | null>(null);

  const normalizedTargetOrigin = useMemo(() => {
    try {
      return normalizeOrigin(targetOrigin);
    } catch {
      return "";
    }
  }, [targetOrigin]);

  /** 当前真正生效到页面与编辑器的主题。 */
  const resolvedTheme = useMemo(
    () => (themePreference === "system" ? systemTheme : themePreference),
    [themePreference, systemTheme]
  );

  /* ============== session client 单例 ============== */

  function getSessionClient(): PopupSessionClient {
    if (!sessionRef.current) {
      sessionRef.current = new PopupSessionClient({
        targetOrigin: normalizedTargetOrigin || targetOrigin,
        popupWidth: POPUP_WIDTH,
        popupHeight: POPUP_HEIGHT,
        readyTimeoutMs: READY_TIMEOUT_MS,
        resultTimeoutMs: RESULT_TIMEOUT_MS,
        onLog: (event) => pushLog(event),
        onConnectionStateChange: (state) => setPopupState(state as PopupUiState)
      });
    }
    return sessionRef.current;
  }

  // 切换 targetOrigin 时重建 session。
  useEffect(() => {
    if (sessionRef.current) {
      sessionRef.current.closeSession();
      sessionRef.current = null;
      setPopupState("idle");
    }
  }, [targetOrigin]);

  /**
   * 订阅系统黑白切换。
   *
   * 设计缘由：
   *   - 只有 theme=system 时需要响应，但监听本身保持常驻更简单；
   *   - 真正是否采用系统值，由 `resolvedTheme` 的 useMemo 决定。
   */
  useEffect(() => {
    const media = getSystemThemeMediaQuery();
    if (!media) return;
    const handleChange = () => setSystemTheme(media.matches ? "dark" : "light");
    handleChange();
    media.addEventListener("change", handleChange);
    return () => media.removeEventListener("change", handleChange);
  }, []);

  /** 主题偏好持久化 + 根节点 dataset 同步。 */
  useEffect(() => {
    saveAppThemePreference(themePreference);
    applyResolvedAppTheme(resolvedTheme);
  }, [themePreference, resolvedTheme]);

  useEffect(() => {
    return () => {
      sessionRef.current?.closeSession();
      sessionRef.current = null;
    };
  }, []);

  // 全局点击 / 滚动时关闭右键菜单。
  useEffect(() => {
    if (!contextMenu) return;
    const dismiss = () => setContextMenu(null);
    window.addEventListener("click", dismiss);
    window.addEventListener("scroll", dismiss, true);
    window.addEventListener("resize", dismiss);
    return () => {
      window.removeEventListener("click", dismiss);
      window.removeEventListener("scroll", dismiss, true);
      window.removeEventListener("resize", dismiss);
    };
  }, [contextMenu]);

  // 同步 `currentEditorState` 到 ref，让异步分支能读到最新值。
  useEffect(() => {
    currentEditorStateRef.current = currentEditorState;
  }, [currentEditorState]);

  /**
   * 监听窗口尺寸，决定"是否处于窄屏"。
   * - 桌面端强制 `isSidebarOpenOnMobile = true`（让 sidebar 永远显示）；
   * - 窄屏下：state 保留为用户的最新选择（首次进入窄屏时初始化为 false）。
   *
   * 设计缘由（施工单 2026-06-27 第 5.2 / 8.1 章）：
   *   - 桌面端"开合状态"不参与视觉收口，仅窄屏使用；
   *   - 在窄屏下：用户点目录按钮 = 展开；用户再点 = 收起；
   *   - 在窄屏下：选中 root / folder / note = 自动收起；
   *   - 用户后续可再次手工展开（不会被永远锁死）。
   */
  useEffect(() => {
    if (typeof window === "undefined") return;
    const evaluate = () => {
      const isMobile = window.innerWidth < MOBILE_BREAKPOINT;
      if (!isMobile) {
        // 桌面端：永远展开，state 置 true。
        if (isSidebarOpenOnMobile !== true) setIsSidebarOpenOnMobile(true);
        return;
      }
      // 窄屏：首次进入窄屏时若 state 仍为 null，初始化为收起。
      if (isSidebarOpenOnMobile === null) {
        setIsSidebarOpenOnMobile(false);
      }
    };
    evaluate();
    window.addEventListener("resize", evaluate);
    return () => window.removeEventListener("resize", evaluate);
  }, [isSidebarOpenOnMobile]);

  /* ============== 加载当前 owner 的空间 ============== */

  useEffect(() => {
    if (!identity) {
      setSpace({ v: 1, folders: {}, notes: {} });
      setSelection({ kind: "root", id: null });
      setCurrentEditorState(null);
      setDecryptError(null);
      saveCancelledRef.current = false;
      // 重置代际 / pending 引用：旧 owner 留下的链上 promise 全部过期。
      openOperationRef.current = 0;
      pendingDecryptRef.current = null;
      setExpandedFolderIds(new Set());
      return;
    }
    const loaded = loadOwnerSpace(identity.publicKeyHex);
    setSpace(loaded);
    setSelection({ kind: "root", id: null });
    setCurrentEditorState(null);
    setDecryptError(null);
    saveCancelledRef.current = false;
    openOperationRef.current = 0;
    pendingDecryptRef.current = null;
    // 加载当前 owner 的 sidebar 展开状态：
    //   - 无记录 / 非法 → 全部展开（默认行为，匹配"硬切换前"用户感知）；
    //   - 有记录 → 与当前 folders 取交集，静默丢弃已不存在的 id。
    const persistedExpanded = loadOwnerSidebarState(identity.publicKeyHex);
    if (persistedExpanded === null) {
      // 首次进入：默认所有 folder 展开。
      setExpandedFolderIds(new Set(Object.keys(loaded.folders)));
    } else {
      const valid = persistedExpanded.filter((id) => Boolean(loaded.folders[id]));
      setExpandedFolderIds(new Set(valid));
    }
  }, [identity?.publicKeyHex]);

  /**
   * `expandedFolderIds` 变化后**仅在已登录**时写回 localStorage。
   * 设计缘由（施工单 2026-06-27 第 4.7 / 5.5 章）：
   *   - 已不存在的 folderId 在加载时已过滤；这里**也**在 `space.folders`
   *     变化时清理（见下方 effect）。
   *   - 退出工作区时 identity 变 null，effect 不会再触发写回，避免脏写。
   */
  useEffect(() => {
    if (!identity) return;
    saveOwnerSidebarState(identity.publicKeyHex, [...expandedFolderIds]);
  }, [expandedFolderIds, identity?.publicKeyHex]);

  /**
   * `space.folders` 变化（删除 / 重命名 / 移动）后，清理 `expandedFolderIds`
   * 里已不存在的 id。
   *
   * 规则（施工单 2026-06-27 第 5.5 章）：
   *   - folder 删除 → id 不在 `space.folders` → 移除；
   *   - folder 重命名 / 移动 → id 不变 → 保留；
   *   - 清理时若发现**任何**不一致，触发一次状态更新（避免 setState 浅比较
   *     误判"已最新"导致脏数据长期残留）。
   */
  useEffect(() => {
    setExpandedFolderIds((prev) => {
      let changed = false;
      const next = new Set<string>();
      for (const id of prev) {
        if (space.folders[id]) {
          next.add(id);
        } else {
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, [space.folders]);

  /* ============== 日志 ============== */

  function pushLog(event: ProtocolLogEvent) {
    const prefix = `[notes-demo][${event.method ?? "system"}][${event.stage}]`;
    if (event.stage === "timeout" || event.stage === "busy_rejected") {
      console.error(prefix, event);
    } else {
      console.debug(prefix, event);
    }
  }

  /* ============== 登录 ============== */

  const handleLogin = useCallback(async () => {
    if (!normalizedTargetOrigin) {
      setLastError("Target origin 非法。");
      return;
    }
    setIsLoggingIn(true);
    setLastError(null);
    try {
      const session = getSessionClient();
      const requestId = makeRequestId();
      const request = buildIdentityGetRequest({
        origin: currentOrigin,
        text: "向 Notes Demo 提供身份以解锁加密笔记",
        ttlSeconds: 300,
        requestId
      });
      const response = await session.runRequest(request);
      if (!response.ok) {
        setLastError(formatProtocolError(response.error.code, response.error.message));
        setIsLoggingIn(false);
        return;
      }
      const parsed = parseIdentityResult(response.result as never);
      setIdentity({
        publicKeyHex: parsed.publicKeyHex,
        claims: parsed.claims as Record<string, unknown>,
        resolvedAt: parsed.resolvedAt
      });
      setPopupState("connected");
    } catch (err) {
      setLastError(formatTransportError(err));
    } finally {
      setIsLoggingIn(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [normalizedTargetOrigin, currentOrigin]);

  /* ============== 切换拦截 ============== */

  /**
   * 侧栏点击 → 选中目标。
   *
   * 返回值：
   *   - `true` = 切换"已应用"（或同 note no-op + 展开祖先），调用方可以
   *     继续推进后续副作用（例如清掉搜索态）；
   *   - `false` = 切换被"未保存拦截"阻断（保存遮罩已弹出），调用方**不**
   *     要做任何推进——保持结果页与当前编辑状态一致。
   *
   * 设计缘由（施工单 2026-06-26 save-switch-current-editor-state 第 5.2 / 7.4 章 +
   *          施工单 2026-06-27 note-search-results-and-tree-expand-persistence
   *          第 4.5 / 4.6 / 5.1 / 5.3 / 5.4 章 +
   *          2026-06-27 第 6.8 章）：
   *   - 若当前没有 editorState、或当前是 decryptFailed、或选中的就是当前 note：
   *     直接 `applySelection`；
   *   - 若当前是 dirty（任何已落库 note 的修改，或新建 note 的存在）：
   *     弹"保存并切换"遮罩，**不**静默切走；
   *   - 窄屏下：选中后调用 `autoCloseMobileSidebar()` 让文件树自动收起。
   *   - 若切换被"未保存拦截"阻断：保持文件树状态不变，让用户能在 sidebar
   *     里继续点其他项或继续编辑当前 note；**不**提前写 `expandedFolderIds`。
   *   - **同 note 重复点击**：视为 no-op，但若祖先 folder 处于折叠态，
   *     仍要把"祖先路径"写进 `expandedFolderIds`（用户可能在搜索结果
   *     里点了当前 note；只为了"让树展开到可见位置"）。这种情况视为
   *     "切换已应用"，调用方可以推进后续副作用。
   */
  function trySelect(next: SidebarSelection): boolean {
    const current = currentEditorState;
    // 同 note 重复点击：no-op，但确保祖先路径展开。
    if (current && next.kind === "note" && next.id === current.noteId) {
      const folderId = current.folderId;
      if (folderId !== null) {
        expandAncestorFolders(folderId);
      }
      return true;
    }
    if (!current) {
      applySelection(next);
      autoCloseMobileSidebar();
      return true;
    }
    if (current.decryptFailed) {
      // 解密失败态：当前没有"未保存修改"概念，直接允许切换。
      applySelection(next);
      autoCloseMobileSidebar();
      return true;
    }
    if (!isDirty(current)) {
      applySelection(next);
      autoCloseMobileSidebar();
      return true;
    }
    // dirty：弹"保存并切换"遮罩，保留当前 editorState。
    // 阻断期间**不**自动收起 sidebar（让用户能继续点别的）；
    // 阻断期间**不**展开目标祖先路径（避免"树像切过去了，右边其实没切"）。
    setSaveOverlay({ mode: "save-and-switch", action: { kind: "switch", target: next } });
    return false;
  }

  /**
   * 把 folderId 的"祖先 folderId 链"合并进 `expandedFolderIds`。
   * - 已展开的 id 保持；
   * - 未在 `space.folders` 里存在的 id 静默丢弃；
   * - 根目录（folderId === null）不写；
   * - 与现有 `expandedFolderIds` 取并集，避免覆盖用户的手工折叠。
   *
   * 设计缘由（施工单 2026-06-27 第 4.6 / 5.1 / 5.2 / 5.3 章）：
   *   - 这是"点击搜索结果后自动展开祖先路径"的唯一入口；
   *   - 由 `trySelect` / `completeSaveFlow` 在切换**成功**后调用；
   *   - 失败的切换不调用本函数，避免半状态。
   */
  function expandAncestorFolders(folderId: string | null) {
    if (folderId === null) return;
    const chain = ancestorFolderIds(space.folders, folderId);
    if (chain.length === 0) return;
    setExpandedFolderIds((prev) => {
      let changed = false;
      const next = new Set(prev);
      for (const id of chain) {
        if (space.folders[id] && !next.has(id)) {
          next.add(id);
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }

  /**
   * 真正落地一次 selection 切换：
   *   - folder / root：先 cancel 当前 pending decrypt，再清空 editorState
   *     （也清空 selection 的 note 高亮）；
   *   - note：打开（已持久化 → 解密 + 装载 baseline；新建态在新建流程里已装载）。
   *   - 同一 note 已在编辑：no-op。
   *
   * 设计缘由（施工单 2026-06-27 note-open-cancel-and-transport-hard-switch
   *          第 5.2 / 6.6 章 +
   *          施工单 2026-06-27 note-search-results-and-tree-expand-persistence
   *          第 4.5 / 5.1 / 5.2 / 5.3 / 5.4 章）：
   *   - 切到非 note 目标时不能省 cancel，否则旧 decrypt 晚回来会落在
   *     "当前没有打开 note"的中间态里飘。
   *   - **note 切换成功后**才把"祖先路径"展开：
   *       - `trySelect` 已在 dirty 状态被阻断时不调用本函数；
   *       - 这里再调一次，保证"切换"与"展开"是同一时刻。
   *   - 当前 note 找不到 record（被外部删掉）时回退到 root，**不**展开任何路径。
   */
  function applySelection(next: SidebarSelection) {
    setSelection(next);
    if (next.kind !== "note" || next.id === null) {
      cancelCurrentPendingDecrypt();
      setCurrentEditorState(null);
      setDecryptError(null);
      return;
    }
    const noteId = next.id;
    // 已在编辑该 note：no-op（包含 loading / decryptFailed 也算 no-op；本单不引入"重试"）。
    if (currentEditorState && currentEditorState.noteId === noteId) {
      return;
    }
    const persisted = space.notes[noteId];
    if (!persisted) {
      // 找不到 record（已被外部删掉等）：回退到 root。
      cancelCurrentPendingDecrypt();
      setCurrentEditorState(null);
      setSelection({ kind: "root", id: null });
      setDecryptError(null);
      return;
    }
    // 切换"成功"——写展开状态。注意：
    //   - 必须在 `openPersistedNote` 之前调用，让"打开"和"展开"是同一个 React commit；
    //   - 失败时（record 不存在 / 中途解密失败）已经 return，**不会**走到这里。
    //   - `decryptFailed` / `loading` 不影响这里——selection 仍指向新 note；
    //     旧 `currentEditorState` 也会被 `openPersistedNote` 覆盖。
    expandAncestorFolders(persisted.folderId);
    void openPersistedNote(persisted);
  }

  /**
   * 窄屏下选中后自动收起 sidebar。
   * 设计缘由（施工单 2026-06-27 第 5.2 / 5.3 / 6.8 章）：
   *   - 只在窄屏生效（桌面端 isSidebarOpenOnMobile === true，不改）；
   *   - 选中后不强制锁死，用户可再次手动展开。
   */
  function autoCloseMobileSidebar() {
    if (typeof window !== "undefined" && window.innerWidth < MOBILE_BREAKPOINT) {
      setIsSidebarOpenOnMobile(false);
    }
  }

  /* ============== 解密 / 装载 baseline ============== */

  /**
   * 解密一条已持久化 note 并装载为 `currentEditorState`。
   * 边界：调用前保证 `selection.id === record.id`；调用后 selection / editorState 同步。
   *
   * 设计缘由（施工单 2026-06-27 note-open-cancel-and-transport-hard-switch
   *          第 4.1 / 5.1 / 6.1 / 8.4 章）：
   *   - hydration 的**唯一**入口；只跑在用户主动切换 note 时。
   *   - **不**监听 `space.notes` 变化重新触发——保存后的 record 更新不会回灌当前 editor。
   *   - **不**再串行排队：每次调用立即为该 record 发出独立 decrypt 请求；
   *     session 允许多 pending 并存，由 Keymaster 内部自行串行执行。
   *   - **取消旧 decrypt**：进入 loading 占位后，若 `pendingDecryptRef.current`
   *     仍有上一条 request，立即 `session.cancelRequest(oldId)`（fire-and-forget）；
   *     不等待 cancel 的 ack，不等待旧请求的 reject / result。
   *   - **代际隔离**：每次调用捕获 `myOp = ++openOperationRef.current`；
   *     写入新 `pendingDecryptRef`（包含 requestId / noteId / generation）。
   *     异步结果回来时只有 `pendingDecryptRef.current` 仍指向本调用
   *     才允许写 UI；否则静默丢弃。
   *   - **失败兜底**：currentEditorState 锁成 `decryptFailed`，record 保留以供重试；
   *     但**仅**当本调用仍是"最新一次打开"时才写。
   *   - **不在这里 await previous**：避免 B 因 A 没完成而排队——这正是本单
   *     要消除的旧行为。
   */
  async function openPersistedNote(record: StoredNoteRecord) {
    const myOp = ++openOperationRef.current;
    const myNoteId = record.id;
    const myRequestId = makeRequestId();
    // 捕获上一个 pending decrypt（若有），并立刻把 pending 引用换成新的。
    const previous = pendingDecryptRef.current;
    pendingDecryptRef.current = {
      requestId: myRequestId,
      noteId: myNoteId,
      generation: myOp
    };
    setDecryptError(null);
    // 先填"已锁 / 解密中"的占位 editor state，避免 editor-stage 闪空。
    // `loading: true` 让 `isDirty()` / `canSave` / 标题/标签/正文输入全部锁住，
    // 防止用户在解密完成前误保存"（解密中...）"占位。
    setCurrentEditorState({
      noteId: myNoteId,
      kind: "persisted",
      folderId: record.folderId,
      title: record.title,
      tags: [...record.tags],
      markdown: "（解密中...）",
      baseline: {
        title: record.title,
        tags: [...record.tags],
        markdown: ""
      },
      loading: true,
      decryptFailed: false
    });

    const session = getSessionClient();
    // 旧 pending decrypt 仍存在 → 立即 fire-and-forget cancel。
    // cancel 没有 ack，旧请求仍可能晚回来；本调用靠代际隔离丢弃它们。
    if (previous && previous.requestId !== myRequestId) {
      session.cancelRequest(previous.requestId);
    }

    const request = buildCipherDecryptRequest({
      text: `解密 ${record.title} 内容`,
      nonceBase64: record.cipher.nonceBase64,
      cipherbytesBase64: record.cipher.cipherbytesBase64,
      requestId: myRequestId
    });

    try {
      const response = await session.runRequest(request);
      // 拿到结果后再校验代际：用户可能已切到别的 note / folder / root / 删掉。
      if (pendingDecryptRef.current?.requestId !== myRequestId) return;
      if (pendingDecryptRef.current?.generation !== myOp) return;
      // 兜底：`currentEditorStateRef.current` 是 commit 后真值。
      // - 若为 null：用户已离开 note（切 folder/root、删除 note、清空 editor 等）；
      // - 若 noteId 不匹配：用户已切到别的 note。
      // 任意一种都意味着"这条 decrypt 已经失去业务价值"，**必须**丢弃，
      // 不写回 UI。否则会出现"已删除/已切走的 note 被旧 decrypt 重新画出来"。
      if (!currentEditorStateRef.current || currentEditorStateRef.current.noteId !== myNoteId) {
        return;
      }

      if (!response.ok) {
        throw new Error(formatProtocolError(response.error.code, response.error.message));
      }
      const decrypted = parseCipherDecryptResult(response.result as never);

      // 通过校验 + 解析成功：本请求已落地（成功）。清掉 pending 引用，
      // 避免后续 `cancelCurrentPendingDecrypt` / `openPersistedNote` 把
      // 已完成的 request 误当成"当前还在等待的 decrypt"再发 cancel。
      //
      // **必须**放在 `if (!response.ok)` 与 `parseCipherDecryptResult` **之后**——
      // 这两步都可能抛错进入下方的 catch；catch 的代际检查依赖
      // `pendingDecryptRef.current?.requestId === myRequestId` 才能放行并落失败态。
      // 如果在这里提前清成 null，当前请求自己的协议错误 / 解析异常会被
      // catch 的同款检查挡掉，`decryptError` 与 `decryptFailed` 都写不出来。
      pendingDecryptRef.current = null;

      // 解密成功：完整装载 baseline，loading 置 false。
      setCurrentEditorState({
        noteId: myNoteId,
        kind: "persisted",
        folderId: record.folderId,
        title: record.title,
        tags: [...record.tags],
        markdown: decrypted,
        baseline: {
          title: record.title,
          tags: [...record.tags],
          markdown: decrypted
        },
        loading: false,
        decryptFailed: false
      });
      setDecryptError(null);
    } catch (err) {
      // 同样的代际检查：旧请求的 reject / `user_rejected` / `popup_closed`
      // 不能误标成当前 note 失败——前提是用户已经离开当前 note。
      //
      // 注意：这里**不能**假设 `pendingDecryptRef.current` 已被清空——
      // 成功分支的清空发生在 `parseCipherDecryptResult` 之后；如果当前请求的
      // 协议错误（`!response.ok`）或 `parseCipherDecryptResult` 抛错，
      // 这里看到的 `pendingDecryptRef.current.requestId` **仍然是** `myRequestId`，
      // 代际检查会放行，失败态才能正常写出来。
      if (pendingDecryptRef.current?.requestId !== myRequestId) return;
      if (pendingDecryptRef.current?.generation !== myOp) return;
      if (!currentEditorStateRef.current || currentEditorStateRef.current.noteId !== myNoteId) {
        return;
      }
      // 通过校验 & 已确认是失败：本请求已落地（失败），清掉 pending 引用。
      pendingDecryptRef.current = null;

      setDecryptError(formatTransportError(err));
      setCurrentEditorState({
        noteId: myNoteId,
        kind: "persisted",
        folderId: record.folderId,
        title: record.title,
        tags: [...record.tags],
        markdown: "",
        baseline: {
          title: record.title,
          tags: [...record.tags],
          markdown: ""
        },
        loading: false,
        decryptFailed: true
      });
      // 注意：**不**清空 record；保留密文以供后续重试。
    }
  }

  /**
   * 取消当前 pending decrypt（如果存在）：
   *   - 清空 `pendingDecryptRef`；
   *   - 自增 `openOperationRef`，让任何 in-flight decrypt 落在过期代际；
   *   - 对旧 requestId 发 `cancelRequest`（fire-and-forget）。
   *
   * 使用场景：
   *   - note → folder / root 切换；
   *   - 当前 note 被外部删除 / 整个 owner 空间被清空；
   *   - 退出工作区（额外再 `closeSession()`，transport 批量 reject 兜底）；
   *   - 切换 owner（同上）。
   *
   * **不**用于 note → note 切换——那里由 `openPersistedNote` 自己处理旧请求 cancel。
   */
  function cancelCurrentPendingDecrypt() {
    const old = pendingDecryptRef.current;
    pendingDecryptRef.current = null;
    if (openOperationRef.current !== 0 || old) {
      openOperationRef.current += 1;
    }
    if (old) {
      sessionRef.current?.cancelRequest(old.requestId);
    }
  }

  /* ============== folder / note 操作 ============== */

  function resolveCreateParent(): string | null {
    if (selection.kind === "folder" && selection.id !== null) return selection.id;
    if (currentEditorState) return currentEditorState.folderId;
    return null;
  }

  /**
   * 显式给出 parentId 的入口——右键菜单走这条，避免 `setSelection` 异步生效
   * 导致新建位置回退到"之前选中的位置"。
   * 未传 override 时，回退到 `resolveCreateParent()`（用于顶部 + note / + 文件夹 按钮）。
   *
   * 设计缘由（施工单 2026-06-26 save-switch-current-editor-state 第 7.5 章）：
   *   - 新建 note **不**写入 `space.notes` 占位 record；
   *   - 直接在 `currentEditorState` 里挂一份 `kind: "new"` 的内存态；
   *   - 默认 title = 同目录唯一名（自动补编号）；
   *   - 创建后 save 立即可点（dirty = true）；
   *   - 已 dirty 时再次新建：弹"保存并切换"遮罩（action = create-note），
   *     避免静默丢弃当前编辑。
   */
  function handleCreateNote(parentIdOverride?: string | null) {
    if (!identity) return;
    const parentId = parentIdOverride === undefined ? resolveCreateParent() : parentIdOverride;
    // 已 dirty 且有未保存修改：弹"保存并切换"遮罩，action = create-note。
    if (currentEditorState && !currentEditorState.decryptFailed && isDirty(currentEditorState)) {
      setSaveOverlay({
        mode: "save-and-switch",
        action: { kind: "create-note", parentId }
      });
      return;
    }
    doCreateNote(parentId);
  }

  /**
   * 真正落地一次"新建 note"：
   *   - 不写 `space.notes`；
   *   - 直接装载 `currentEditorState`（kind: "new"）。
   *   - `selection` 切到新建 note。
   *
   * 设计缘由（施工单 2026-06-27 note-open-cancel-and-transport-hard-switch
   *          第 5.1 / 6.1 / 8.4 章 + 修复轮：
   *   - `loading` 状态下 `isDirty()` 为 false，`handleCreateNote()` 会绕过
   *     "保存并切换"遮罩直接走 `doCreateNote()`；这条路径**必须**取消当前
   *     pending decrypt（否则旧 persisted note 的 decrypt 仍在占着
   *     `pendingDecryptRef`，晚回来的结果虽因 `noteId` 不匹配被丢弃，但
   *     pending 引用要拖到下一次别的路径才被清，违反"离开当前 note 立刻
   *     cancel"的硬切换定义）。
   *   - 同样适用于"保存并切换 → create-note"路径：saved 状态后已没有 in-flight
   *     decrypt，但 cancel 是 no-op，不影响功能。
   */
  function doCreateNote(parentId: string | null) {
    if (!identity) return;
    // 离开当前编辑态（即便 currentEditorState 实际为 `loading` 或 null，
    // 都要清 pending 引用 + 自增代际 + 对旧 request 发 cancel）。
    cancelCurrentPendingDecrypt();
    const taken = collectNoteTitlesInFolder(parentId);
    const title = findAvailableName(DEFAULT_NOTE_BASE_NAME, taken);
    const id = cryptoRandomId();
    setCurrentEditorState({
      noteId: id,
      kind: "new",
      folderId: parentId,
      title,
      tags: [],
      markdown: "",
      baseline: { title: "", tags: [], markdown: "" },
      loading: false,
      decryptFailed: false
    });
    setSelection({ kind: "note", id });
    setDecryptError(null);
    setLastError(null);
  }

  /**
   * 在指定的父目录下，收集所有 note 的 title（持久层 + 当前未保存新 note）。
   * 用于"新建 note 时自动补编号"以及"重命名 / 保存时的同目录冲突检查"。
   */
  function collectNoteTitlesInFolder(folderId: string | null): string[] {
    const out: string[] = [];
    for (const n of Object.values(space.notes)) {
      if (n.folderId === folderId) out.push(n.title);
    }
    if (currentEditorState && currentEditorState.kind === "new" && currentEditorState.folderId === folderId) {
      out.push(currentEditorState.title);
    }
    return out;
  }

  /**
   * 在指定的父目录下，收集所有 folder 的 title。
   * 用于"新建 folder 时自动补编号"。
   */
  function collectFolderTitlesInParent(parentId: string | null): string[] {
    const out: string[] = [];
    for (const f of Object.values(space.folders)) {
      if (f.parentId === parentId) out.push(f.title);
    }
    return out;
  }

  /**
   * 新建文件夹：先开页面内命名弹层，让用户输入名字再真正创建。
   */
  function handleCreateFolder(parentIdOverride?: string | null) {
    if (!identity) return;
    const parentId = parentIdOverride === undefined ? resolveCreateParent() : parentIdOverride;
    setNameDialog({
      mode: { kind: "create-folder", parentId },
      title: "新建文件夹",
      description: "输入文件夹名。若与同父目录下已有文件夹重名，将自动补编号。",
      initialValue: DEFAULT_FOLDER_BASE_NAME,
      placeholder: "文件夹名",
      confirmLabel: "创建"
    });
    setLastError(null);
  }

  /**
   * 弹层确认回调。
   */
  function handleNameDialogConfirm(value: string) {
    const dialog = nameDialog;
    if (!dialog) return;
    if (dialog.mode.kind === "create-folder") {
      const trimmed = value.trim();
      const taken = collectFolderTitlesInParent(dialog.mode.parentId);
      const finalTitle = findAvailableName(trimmed, taken);
      const result = createFolder(space, { parentId: dialog.mode.parentId, title: finalTitle });
      if (!result) {
        setLastError("新建文件夹失败：未知原因。");
        setNameDialog(null);
        return;
      }
      commitSpace(result.next);
      setLastError(null);
      // 切换到新建的 folder：等价于 note → folder 切换，必须 cancel 当前 pending
      // decrypt（即便当前不在编辑 note，防御性也补一次）。否则若正在打开某条
      // note 的 in-flight decrypt 晚回来，会把一个已离开的 note 写回 UI。
      cancelCurrentPendingDecrypt();
      setSelection({ kind: "folder", id: result.folder.id });
      setCurrentEditorState(null);
      setNameDialog(null);
      return;
    }
    if (dialog.mode.kind === "rename-folder") {
      const trimmed = value.trim();
      const result = renameFolder(space, dialog.mode.folderId, trimmed);
      if (!result) {
        setLastError("重命名失败：同目录下已有同名文件夹。");
        setNameDialog(null);
        return;
      }
      commitSpace(result.next);
      setLastError(null);
      setNameDialog(null);
      return;
    }
    // rename-note
    const trimmed = value.trim();
    const noteId = dialog.mode.noteId;
    // 1) 当前 editor state 是该 note → 原地 patch 即可。
    if (currentEditorState && currentEditorState.noteId === noteId) {
      if (currentEditorState.loading) {
        // 防御性：解密未完成时不动 title（避免覆盖密文的真值）。
        setNameDialog(null);
        return;
      }
      if (isNoteTitleConflictWithEditor(space.notes, currentEditorState.folderId, trimmed, noteId, currentEditorState)) {
        setLastError("重命名失败：同目录下已有同名 note。");
        setNameDialog(null);
        return;
      }
      setCurrentEditorState({ ...currentEditorState, title: trimmed });
      setLastError(null);
      setNameDialog(null);
      return;
    }
    // 2) 否则：已持久化 note 的重命名走 storage。
    const target = space.notes[noteId];
    if (!target) {
      setNameDialog(null);
      return;
    }
    if (isNoteTitleConflict(space.notes, target.folderId, trimmed, noteId)) {
      setLastError("重命名失败：同目录下已有同名 note。");
      setNameDialog(null);
      return;
    }
    const updated: StoredNoteRecord = { ...target, title: trimmed, updatedAt: Date.now() };
    commitSpace(putNote(space, updated));
    setLastError(null);
    setNameDialog(null);
  }

  /**
   * 弹层关闭 / 取消回调：当作没发生过。
   */
  function handleNameDialogCancel() {
    setNameDialog(null);
  }

  /**
   * 弹层内联校验。
   */
  function validateNameDialogValue(value: string): string | null {
    const dialog = nameDialog;
    if (!dialog) return null;
    if (dialog.mode.kind === "create-folder") {
      return null;
    }
    if (dialog.mode.kind === "rename-folder") {
      const target = space.folders[dialog.mode.folderId];
      if (!target) return null;
      if (isFolderTitleConflict(space.folders, target.parentId, value, dialog.mode.folderId)) {
        return "同父目录下已有同名文件夹。";
      }
      return null;
    }
    // rename-note
    const noteId = dialog.mode.noteId;
    if (currentEditorState && currentEditorState.noteId === noteId) {
      if (isNoteTitleConflictWithEditor(space.notes, currentEditorState.folderId, value, noteId, currentEditorState)) {
        return "同目录下已有同名 note。";
      }
      return null;
    }
    const target = space.notes[noteId];
    if (!target) return null;
    if (isNoteTitleConflict(space.notes, target.folderId, value, noteId)) {
      return "同目录下已有同名 note。";
    }
    return null;
  }

  function handleDeleteFolder(folderId: string) {
    if (!isFolderEmpty(space, folderId)) {
      setPendingDialog({
        title: "文件夹非空，无法删除",
        message: "首版不支持递归删除。请先清空里面的文件夹和 note 后再删除。",
        onDismiss: () => setPendingDialog(null)
      });
      return;
    }
    commitSpace(deleteFolder(space, folderId));
    if (selection.kind === "folder" && selection.id === folderId) {
      // 切到 root：cancel 当前 pending decrypt（防御性，即便 currentEditorState
      // 此时通常已是 null）。防止 in-flight 的 decrypt 晚回来把已离开的 note
      // 写回 UI。
      cancelCurrentPendingDecrypt();
      setSelection({ kind: "root", id: null });
      setCurrentEditorState(null);
    }
    setLastError(null);
  }

  function handleDeleteNote(noteId: string) {
    // 当前正在编辑该 note：
    //   - `kind: "persisted"`：**必须**走 storage 真正删掉持久化记录，再清内存态；
    //   - `kind: "new"`：note 还没落库，仅清内存态即可，不动 storage。
    //
    // 设计缘由（施工单 2026-06-27 note-open-cancel-and-transport-hard-switch
    //          第 6.6 / 8.4 章）：
    //   - 离开当前 note 之前**必须** cancel 当前 pending decrypt，
    //     否则该 note 的 in-flight decrypt 晚回来会把已删除的 note 重新写回 UI。
    if (currentEditorState && currentEditorState.noteId === noteId) {
      if (currentEditorState.kind === "persisted") {
        if (!space.notes[noteId]) {
          // 异常态：editor 说 persisted 但 storage 里没有——保守起见只清内存态。
          cancelCurrentPendingDecrypt();
          setCurrentEditorState(null);
          setSelection({ kind: "root", id: null });
          setDecryptError(null);
          setLastError(null);
          return;
        }
        cancelCurrentPendingDecrypt();
        commitSpace(deleteNote(space, noteId));
        setCurrentEditorState(null);
        setSelection({ kind: "root", id: null });
        setDecryptError(null);
        setLastError(null);
        return;
      }
      // kind === "new"：未持久化，仅清内存态。
      cancelCurrentPendingDecrypt();
      setCurrentEditorState(null);
      setSelection({ kind: "root", id: null });
      setDecryptError(null);
      setLastError(null);
      return;
    }
    // 否则：未在编辑的已持久化 note 的删除走 storage。
    if (!space.notes[noteId]) return;
    commitSpace(deleteNote(space, noteId));
    if (selection.kind === "note" && selection.id === noteId) {
      // 防御性：即便 currentEditorState 通常此时已不是该 note，也补一次 cancel。
      cancelCurrentPendingDecrypt();
      setSelection({ kind: "root", id: null });
      setCurrentEditorState(null);
      setDecryptError(null);
    }
    setLastError(null);
  }

  function handleMoveFolder(folderId: string, newParentId: string | null) {
    const next = moveFolder(space, folderId, newParentId);
    if (!next) {
      setPendingDialog({
        title: "无法移动文件夹",
        message: "目标位置不合法，或目标目录下已有同名文件夹。",
        onDismiss: () => setPendingDialog(null)
      });
      return;
    }
    commitSpace(next);
    setLastError(null);
  }

  function handleMoveNote(noteId: string, newFolderId: string | null) {
    // 当前 editor state 是该 note（new 或 persisted）：直接 patch folderId。
    if (currentEditorState && currentEditorState.noteId === noteId) {
      if (currentEditorState.loading) {
        // 防御性：解密未完成时不动 folderId（避免覆盖密文的真值）。
        return;
      }
      if (isNoteTitleConflictWithEditor(space.notes, newFolderId, currentEditorState.title, noteId, currentEditorState)) {
        setPendingDialog({
          title: "无法移动 note",
          message: "目标目录下已有同名 note，请改文件名或换目标文件夹。",
          onDismiss: () => setPendingDialog(null)
        });
        return;
      }
      setCurrentEditorState({ ...currentEditorState, folderId: newFolderId });
      setLastError(null);
      return;
    }
    // 否则：已持久化 note 的移动走 storage。
    const next = moveNote(space, noteId, newFolderId);
    if (!next) {
      setPendingDialog({
        title: "无法移动 note",
        message: "目标目录下已有同名 note，请改文件名或换目标文件夹。",
        onDismiss: () => setPendingDialog(null)
      });
      return;
    }
    commitSpace(next);
    setLastError(null);
  }

  function commitSpace(next: StoredNotesSpace) {
    setSpace(next);
    if (identity) saveOwnerSpace(identity.publicKeyHex, next);
  }

  /* ============== 保存 ============== */

  /**
   * 主动点击 save 按钮的入口。
   */
  async function handleSave() {
    if (!identity || !currentEditorState) return;
    if (saveOverlay !== null) return; // 已经在阻塞态，不重复开。
    const state = currentEditorState;
    if (state.decryptFailed) {
      setLastError("当前 note 解密失败，无法重新加密保存。请删除或切换 origin / active key 后重试。");
      return;
    }
    if (state.loading) {
      // 防御性：UI 上 save 按钮已 disabled，但 handler 也再挡一次。
      setLastError("当前 note 正在解密中，无法保存。请等待解密完成。");
      return;
    }
    const titleCheck = validateTitle(state.title);
    if (!titleCheck.ok) {
      setLastError(`保存失败：${titleCheck.failure.message}`);
      return;
    }
    if (
      isNoteTitleConflictWithEditor(
        space.notes,
        state.folderId,
        titleCheck.title,
        state.noteId,
        state
      )
    ) {
      setLastError(`保存失败：当前目录下已有同名 note "${titleCheck.title}"。`);
      return;
    }
    setLastError(null);
    setSaveOverlay({ mode: "save", action: { kind: "none" } });
    await performSave();
  }

  /**
   * "保存并切换"遮罩里的"保存并切换"按钮：
   *   校验后切换到 `save` 模式（按钮集合变为只"取消"），由 `performSave` 真正执行加密；
   *   `action` 保留，保存成功后由 `completeSaveFlow` 派发。
   */
  async function handleSaveAndSwitch() {
    if (!identity || !currentEditorState || !saveOverlay) return;
    if (saveOverlay.mode !== "save-and-switch") return;
    const state = currentEditorState;
    if (state.decryptFailed) return; // 防御性：decryptFailed 走不到这里
    if (state.loading) return; // 防御性：loading 时无法保存
    const titleCheck = validateTitle(state.title);
    if (!titleCheck.ok) {
      setLastError(`保存失败：${titleCheck.failure.message}`);
      setSaveOverlay(null);
      return;
    }
    if (
      isNoteTitleConflictWithEditor(
        space.notes,
        state.folderId,
        titleCheck.title,
        state.noteId,
        state
      )
    ) {
      setLastError(`保存失败：当前目录下已有同名 note "${titleCheck.title}"。`);
      setSaveOverlay(null);
      return;
    }
    setLastError(null);
    // 切到 "save" 模式视觉（按钮集合只显示"取消"），action 保留。
    setSaveOverlay({ mode: "save", action: saveOverlay.action });
    await performSave();
  }

  /**
   * 共享的加密 + 落地流程。
   *   - 关闭遮罩永远在 finally 里完成。
   *   - 失败时**不**回滚 currentEditorState，不清空选择。
   *   - 成功时：
   *       - 写 space.notes + localStorage；
   *       - patch currentEditorState.baseline；
   *       - 若是新建 note（kind: "new"）→ 升级为 "persisted"，id 不变；
   *       - 若是已持久化 note → 更新 folderId/title/tags。
   *   - `completeSaveFlow(action)` **仅在**加密成功**且**未被用户取消时派发。
   */
  async function performSave() {
    if (!identity || !currentEditorState) return;
    const state = currentEditorState;
    const action = saveOverlay?.action ?? { kind: "none" };
    const draftAtSave = state;
    // 重置取消标志——本轮保存自己的"是否被取消"判定。
    saveCancelledRef.current = false;
    let didSucceed = false;
    try {
      const session = getSessionClient();
      const request = buildCipherEncryptRequest({
        text: "向 Notes Demo 加密当前 note 的 markdown",
        contentType: NOTE_CONTENT_TYPE,
        markdown: draftAtSave.markdown,
        requestId: makeRequestId()
      });
      const response = await session.runRequest(request);
      // 收到结果后再检查一次：用户在等待期间点了"取消"。
      if (saveCancelledRef.current) {
        // 用户已主动取消：忽略 popup 的结果，**不**写盘。
        return;
      }
      if (!response.ok) {
        setLastError(formatProtocolError(response.error.code, response.error.message));
        return;
      }
      const cipher = parseCipherEncryptResult(response.result as never);
      const now = Date.now();
      const record: StoredNoteRecord = {
        v: 2,
        id: draftAtSave.noteId,
        folderId: draftAtSave.folderId,
        title: draftAtSave.title.trim(),
        tags: normalizeTags(draftAtSave.tags),
        createdAt:
          draftAtSave.kind === "persisted"
            ? space.notes[draftAtSave.noteId]?.createdAt ?? now
            : now,
        updatedAt: now,
        cipher: {
          contentType: NOTE_CONTENT_TYPE,
          nonceBase64: cipher.nonceBase64,
          cipherbytesBase64: cipher.cipherbytesBase64
        }
      };
      const next = putNote(space, record);
      // (1) 写持久层 + space；
      setSpace(next);
      saveOwnerSpace(identity.publicKeyHex, next);
      // (2) patch currentEditorState：
      //     - kind: "new" → "persisted"；
      //     - baseline = 当前值；
      //     - 其余不变。
      setCurrentEditorState({
        ...draftAtSave,
        kind: "persisted",
        title: record.title,
        tags: [...record.tags],
        baseline: {
          title: record.title,
          tags: [...record.tags],
          markdown: draftAtSave.markdown
        }
      });
      didSucceed = true;
    } catch (err) {
      // 用户主动取消时，closeSession 会让 in-flight 请求抛 popup_closed——
      // 这时**不**当成错误显示，避免误导（"popup 被关闭"是因为我们自己关的）。
      if (!saveCancelledRef.current) {
        setLastError(formatTransportError(err));
      }
      // 失败 / 取消：currentEditorState 保持原样，不回滚。
    } finally {
      // 关闭遮罩。仅在"加密成功 + 未被取消"时才派发"保存后动作"。
      setSaveOverlay(null);
      if (didSucceed && !saveCancelledRef.current) {
        completeSaveFlow(action);
      }
    }
  }

  /**
   * 保存流程完成后的"派发"：
   *   - `switch`：切换到目标；
   *   - `create-note`：落地一个新 note；
   *   - `none`：保持当前 note 不动。
   */
  function completeSaveFlow(action: AfterSaveAction) {
    if (action.kind === "switch") {
      applySelection(action.target);
      autoCloseMobileSidebar();
      return;
    }
    if (action.kind === "create-note") {
      doCreateNote(action.parentId);
      autoCloseMobileSidebar();
      return;
    }
  }

  /**
   * 遮罩"取消"按钮：视为放弃当前保存尝试。
   *
   * 设计缘由（施工单 005 第 5.1.2 / 5.2.3 / 9.1 章）：
   *   - 必须在 `performSave` 完成前告诉它"不要写盘、不要派发 action"——
   *     否则 in-flight 请求回来后还是会执行切换 / 新建。
   *   - 同时 best-effort 关掉 popup session：
   *       - 让 in-flight 的 `runRequest` 走 `popup_closed` 失败路径，
   *         `performSave` 的 catch 块据此不再设置 `lastError`；
   *       - 下次再点 save 时 `getSessionClient` 会重建 session / 重开 popup。
   *   - 当前编辑内容**不**丢（performSave 的失败路径不 patch state）。
   *   - 留在当前 note；不切换。
   */
  function handleSaveOverlayCancel() {
    saveCancelledRef.current = true;
    // best-effort：关掉 session 让 in-flight 请求立刻被拒绝。
    sessionRef.current?.closeSession();
    sessionRef.current = null;
    setPopupState("idle");
    setSaveOverlay(null);
  }

  function handleReset() {
    if (!currentEditorState) return;
    setCurrentEditorState({
      ...currentEditorState,
      title: currentEditorState.baseline.title,
      tags: [...currentEditorState.baseline.tags],
      markdown: currentEditorState.baseline.markdown,
      decryptFailed: false
    });
    setDecryptError(null);
  }

  /* ============== 右键菜单触发 ============== */

  function handleFolderAction(action: FolderAction) {
    switch (action.type) {
      case "create-note":
        handleCreateNote(action.folderId);
        return;
      case "create-folder":
        handleCreateFolder(action.folderId);
        return;
      case "rename":
        promptRenameFolder(action.folderId);
        return;
      case "delete":
        handleDeleteFolder(action.folderId);
        return;
      case "move-start":
        setMoveState({ kind: "folder", id: action.folderId });
        return;
    }
  }

  function handleNoteAction(action: NoteAction) {
    switch (action.type) {
      case "rename":
        promptRenameNote(action.noteId);
        return;
      case "delete":
        handleDeleteNote(action.noteId);
        return;
      case "move-start":
        setMoveState({ kind: "note", id: action.noteId });
        return;
    }
  }

  function handleRootAction(action: RootAction) {
    if (action.type === "create-note") {
      handleCreateNote(null);
      return;
    }
    if (action.type === "create-folder") {
      handleCreateFolder(null);
      return;
    }
  }

  function handleMoveTarget(target: { kind: "folder" | "root"; id: string | null }) {
    if (!moveState) return;
    const check = checkDragLegality(
      space.folders,
      { kind: moveState.kind, id: moveState.id },
      target.kind === "root" ? { kind: "root", id: null } : { kind: "folder", id: target.id }
    );
    if (!check.ok) {
      setLastError(describeDragLegalityReason(check.reason!));
      setMoveState(null);
      return;
    }
    if (moveState.kind === "folder") {
      handleMoveFolder(moveState.id, target.id);
    } else {
      handleMoveNote(moveState.id, target.id);
    }
    setMoveState(null);
  }

  function handleMoveCancel() {
    setMoveState(null);
  }

  function promptRenameFolder(folderId: string) {
    const target = getFolder(space, folderId);
    if (!target) return;
    setNameDialog({
      mode: { kind: "rename-folder", folderId },
      title: "重命名文件夹",
      description: "输入新文件夹名。若与同父目录下已有文件夹重名，将阻断。",
      initialValue: target.title,
      placeholder: "文件夹名",
      confirmLabel: "确认"
    });
    setLastError(null);
  }

  function promptRenameNote(noteId: string) {
    let initial = "";
    if (currentEditorState && currentEditorState.noteId === noteId) {
      initial = currentEditorState.title;
    } else {
      const target = space.notes[noteId];
      if (!target) return;
      initial = target.title;
    }
    setNameDialog({
      mode: { kind: "rename-note", noteId },
      title: "重命名 note",
      description: "输入新文件名（标题）。若与同目录下已有 note 重名，将阻断。",
      initialValue: initial,
      placeholder: "文件名",
      confirmLabel: "确认"
    });
    setLastError(null);
  }

  /* ============== 拖拽 ============== */

  function handleDragStart(kind: "folder" | "note", id: string) {
    setDragging({ kind, id });
    setDropHover(null);
  }

  function handleDragEnd() {
    setDragging(null);
    setDropHover(null);
  }

  function handleDragOverTarget(target: { kind: "folder" | "root"; id: string | null }) {
    if (!dragging) {
      setDropHover(null);
      return;
    }
    const check = checkDragLegality(
      space.folders,
      dragging,
      target.kind === "root" ? { kind: "root", id: null } : { kind: "folder", id: target.id }
    );
    if (!check.ok) {
      setDropHover(null);
      return;
    }
    setDropHover(target);
  }

  function handleDropOnTarget(target: { kind: "folder" | "root"; id: string | null }) {
    if (!dragging) return;
    const check = checkDragLegality(
      space.folders,
      dragging,
      target.kind === "root" ? { kind: "root", id: null } : { kind: "folder", id: target.id }
    );
    if (!check.ok) {
      setLastError(describeDragLegalityReason(check.reason!));
      setDragging(null);
      setDropHover(null);
      return;
    }
    if (dragging.kind === "folder") {
      handleMoveFolder(dragging.id, target.id);
    } else {
      handleMoveNote(dragging.id, target.id);
    }
    setDragging(null);
    setDropHover(null);
  }

  /* ============== 文件树开合 ============== */

  /**
   * 用户点 folder 前面的开合按钮时触发。
   *
   * 规则（施工单 2026-06-27 第 4.6 / 4.7 / 4.8 章）：
   *   - 只修改 `expandedFolderIds` 单真值；
   *   - 已是展开 → 折叠；未在集合 → 展开；
   *   - **不**改变 `selection`；
   *   - 与移动模式 / 拖拽互不影响（开合按钮 stopPropagation，事件不会冒泡到 row）。
   */
  function handleToggleFolderExpand(folderId: string) {
    setExpandedFolderIds((prev) => {
      const next = new Set(prev);
      if (next.has(folderId)) {
        next.delete(folderId);
      } else {
        next.add(folderId);
      }
      return next;
    });
  }

  /* ============== 搜索结果点击 ============== */

  /**
   * 搜索结果项点击：走现有 `trySelect` 链路。
   *
   * 关键收口（施工单 2026-06-27 第 4.5 / 5.1 / 5.4 章）：
   *   - `trySelect` 返回 `true` = 切换已应用：清掉 `searchQuery` / `activeTag`，
   *     右侧退出"搜索结果页"，进入 note 编辑视图。
   *   - `trySelect` 返回 `false` = 被未保存修改阻断（保存遮罩已弹出）：
   *     **不**清搜索态，让用户继续在结果页里挑别的目标——与施工单
   *     "保持当前结果页与当前编辑状态一致"对齐。
   *
   * 不能反过来"先清搜索态再 trySelect"：那样会在保存遮罩弹出后，右侧
   * 立刻退出结果页回到当前 note 编辑器，与"用户还没确认是否保存"的
   * 状态不一致。
   */
  function handleSearchResultSelect(noteId: string) {
    const switched = trySelect({ kind: "note", id: noteId });
    if (switched) {
      setSearchQuery("");
      setActiveTag(null);
    }
  }

  /* ============== 派生 UI 数据 ============== */

  const allTags = useMemo(() => {
    const set = new Set<string>();
    for (const r of Object.values(space.notes)) {
      for (const t of r.tags) set.add(t.toLowerCase());
    }
    if (currentEditorState) {
      for (const t of currentEditorState.tags) set.add(t.toLowerCase());
    }
    return [...set].sort();
  }, [space.notes, currentEditorState]);

  /**
   * 侧栏真正显示的"view space"：
   *   - 持久层 = `space`；
   *   - 当前未保存新 note（`currentEditorState.kind === "new"`）以临时节点形式注入。
   *
   * 设计缘由（施工单 2026-06-26 save-switch-current-editor-state 第 4.3 / 7.3 章）：
   *   - 临时节点 = "当前编辑临时节点"，**不**是 `pendingDrafts` record；
   *   - 标题随时跟着 `currentEditorState.title` 走；
   *   - 保存成功后无缝替换为 persisted note 节点。
   */
  const viewSpace = useMemo<StoredNotesSpace>(() => {
    const notes = { ...space.notes };
    if (
      currentEditorState &&
      currentEditorState.kind === "new" &&
      !notes[currentEditorState.noteId]
    ) {
      // 临时 record 形态：与 sidebar 的 TreeNoteNode 解码逻辑一致（只要 id / title / folderId）。
      const ephemeral: StoredNoteRecord = {
        v: 2,
        id: currentEditorState.noteId,
        folderId: currentEditorState.folderId,
        title: currentEditorState.title,
        tags: [...currentEditorState.tags],
        createdAt: 0,
        updatedAt: 0,
        cipher: {
          contentType: NOTE_CONTENT_TYPE,
          nonceBase64: "",
          cipherbytesBase64: ""
        }
      };
      notes[currentEditorState.noteId] = ephemeral;
    }
    return { v: 1, folders: space.folders, notes };
  }, [space, currentEditorState]);

  /**
   * 搜索 / tag 过滤的"结果"集合（驱动右侧文档区搜索结果页）。
   *
   * 设计缘由（施工单 2026-06-27 note-search-results-and-tree-expand-persistence
   *          第 4.1 / 4.2 / 4.3 / 4.4 / 7.1 章）：
   *   - **不**再作用于左侧文件树——树永远展示真实完整树；
   *   - 仅匹配 `note.title`（trim + lowerCase + includes）和 `note.tags`
   *     （大小写不敏感精确 tag 命中）；两者都为空 → 结果为空；
   *   - `folder.title` 永远不参与；
   *   - note 正文永远不参与；
   *   - 结果集基于 `viewSpace.notes`（持久层 + 当前未保存新 note）；
   *   - 排序 = 树自然顺序（与左侧树一致），由 `collectNotesInTreeOrder` 保证。
   */
  const isSearchMode = useMemo<boolean>(() => {
    return searchQuery.trim().length > 0 || activeTag !== null;
  }, [searchQuery, activeTag]);

  const searchResults = useMemo(() => {
    if (!isSearchMode) return [];
    const tree = buildTree(viewSpace.folders, viewSpace.notes);
    const treeOrdered = collectNotesInTreeOrder(tree);
    return buildSearchResults({
      treeOrderedNotes: treeOrdered.map((n) => viewSpace.notes[n.id]).filter(Boolean) as StoredNoteRecord[],
      searchQuery,
      activeTag,
      pathLabelFor: (folderId) => folderPathLabel(viewSpace.folders, folderId)
    });
  }, [isSearchMode, viewSpace, searchQuery, activeTag]);

  const currentFolder: StoredFolderRecord | null = useMemo(() => {
    if (selection.kind === "folder" && selection.id !== null) {
      return space.folders[selection.id] ?? null;
    }
    return null;
  }, [selection, space.folders]);

  /**
   * 给 DocumentToolbar 用的"record"视角：只有当前是已持久化 note 时才有 record；
   * 新建 note 时为 null（"尚未保存"）。
   */
  const currentNoteRecord: StoredNoteRecord | null = useMemo(() => {
    if (!currentEditorState) return null;
    if (currentEditorState.kind !== "persisted") return null;
    return space.notes[currentEditorState.noteId] ?? null;
  }, [currentEditorState, space.notes]);

  /**
   * dirty 判定：基于 `currentEditorState.baseline`。
   *
   * 设计缘由（施工单 2026-06-26 save-switch-current-editor-state 第 6 章）：
   *   - `kind: "new"` 一律 dirty（用户已表达"新建"意图，save 立即可点）；
   *   - `decryptFailed` 一律 false（title / tags / markdown 均被锁）；
   *   - 已持久化 note：与 baseline 比对 title / tags / markdown，任一不同即 dirty。
   */
  const dirty = useMemo(
    () => (currentEditorState ? isDirty(currentEditorState) : false),
    [currentEditorState]
  );

  /**
   * 同步给 NoteEditor 的 markdown：在 decryptFailed 时强制空字符串以触发"无法解密"分支。
   */
  const editorMarkdown = useMemo(() => {
    if (!currentEditorState) return "";
    if (currentEditorState.decryptFailed) return "";
    return currentEditorState.markdown;
  }, [currentEditorState]);

  const titleError = useMemo(() => {
    if (!currentEditorState) return null;
    const check = validateTitle(currentEditorState.title);
    return check.ok ? null : check.failure.message;
  }, [currentEditorState]);

  const ownerLabel = identity ? truncate(identity.publicKeyHex, 8) : "";

  /**
   * 给 NoteEditor 的 `editable` 标志。
   * 边界：未登录 / decryptFailed / loading / 保存阻塞态 → 不可编辑。
   */
  const editorEditable =
    !!identity &&
    !!(
      currentEditorState &&
      !currentEditorState.decryptFailed &&
      !currentEditorState.loading
    );

  /**
   * 给侧栏 / 标题输入框用的"是否保存阻塞中"标志。
   *   - saveOverlay 非空 → 整页进入阻塞态；
   *   - title / markdown 都不应再接受输入。
   */
  const isBlockingSave = saveOverlay !== null;

  /**
   * banner 优先级判定：
   *   1. 错误（lastError）—— 最高
   *   2. 解密失败（decryptError + 当前 note 处于 decryptFailed）
   *   3. 移动模式（moveState）
   *   4. 普通提示（空）
   * 同一时刻只显示最高优先级的一条；带操作按钮（移动模式的"取消"）。
   */
  const bannerKind = useMemo<"error" | "decrypt" | "move" | "none">(() => {
    if (lastError) return "error";
    if (decryptError && currentEditorState?.decryptFailed) return "decrypt";
    if (moveState) return "move";
    return "none";
  }, [lastError, decryptError, currentEditorState?.decryptFailed, moveState]);

  const bannerMessage = useMemo<string | null>(() => {
    if (bannerKind === "error") return lastError;
    if (bannerKind === "decrypt") {
      return currentEditorState?.decryptFailed
        ? `当前 note 解密失败：${decryptError}。已锁定编辑；可删除本条或切回原 origin / active key 后重试。`
        : decryptError;
    }
    if (bannerKind === "move") {
      return "移动模式：点击目标文件夹或根目录完成移动。";
    }
    return null;
  }, [bannerKind, lastError, decryptError, currentEditorState?.decryptFailed]);

  /* ============== 切换身份 / 删除当前数据 共用的退出清理 ============== */

  /**
   * 退出工作区 → 退回 LockScreen 时**统一**收口清空 notes 工作区内存态。
   *
   * 设计缘由（施工单 2026-06-27 第 6.5 / 8.4 章）：
   *   - `closeSession()` 会批量 reject 全部 pending request（含 in-flight decrypt）；
   *   - 同时清空 `pendingDecryptRef`、把代际归零——保证旧 owner 的 late result
   *     不会写到新工作区。
   */
  function exitWorkspace() {
    sessionRef.current?.closeSession();
    sessionRef.current = null;
    setPopupState("idle");
    setIdentity(null);
    setSpace({ v: 1, folders: {}, notes: {} });
    setSelection({ kind: "root", id: null });
    setCurrentEditorState(null);
    setDecryptError(null);
    setSaveOverlay(null);
    setContextMenu(null);
    setDragging(null);
    setDropHover(null);
    setMoveState(null);
    setPendingDialog(null);
    setConfirmDialog(null);
    setNameDialog(null);
    saveCancelledRef.current = false;
    openOperationRef.current = 0;
    pendingDecryptRef.current = null;
    setLastError(null);
    setSearchQuery("");
    setActiveTag(null);
    // sidebar 展开状态：清空。下一位 owner 登录时会按自己的记录重新加载。
    setExpandedFolderIds(new Set());
  }

  /**
   * 切换身份 / 更换登录器：只退回登录壳，**不**删本地数据。
   */
  function handleSwitchIdentity() {
    exitWorkspace();
  }

  /* ============== 删除当前 owner 本地数据 ============== */

  function handleDeleteCurrentOwnerData() {
    if (!identity || isLoggingIn) return;
    const ownerHex = identity.publicKeyHex;
    setConfirmDialog({
      title: "确认删除当前本地数据？",
      message:
        "这会删除当前 publicKey 对应的全部本地 notes 数据，并立即退出当前工作区。\n" +
        "该操作只影响本浏览器当前站点下的数据，不会删除 Keymaster 身份本身。\n" +
        "不可恢复。",
      confirmLabel: "删除并退出",
      cancelLabel: "取消",
      onCancel: () => setConfirmDialog(null),
      onConfirm: () => {
        setConfirmDialog(null);
        const ok = deleteOwnerSpace(ownerHex);
        if (!ok) {
          setLastError("删除当前本地数据失败，请重试。");
          return;
        }
        exitWorkspace();
      }
    });
  }

  /* ============== 顶层渲染 ============== */

  // 未登录态：只渲染 LockScreen；不显示 notes 工作区任何部分。
  if (!identity) {
    return (
      <LockScreen
        targetInput={targetOrigin}
        defaultTargetOrigin={DEFAULT_TARGET_ORIGIN}
        lastError={lastError}
        isLoggingIn={isLoggingIn}
        onTargetInputChange={setTargetOrigin}
        onUseDefault={() => setTargetOrigin(DEFAULT_TARGET_ORIGIN)}
        onLogin={() => void handleLogin()}
      />
    );
  }

  // 已登录态：渲染完整 notes 工作区。
  const sidebarOpen = isSidebarOpenOnMobile !== false; // null / true → 视为展开

  return (
    <div className="app-shell">
      <header className="app-header">
        <div className="app-header__brand">
          <span className="app-header__eyebrow">Keymaster Notes</span>
          <h1>Notes Demo</h1>
          <p>真实调用 <code>identity.get</code> 与 <code>cipher.*</code> 的加密笔记工作区。</p>
        </div>
        <button
          type="button"
          className="app-header__sidebar-toggle"
          onClick={() => setIsSidebarOpenOnMobile((v) => !(v ?? false))}
          aria-label={sidebarOpen ? "收起文件树" : "展开文件树"}
          aria-expanded={sidebarOpen}
        >
          {sidebarOpen ? "收起目录" : "目录"}
        </button>
        <label className="app-header__theme">
          <span>主题</span>
          <select
            value={themePreference}
            onChange={(e) => setThemePreference(e.target.value as AppThemePreference)}
            aria-label="选择主题"
          >
            <option value="dark">黑</option>
            <option value="light">白</option>
            <option value="system">跟随系统</option>
          </select>
        </label>
        <ConnectStatus
          state={popupState}
          currentOrigin={currentOrigin}
          targetOrigin={normalizedTargetOrigin || targetOrigin}
          publicKeyHex={identity?.publicKeyHex ?? null}
          lastLoginAt={identity?.resolvedAt ?? null}
          isLoggingIn={isLoggingIn}
          onLogin={() => void handleLogin()}
          onForget={handleSwitchIdentity}
          onDeleteCurrentData={handleDeleteCurrentOwnerData}
        />
      </header>

      {/*
        应用级提示 banner：位于 header 与 workspace 之间。
        设计缘由（施工单 2026-06-27 第 4.7 / 4.8 / 8.1 章）：
        - 优先级：error > decrypt > move > none；
        - 同一时刻只显示一条主横条；带操作按钮时只放一个轻量按钮；
        - saveOverlay 仍走单独的全屏遮罩，不进 banner。
      */}
      {bannerKind !== "none" && bannerMessage ? (
        <div className={`app-banner app-banner--${bannerKind}`} role={bannerKind === "error" ? "alert" : "status"}>
          <span className="app-banner__text">{bannerMessage}</span>
          {bannerKind === "move" ? (
            <button
              type="button"
              className="app-banner__action"
              onClick={handleMoveCancel}
            >
              取消
            </button>
          ) : null}
          {bannerKind === "error" ? (
            <button
              type="button"
              className="app-banner__action"
              onClick={() => setLastError(null)}
            >
              知道了
            </button>
          ) : null}
        </div>
      ) : null}

      <main className={`workspace ${sidebarOpen ? "is-sidebar-open" : "is-sidebar-collapsed"}`}>
        <NotesSidebar
          space={viewSpace}
          ephemeralNoteId={
            currentEditorState && currentEditorState.kind === "new"
              ? currentEditorState.noteId
              : null
          }
          selection={selection}
          currentFolder={currentFolder}
          searchQuery={searchQuery}
          activeTag={activeTag}
          contextMenu={contextMenu}
          dragging={dragging}
          dropHover={dropHover}
          moveState={moveState}
          ownerLabel={ownerLabel}
          disabled={isLoggingIn}
          expandedFolderIds={expandedFolderIds}
          onToggleFolderExpand={handleToggleFolderExpand}
          onSelect={trySelect}
          onCreateNote={() => handleCreateNote()}
          onCreateFolder={() => handleCreateFolder()}
          onFolderAction={handleFolderAction}
          onNoteAction={handleNoteAction}
          onRootAction={handleRootAction}
          onContextMenu={setContextMenu}
          onDragStart={handleDragStart}
          onDragEnd={handleDragEnd}
          onDragOverTarget={handleDragOverTarget}
          onDropOnTarget={handleDropOnTarget}
          onSearchQueryChange={setSearchQuery}
          onActiveTagChange={setActiveTag}
          onMoveTarget={handleMoveTarget}
          allTags={allTags}
        />

        {/*
          文档区（document-panel）渲染分支：
            - `isSearchMode` → 搜索结果页（无 editor / folder 详情）；
            - 否则 → 现有 note / folder / root 视图。
          硬切换后不再做"上半结果 + 下半编辑器"的双栏混搭。
        */}
        <section className="document-panel">
          {isSearchMode ? (
            <SearchResultsPanel
              searchQuery={searchQuery}
              activeTag={activeTag}
              results={searchResults}
              onSelect={handleSearchResultSelect}
            />
          ) : currentEditorState ? (
            <>
              <DocumentToolbar
                draft={editorStateToDraft(currentEditorState)}
                record={currentNoteRecord}
                decryptFailed={currentEditorState.decryptFailed}
                isDirty={dirty}
                isSaving={isBlockingSave}
                titleError={titleError}
                canEdit={
                  !!identity &&
                  !isLoggingIn &&
                  !currentEditorState.decryptFailed &&
                  !currentEditorState.loading &&
                  !isBlockingSave
                }
                canDelete={!!identity && !isLoggingIn && !isBlockingSave}
                onChangeTags={(tags) =>
                  setCurrentEditorState((prev) => (prev ? { ...prev, tags } : prev))
                }
                onSave={() => void handleSave()}
                onDelete={() => handleDeleteNote(currentEditorState!.noteId)}
                onReset={handleReset}
              />
              <div className="document-head">
                <input
                  type="text"
                  className="document-head__title"
                  value={currentEditorState.title}
                  onChange={(e) =>
                    setCurrentEditorState((prev) =>
                      prev ? { ...prev, title: e.target.value } : prev
                    )
                  }
                  placeholder="未命名 note"
                  disabled={
                    !!currentEditorState.decryptFailed ||
                    currentEditorState.loading ||
                    isBlockingSave
                  }
                  spellCheck={false}
                />
                <span className="document-head__hint">
                  {currentEditorState.kind === "new"
                    ? "新建 note（尚未保存）"
                    : currentEditorState.loading
                      ? "正在从 Keymaster 解密正文…"
                      : "文件名（保存时会写入 note record）"}
                </span>
              </div>
              <div className="document-editor">
                <NoteEditor
                  key={currentEditorState.noteId}
                  markdown={editorMarkdown}
                  editable={editorEditable && !isBlockingSave}
                  decryptFailed={currentEditorState.decryptFailed}
                  theme={resolvedTheme}
                  onChange={(md) =>
                    setCurrentEditorState((prev) =>
                      prev ? { ...prev, markdown: md } : prev
                    )
                  }
                />
              </div>
            </>
          ) : currentFolder ? (
            <div className="document-panel__empty">
              <h2>选中文件夹：{currentFolder.title || "未命名文件夹"}</h2>
              <p>
                文件夹操作见左侧工具条。重命名请右键文件夹 → 重命名。
              </p>
            </div>
          ) : (
            <div className="document-panel__empty">
              <h2>选择或新建一个 note</h2>
              <p>
                左侧选择文件夹或 note；右键文件夹可新建 / 删除 / 移动；右键 note 可重命名 / 移动 / 删除。
              </p>
            </div>
          )}
        </section>
      </main>

      {pendingDialog ? (
        <div className="confirm-dialog" role="dialog" aria-modal="true">
          <div className="confirm-dialog__box">
            <h3>{pendingDialog.title}</h3>
            <p>{pendingDialog.message}</p>
            <div className="confirm-dialog__actions">
              <button type="button" className="primary-button" onClick={pendingDialog.onDismiss}>
                知道了
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {confirmDialog ? (
        <div className="confirm-dialog" role="dialog" aria-modal="true">
          <div className="confirm-dialog__box">
            <h3>{confirmDialog.title}</h3>
            <p>{confirmDialog.message}</p>
            <div className="confirm-dialog__actions">
              <button type="button" className="secondary-button" onClick={confirmDialog.onCancel}>
                {confirmDialog.cancelLabel}
              </button>
              <button type="button" className="primary-button" onClick={confirmDialog.onConfirm}>
                {confirmDialog.confirmLabel}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {nameDialog ? (
        <NameInputDialog
          title={nameDialog.title}
          description={nameDialog.description}
          initialValue={nameDialog.initialValue}
          placeholder={nameDialog.placeholder}
          confirmLabel={nameDialog.confirmLabel}
          validate={validateNameDialogValue}
          onConfirm={handleNameDialogConfirm}
          onCancel={handleNameDialogCancel}
        />
      ) : null}

      {saveOverlay ? (
        <SaveOverlayDialog
          mode={saveOverlay.mode}
          onCancel={handleSaveOverlayCancel}
          onSaveAndSwitch={() => void handleSaveAndSwitch()}
        />
      ) : null}
    </div>
  );
}

/* ============== 工具 ============== */

/** 把 `CurrentEditorState` 投影成 `NoteDraft`，喂给 DocumentToolbar / TagInput 等。 */
function editorStateToDraft(state: CurrentEditorState): NoteDraft {
  return {
    noteId: state.noteId,
    title: state.title,
    tags: [...state.tags],
    markdown: state.markdown,
    decryptFailed: state.decryptFailed
  };
}

function makeRequestId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `req-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function cryptoRandomId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `note-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function truncate(value: string, head: number): string {
  if (value.length <= head + 4) return value;
  return `${value.slice(0, head)}…${value.slice(-4)}`;
}

/**
 * dirty 判定：基于 `currentEditorState.baseline`。
 *
 * 设计缘由（施工单 2026-06-26 save-switch-current-editor-state 第 6 章 +
 *          后续修复："解密中..." 占位态不能被算成 dirty）：
 *   - `loading` 一律 false（markdown 是占位符，title / tags / 编辑区均被锁，
 *     "正在加载"≠"用户有未保存修改"）；
 *   - `decryptFailed` 一律 false（编辑入口全锁）；
 *   - `kind: "new"` 一律 true（用户已表达"新建"意图，save 立即可点）；
 *   - 已持久化 note：与 baseline 比对 title / tags / markdown，任一不同即 dirty。
 */
function isDirty(state: CurrentEditorState): boolean {
  if (state.loading) return false;
  if (state.decryptFailed) return false;
  if (state.kind === "new") return true;
  if (state.title !== state.baseline.title) return true;
  if (state.tags.join(",") !== state.baseline.tags.join(",")) return true;
  if (state.markdown !== state.baseline.markdown) return true;
  return false;
}

function formatProtocolError(code: ProtocolErrorCode, message: string): string {
  const map: Record<ProtocolErrorCode, string> = {
    invalid_request: "无效请求",
    invalid_origin: "来源非法",
    user_rejected: "用户在 Keymaster 中取消",
    active_key_unavailable: "当前 Keymaster 没有可用 active key",
    decrypt_failed: "解密失败（可能 origin / active key 切换）",
    internal_error: "Keymaster 内部错误"
  };
  return `${map[code]}: ${message}`;
}

function formatTransportError(error: unknown): string {
  if (error instanceof ProtocolTransportError) {
    const map: Record<string, string> = {
      popup_blocked: "popup 被浏览器拦截",
      popup_closed: "popup 在协议完成前被关闭",
      ready_timeout: "等待 popup ready 超时",
      result_timeout: "等待 result 超时",
      invalid_origin: "消息来源非法",
      session_busy: "popup session 繁忙",
      no_session: "无 session"
    };
    return `${map[error.code] ?? error.code}: ${error.message}`;
  }
  if (error instanceof Error) return `${error.name}: ${error.message}`;
  return String(error);
}

/**
 * 把持久层 notes 与当前 editor state（可能未持久化）合并后再做"同目录重名"判断。
 */
function isNoteTitleConflictWithEditor(
  persisted: Record<string, StoredNoteRecord>,
  folderId: string | null,
  title: string,
  excludeNoteId: string | null,
  editorState: CurrentEditorState | null
): boolean {
  const trimmed = title.trim();
  for (const n of Object.values(persisted)) {
    if (excludeNoteId !== null && n.id === excludeNoteId) continue;
    if (n.folderId !== folderId) continue;
    if (n.title.trim() === trimmed) return true;
  }
  if (
    editorState &&
    editorState.noteId !== excludeNoteId &&
    editorState.folderId === folderId &&
    editorState.title.trim() === trimmed
  ) {
    return true;
  }
  return false;
}
