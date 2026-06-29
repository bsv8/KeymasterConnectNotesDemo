// src/App.tsx
// Notes Demo 页面级状态与编排。
//
// 设计缘由（施工单 2026-06-26 save-switch-current-editor-state 第 4-10 章 +
//          施工单 2026-06-27 note-open-cancel-and-transport-hard-switch
//          第 4-10 章 +
//          施工单 2026-06-27 notion-document-toolbar-and-mobile-sidebar
//          第 3 / 4 / 5 / 6 章 +
//          施工单 2026-06-27 note-search-results-and-tree-expand-persistence
//          第 4-11 章 +
//          施工单 2026-06-28 001 connect-session-bound-key-integration
//          硬切换第 1-9 章 +
//          施工单 2026-06-28 003 lock-screen-popup-close-and-relogin
//          硬切换第 4.2 / 4.3 / 5.1 / 5.2 章）：
//   - 顶层固定两态：`session === null` 时只渲染 `LockScreen`；已认证才渲染工作区。
//   - **connect session 状态机**（施工单 2026-06-28 001 第 4.1 / 8.3 章）：
//       - 登录真值 = `connectSessionId`；
//       - owner 真值 = `connectSession.ownerPublicKeyHex`（**session 绑定 key**）；
//       - popup transport 断开 ≠ 登录失效；
//       - popup refresh = unlock runtime 失效，session 仍在；下一次请求走
//         `connect.resume`，只要求输入密码；
//       - caller 主动 logout 才退回登录壳。
//   - 三层状态在 UI 上的对应：
//       - `popup transport state`（`popupState`）：`idle` / `opening` /
//         `connected` / `disconnected`，只来自 transport；
//       - `connect auth state`（`session === null ? "anonymous" : ...`）：
//         `anonymous` / `resuming` / `authenticated` / `invalid`；
//       - `workspace state`（`currentEditorState`）：`locked` /
//         `restoring`（解密中） / `unlocked` / `failed`（decryptFailed）。
//   - 启动时：读取本地 `connectSession`；若有 → 自动 `resume`；若 resume
//     命中"session 无效" → 清本地 + 退回登录壳。
//   - **不再**把 `identity.get` 当登录入口真值；本 demo 只发 `connect.login`
//     / `connect.resume` / `connect.logout`。
//   - `cipher.*` 请求**必须**带 `connectSessionId`；**不**读全局 active key。
//   - **锁屏页 popup_closed 收口**（施工单 2026-06-28 003 第 4.2 / 5.1 / 5.2 章）：
//       - `popup_closed` 在**锁屏态**的 login / resume 流程里**不**展示为用户可见
//         错误，**不**清本地 session；停留在锁屏页；用户下次再点主按钮时重新
//         开 popup。
//       - 真实 `popup_blocked`（`window.open(...) === null`）仍走现有错误映射，
//         不能为了压掉 `popup_closed` 噪音把 transport 真值一起吞掉。
//   - **重新登录不预清本地 session**（施工单 2026-06-28 003 第 4.3 / 5.4 章）：
//       - 点击"重新登录"保留本地 session 记录，直接发起一次新 `connect.login`；
//       - 成功：用新 session 覆盖旧 session；
//       - 失败：旧 session 不动，锁屏页仍可继续显示"恢复 session"。
//       - **不**调 `clearConnectSession()`，**不**复用旧 sessionId。
//   - 锁屏页**不再**展示"忘掉当前 session"按钮（施工单 2026-06-28 003
//     第 4.5 / 5.6 章）。
//   - 旧章节里针对 `identity.get` / owner 快照 / pendingDrafts / decryptedCache
//     / selection hydration 等行为全部保留，仅把 owner 真值从 `identity.get`
//     替换为 `connectSession.ownerPublicKeyHex`。

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { normalizeOrigin, ProtocolTransportError, type ProtocolLogEvent } from "./lib/connectClient";
import { PopupSessionClient } from "./lib/popupSessionClient";
import type { ProtocolErrorCode } from "./lib/protocol";
import {
  buildCipherDecryptRequest,
  buildCipherEncryptRequest,
  buildConnectLoginRequest,
  buildConnectLogoutRequest,
  buildConnectResumeRequest,
  parseCipherDecryptResult,
  parseCipherEncryptResult,
  parseConnectSessionResult
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
  clearConnectSession,
  createFolder,
  deleteFolder,
  deleteNote,
  deleteOwnerSpace,
  findAvailableName,
  getFolder,
  isFolderEmpty,
  isFolderTitleConflict,
  isNoteTitleConflict,
  loadConnectSession,
  loadOwnerSpace,
  moveFolder,
  moveNote,
  putNote,
  renameFolder,
  saveConnectSession,
  saveOwnerSpace,
  type StoredConnectSessionRecord,
  type StoredNotesSpace
} from "./lib/storage";
import {
  ancestorFolderIds,
  buildTree,
  checkDragLegality,
  collectNotesInTreeOrder,
  folderPathSegments,
  type DragLegalityFailureCode
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
import { LockScreen, type LockScreenMode } from "./components/LockScreen";
import { NameInputDialog } from "./components/NameInputDialog";
import { SaveOverlayDialog } from "./components/SaveOverlayDialog";
import { SearchResultsPanel, buildSearchResults } from "./components/SearchResultsPanel";
import { LANGUAGE_DISPLAY, SUPPORTED_LANGUAGES } from "./i18n/types";
import { useI18n } from "./i18n/useI18n";

const DEFAULT_TARGET_ORIGIN = "https://keymaster.cc";
const READY_TIMEOUT_MS = 10_000;
const RESULT_TIMEOUT_MS = 60_000;
const POPUP_WIDTH = 520;
const POPUP_HEIGHT = 760;

/** 窄屏判定阈值：与 styles.css 中的媒体查询保持一致。 */
const MOBILE_BREAKPOINT = 720;

/**
 * Connect session 内存态（施工单 2026-06-28 001 第 4.2 / 8.3 章）。
 * 真值持久化在 `loadConnectSession / saveConnectSession / clearConnectSession`。
 *
 * 与 `IdentitySnapshot` 严格区分：
 *   - `IdentitySnapshot` 是旧的 `identity.get` 一次性身份断言；
 *   - 本接口是 connect session 真值；
 *   - 本 demo **不再**使用 `IdentitySnapshot`；它的字段命名已被替代为更明确的
 *     `ownerPublicKeyHex`（明确表达"该 session 绑定 key 的公钥"）。
 */
export interface ConnectSessionSnapshot {
  sessionId: string;
  ownerPublicKeyHex: string;
  claims: Record<string, unknown>;
  resolvedAt: number;
  targetOrigin: string;
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
  const { language, t, setLanguage } = useI18n();

  /* ============== 状态真值 ============== */

  const [targetOrigin, setTargetOrigin] = useState(DEFAULT_TARGET_ORIGIN);
  const [popupState, setPopupState] = useState<PopupUiState>("idle");
  /**
   * Connect session 真值（施工单 2026-06-28 001 第 4.2 / 4.4 / 8.3 章）。
   * - `null` ⇒ 未登录（"anonymous"）；
   * - 启动时自动从 `loadConnectSession()` 拉取；拉到 → 自动 `resume`；
   * - `resume` 失败 / 命中 session 无效 → 清本地 session，回 `null`。
   */
  const [session, setSession] = useState<ConnectSessionSnapshot | null>(null);
  /**
   * 当前正在跑的 connect 流程类型（用于锁屏与页头展示）。
   * - `null` = 没有在跑 connect 流程；
   * - `"login"` = 首次登录中；
   * - `"resume"` = 用本地 sessionId 自动 resume 中；
   * - `"logout"` = 主动 logout 中。
   */
  const [authFlow, setAuthFlow] = useState<"login" | "resume" | "logout" | null>(null);
  /** `resume` 流程中，session 被服务端判定无效 → 锁屏显示"恢复失败，请重新登录"。 */
  const [resumeFailed, setResumeFailed] = useState(false);
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

  /** 新建 note / folder 的默认基名（按当前语言；自动补编号时按 "基名 N" 递增）。 */
  const DEFAULT_NOTE_BASE_NAME = t("app.defaultNoteBaseName");
  const DEFAULT_FOLDER_BASE_NAME = t("app.defaultFolderBaseName");

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
  // 设计缘由（施工单 2026-06-28 001 第 6.7 章）：
  //   - 本地 connectSession 是 origin 绑定的，targetOrigin 改变 ⇒ 旧 session 失效；
  //   - 重建 popup session 同时清理旧 session（让上层 effect 走"本地 session
  //     与新 targetOrigin 不匹配"分支，退回登录壳）。
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

  /* ============== 启动时：自动读取本地 connect session 并 resume ============== */

  /**
   * 启动期 connect session 处理（施工单 2026-06-28 001 第 5.2 / 5.5 / 6.7 章）：
   *
   * 1. 读取本地 `StoredConnectSessionRecord`；
   * 2. 缺失 / 非法 → 不动 `session`，让用户走 `login`；
   * 3. 存在但 `targetOrigin` 与当前不一致 → 视为"跨 origin 复用"，
   *    清掉本地 session，**不**自动 resume；
   * 4. 存在且 origin 一致 → 标记 `authFlow = "resume"`，调 `connect.resume`；
   *    - 成功：写本地 session（refresh 时间戳 / claims）、进入工作区；
   *    - 命中"session 无效"（吊销 / key 删 / origin mismatch）：清本地 session，
   *      设 `resumeFailed = true`，让锁屏展示"恢复失败"；
   *    - 命中"需要解锁"（unlock required）：popup 解锁 UI 接管，本 caller
   *      走 `session.invalid === false` 分支，照常恢复。
   *
   * 边界（施工单 2026-06-28 001 第 5.2 / 6.7 / 9.2 章）：
   *   - 只跑**一次**（依赖 `[]`，mount 期触发）；
   *   - 与 `targetOrigin` effect 互不冲突：origin 变化会清 session，下次启动
   *     自然走 "跨 origin" 分支。
   *   - 本 demo **不**实现"refresh 后立刻 retry resume N 次"——
   *     popup 失败由用户主动点"重试 / 重新登录"。
   */
  useEffect(() => {
    const stored = loadConnectSession();
    if (!stored) return;
    if (stored.targetOrigin !== (normalizedTargetOrigin || targetOrigin)) {
      // 跨 origin：清掉旧 session（不允许跨 origin 复用）。
      clearConnectSession();
      setResumeFailed(true);
      return;
    }
    void performResume(stored);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* ============== 加载当前 owner 的空间 ============== */

  /**
   * `session` 变化 → 加载/清空 owner 分区。
   *
   * 设计缘由（施工单 2026-06-28 001 第 4.1 / 8.3 章）：
   *   - owner 真值 = `session.ownerPublicKeyHex`（session 绑定 key），不再是
   *     旧的 `identity.publicKeyHex`；
   *   - `session === null` ⇒ 清工作区，回到锁屏；
   *   - `session !== null` ⇒ 加载对应 owner 的 `StoredNotesSpace`。
   */
  useEffect(() => {
    if (!session) {
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
    const ownerHex = session.ownerPublicKeyHex;
    const loaded = loadOwnerSpace(ownerHex);
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
    const persistedExpanded = loadOwnerSidebarState(ownerHex);
    if (persistedExpanded === null) {
      // 首次进入：默认所有 folder 展开。
      setExpandedFolderIds(new Set(Object.keys(loaded.folders)));
    } else {
      const valid = persistedExpanded.filter((id) => Boolean(loaded.folders[id]));
      setExpandedFolderIds(new Set(valid));
    }
  }, [session?.ownerPublicKeyHex]);

  /**
   * `expandedFolderIds` 变化后**仅在已登录**时写回 localStorage。
   * 设计缘由（施工单 2026-06-27 第 4.7 / 5.5 章 + 2026-06-28 001 第 8.4 章）：
   *   - 已不存在的 folderId 在加载时已过滤；这里**也**在 `space.folders`
   *     变化时清理（见下方 effect）。
   *   - 退出工作区时 session 变 null，effect 不会再触发写回，避免脏写。
   */
  useEffect(() => {
    if (!session) return;
    saveOwnerSidebarState(session.ownerPublicKeyHex, [...expandedFolderIds]);
  }, [expandedFolderIds, session?.ownerPublicKeyHex]);

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

  /* ============== 登录 / 续登 / 注销 ============== */

  /**
   * 首次登录入口：调 `connect.login`。
   *
   * 设计缘由（施工单 2026-06-28 001 第 5.1 / 8.3 章）：
   *   - popup 若未解锁 → popup 解锁 UI 接管；解锁后用户选 key → 建立 session；
   *   - 成功拿到 `connectSessionId + ownerPublicKeyHex + claimsSnapshot` 后：
   *       * 写本地 `StoredConnectSessionRecord`；
   *       * 更新 `session` state → 触发 `useEffect` 加载 owner 分区。
   *   - 失败 → `setLastError`，**不**清本地 session（首次登录没有本地 session）。
   */
  const handleLogin = useCallback(async () => {
    if (!normalizedTargetOrigin) {
      setLastError(t("app.error.targetOriginInvalid"));
      return;
    }
    if (authFlow !== null) return; // 已有流程在跑，防御性
    setAuthFlow("login");
    setLastError(null);
    setResumeFailed(false);
    try {
      const popup = getSessionClient();
      const requestId = makeRequestId();
      const request = buildConnectLoginRequest({
        origin: currentOrigin,
        text: t("app.connect.login.requestText"),
        ttlSeconds: 300,
        requestId
      });
      const response = await popup.runRequest(request);
      if (!response.ok) {
        setLastError(formatProtocolError(response.error.code, response.error.message, t));
        return;
      }
      const parsed = parseConnectSessionResult(response.result as never);
      const record: StoredConnectSessionRecord = {
        v: 1,
        sessionId: parsed.connectSessionId,
        ownerPublicKeyHex: parsed.ownerPublicKeyHex,
        targetOrigin: normalizedTargetOrigin,
        claimsSnapshot: parsed.claims as Record<string, unknown>,
        resolvedAt: parsed.resolvedAt
      };
      saveConnectSession(record);
      setSession({
        sessionId: parsed.connectSessionId,
        ownerPublicKeyHex: parsed.ownerPublicKeyHex,
        claims: parsed.claims as Record<string, unknown>,
        resolvedAt: parsed.resolvedAt,
        targetOrigin: normalizedTargetOrigin
      });
      setPopupState("connected");
    } catch (err) {
      // 施工单 2026-06-28 003 第 4.2 / 5.1 章：锁屏态 login 流程里
      // `popup_closed` 只代表"这次尝试结束了"，不当作锁屏页错误展示。
      // 注意：不调用 `clearConnectSession()`——首次登录本来就没有本地 session。
      if (shouldSilenceErrorOnLockScreen(err)) {
        setLastError(null);
        return;
      }
      setLastError(formatTransportError(err, t));
    } finally {
      setAuthFlow(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [normalizedTargetOrigin, currentOrigin, t, authFlow]);

  /**
   * 用本地 `StoredConnectSessionRecord` 调 `connect.resume`。
   *
   * 设计缘由（施工单 2026-06-28 001 第 5.1.2 / 5.2 / 6.2 / 6.5 / 6.6 / 9.2 章 +
   *          review 反馈：失败码必须严格映射）：
   *   - 启动期与"用户主动点 resume" 共用同一份逻辑；
   *   - `popup` 解锁 UI 只在 popup 当前文档 unlocked runtime 失效时出现；
   *     不重新选 key，不重新走 login；
   *   - 服务端返回 `error.code` 的处理策略：
   *
   *       **视为 session 已永久失效 → 清本地 session + `resumeFailed = true`**：
   *         - `invalid_origin`：
   *             origin 与服务端记录的 session.origin 不一致。这是协议层
   *             **唯一明确表达"这条 session 与当前 caller 不匹配"** 的错误码。
   *
   *       **视为临时失败 → 不清本地 session，写 `lastError`，保留"恢复"按钮**：
   *         - `user_rejected`：用户在 popup 主动点了取消，可能是不小心、可能是
   *           想稍后再试；本地 session 仍合法，下次直接重试即可。
   *         - `active_key_unavailable`：绑定 key 当前没 ready，可能是被临时锁定
   *           或用户未解锁；按施工单 6.6 章"允许等待 key 恢复"语义，**不**清本地
   *           session，让用户等会儿再点 resume。
   *         - `internal_error`：协议层定义的"兜底：用户可见但不属于以上分类的失败"。
   *           显式**不**当作 session 失效——popup runtime 异常、后端瞬时错误、
   *           实现缺陷等都会落到这里；把这些一律判永久失效会让一次抖动直接赶走用户。
   *         - `invalid_request`：调用方请求本身有问题（理论上不应发生，但兜底）。
   *         - `decrypt_failed`：与本次 resume 流程无关（resume 不走 cipher），
   *           但作为兜底也按临时失败处理。
   *
   *       transport 错误（`popup_closed` / `ready_timeout` / `result_timeout` /
   *       `popup_blocked`）：由 catch 统一收口——按临时失败处理，不清本地 session。
   *
   *   - 总原则（review 反馈）：**保守收敛**——宁可让用户多按一次 resume，也**不要**
   *     因为一次临时失败就把人家赶回重新登录；只有协议层明确表达的"session 与
   *     当前 caller 不匹配"才走清 session 路径。
   *
   * 注意：
   *   - 不在成功路径上 patch `resolvedAt`（resume 不应变更 owner / claims，
   *     只刷新 `resolvedAt` 让 `lastLoginAt` 跟上）。
   */
  const performResume = useCallback(async (stored: StoredConnectSessionRecord) => {
    if (!normalizedTargetOrigin) {
      // 防御性：targetOrigin 已被改，但启动 effect 用的是旧的 → 直接清掉。
      clearConnectSession();
      setResumeFailed(true);
      return;
    }
    setAuthFlow("resume");
    setLastError(null);
    try {
      const popup = getSessionClient();
      const requestId = makeRequestId();
      const request = buildConnectResumeRequest({
        connectSessionId: stored.sessionId,
        requestId
      });
      const response = await popup.runRequest(request);
      if (!response.ok) {
        const code = response.error.code;
        if (code === "invalid_origin") {
          // 协议层**唯一明确**表达"session 与当前 caller 不匹配"的错误码：
          //   origin 与服务端记录的 session.origin 不一致。
          // 此时服务端已判定 session 与当前 caller 不匹配 → 清本地 + 标记恢复失败。
          clearConnectSession();
          setResumeFailed(true);
          return;
        }
        // 其它协议错误一律按临时失败处理：
        //   - 不清本地 session；
        //   - 写 lastError；
        //   - 锁屏层 `loadConnectSession()` 仍能拿到记录 → 用户可继续点 "恢复 session" 重试。
        setLastError(formatProtocolError(code, response.error.message, t));
        return;
      }
      const parsed = parseConnectSessionResult(response.result as never);
      // 服务端可能刷新了 ownerPublicKeyHex / claims / resolvedAt——以服务端为准。
      const next: StoredConnectSessionRecord = {
        v: 1,
        sessionId: parsed.connectSessionId,
        ownerPublicKeyHex: parsed.ownerPublicKeyHex,
        targetOrigin: stored.targetOrigin,
        claimsSnapshot: parsed.claims as Record<string, unknown>,
        resolvedAt: parsed.resolvedAt
      };
      saveConnectSession(next);
      setSession({
        sessionId: parsed.connectSessionId,
        ownerPublicKeyHex: parsed.ownerPublicKeyHex,
        claims: parsed.claims as Record<string, unknown>,
        resolvedAt: parsed.resolvedAt,
        targetOrigin: stored.targetOrigin
      });
      setPopupState("connected");
      setResumeFailed(false);
    } catch (err) {
      // 施工单 2026-06-28 003 第 4.2 / 5.2 章：锁屏态 resume 流程里
      // `popup_closed` 只代表"这次尝试结束了"——保留"恢复 session"按钮，
      // 让用户稍后重试或点"重新登录"。**不**清本地 session，**不**写 lastError。
      if (shouldSilenceErrorOnLockScreen(err)) {
        setLastError(null);
        return;
      }
      setLastError(formatTransportError(err, t));
    } finally {
      setAuthFlow(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [normalizedTargetOrigin, t]);

  /**
   * 用户主动点"恢复 session"按钮的入口。
   * 锁屏层 + 已登录页头都会触发；行为与启动期 resume 完全一致。
   */
  const handleResume = useCallback(async () => {
    const stored = loadConnectSession();
    if (!stored) {
      setResumeFailed(true);
      return;
    }
    if (stored.targetOrigin !== (normalizedTargetOrigin || targetOrigin)) {
      clearConnectSession();
      setResumeFailed(true);
      return;
    }
    if (authFlow !== null) return;
    await performResume(stored);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [normalizedTargetOrigin, targetOrigin, authFlow, performResume]);

  /**
   * 用户主动点"退出登录"按钮：调 `connect.logout`，清本地 session，回登录壳。
   *
   * 设计缘由（施工单 2026-06-28 001 第 4.4 / 5.1.3 / 6.6 章）：
   *   - 成功：清本地 session + 清工作区内存态 → 退回登录壳；
   *   - 失败（transport 抖动等）：按 6.6 节"无法确认服务端已吊销"分支，
   *     **保守**清本地 session + 提示用户；用户下次启动可走 `resume` 再收敛；
   *   - 不做多步补偿 / 不维护"待吊销 logout 队列"（6.6.1 章）。
   */
  const handleLogout = useCallback(async () => {
    if (!session) return;
    if (authFlow !== null) return;
    setAuthFlow("logout");
    setLastError(null);
    try {
      const popup = getSessionClient();
      const requestId = makeRequestId();
      const request = buildConnectLogoutRequest({
        connectSessionId: session.sessionId,
        requestId
      });
      const response = await popup.runRequest(request);
      if (!response.ok) {
        // 服务端吊销失败：仍走"保守清本地"路径，但 lastError 提示。
        setLastError(formatProtocolError(response.error.code, response.error.message, t));
      }
    } catch (err) {
      setLastError(formatTransportError(err, t));
    } finally {
      // 不论服务端是否成功吊销，本地一律清掉（6.6.1）。
      clearConnectSession();
      setSession(null);
      setAuthFlow(null);
      setResumeFailed(false);
      // closeSession 让 transport 也复位——下次 login / resume 走新会话。
      sessionRef.current?.closeSession();
      sessionRef.current = null;
      setPopupState("idle");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session, authFlow, t]);

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
    if (!session) return;
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
      markdown: t("editor.loading.placeholder"),
      baseline: {
        title: record.title,
        tags: [...record.tags],
        markdown: ""
      },
      loading: true,
      decryptFailed: false
    });

    const popup = getSessionClient();
    // 旧 pending decrypt 仍存在 → 立即 fire-and-forget cancel。
    // cancel 没有 ack，旧请求仍可能晚回来；本调用靠代际隔离丢弃它们。
    if (previous && previous.requestId !== myRequestId) {
      popup.cancelRequest(previous.requestId);
    }

    const request = buildCipherDecryptRequest({
      // 协议层 text 由调用方注入；这里只是 popup 提示语，使用当前语言即可。
      text: `${record.title}`,
      nonceBase64: record.cipher.nonceBase64,
      cipherbytesBase64: record.cipher.cipherbytesBase64,
      requestId: myRequestId,
      // 施工单 2026-06-28 001 第 5.2.2 章：cipher.* 必须带 connectSessionId。
      connectSessionId: session.sessionId
    });

    try {
      const response = await popup.runRequest(request);
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
        throw new Error(formatProtocolError(response.error.code, response.error.message, t));
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

      setDecryptError(formatTransportError(err, t));
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
    if (!session) return;
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
    if (!session) return;
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
    if (!session) return;
    const parentId = parentIdOverride === undefined ? resolveCreateParent() : parentIdOverride;
    setNameDialog({
      mode: { kind: "create-folder", parentId },
      title: t("app.newFolderDialog.title"),
      description: t("app.newFolderDialog.description"),
      initialValue: DEFAULT_FOLDER_BASE_NAME,
      placeholder: t("app.newFolderDialog.placeholder"),
      confirmLabel: t("app.newFolderDialog.confirmLabel")
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
        setLastError(t("app.error.createFolderFailed"));
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
        setLastError(t("app.error.renameFolderConflict"));
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
        setLastError(t("app.error.renameNoteConflict"));
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
      setLastError(t("app.error.renameNoteConflict"));
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
        return t("app.renameFolderConflictInline");
      }
      return null;
    }
    // rename-note
    const noteId = dialog.mode.noteId;
    if (currentEditorState && currentEditorState.noteId === noteId) {
      if (isNoteTitleConflictWithEditor(space.notes, currentEditorState.folderId, value, noteId, currentEditorState)) {
        return t("app.renameNoteConflictInline");
      }
      return null;
    }
    const target = space.notes[noteId];
    if (!target) return null;
    if (isNoteTitleConflict(space.notes, target.folderId, value, noteId)) {
      return t("app.renameNoteConflictInline");
    }
    return null;
  }

  function handleDeleteFolder(folderId: string) {
    if (!isFolderEmpty(space, folderId)) {
      setPendingDialog({
        title: t("app.folderNotEmpty.title"),
        message: t("app.folderNotEmpty.message"),
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
        title: t("app.moveFolderInvalid.title"),
        message: t("app.moveFolderInvalid.message"),
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
          title: t("app.moveNoteConflict.title"),
          message: t("app.moveNoteConflict.message"),
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
        title: t("app.moveNoteConflict.title"),
        message: t("app.moveNoteConflict.message"),
        onDismiss: () => setPendingDialog(null)
      });
      return;
    }
    commitSpace(next);
    setLastError(null);
  }

  function commitSpace(next: StoredNotesSpace) {
    setSpace(next);
    if (session) saveOwnerSpace(session.ownerPublicKeyHex, next);
  }

  /* ============== 保存 ============== */

  /**
   * 主动点击 save 按钮的入口。
   */
  async function handleSave() {
    if (!session || !currentEditorState) return;
    if (saveOverlay !== null) return; // 已经在阻塞态，不重复开。
    const state = currentEditorState;
    if (state.decryptFailed) {
      setLastError(t("app.error.cannotSaveDecryptFailed"));
      return;
    }
    if (state.loading) {
      // 防御性：UI 上 save 按钮已 disabled，但 handler 也再挡一次。
      setLastError(t("app.error.cannotSaveLoading"));
      return;
    }
    const titleCheck = validateTitle(state.title);
    if (!titleCheck.ok) {
      setLastError(`${t("app.error.saveFailure.prefix")}${t("titleError.empty")}`);
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
      setLastError(t("app.error.sameFolderConflict", { name: titleCheck.title }));
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
    if (!session || !currentEditorState || !saveOverlay) return;
    if (saveOverlay.mode !== "save-and-switch") return;
    const state = currentEditorState;
    if (state.decryptFailed) return; // 防御性：decryptFailed 走不到这里
    if (state.loading) return; // 防御性：loading 时无法保存
    const titleCheck = validateTitle(state.title);
    if (!titleCheck.ok) {
      setLastError(`${t("app.error.saveFailure.prefix")}${t("titleError.empty")}`);
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
      setLastError(t("app.error.sameFolderConflict", { name: titleCheck.title }));
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
    if (!session || !currentEditorState) return;
    const state = currentEditorState;
    const action = saveOverlay?.action ?? { kind: "none" };
    const draftAtSave = state;
    // 重置取消标志——本轮保存自己的"是否被取消"判定。
    saveCancelledRef.current = false;
    let didSucceed = false;
    try {
      const popup = getSessionClient();
      const request = buildCipherEncryptRequest({
        text: t("app.encrypt.requestText"),
        contentType: NOTE_CONTENT_TYPE,
        markdown: draftAtSave.markdown,
        requestId: makeRequestId(),
        // 施工单 2026-06-28 001 第 5.2.1 章：cipher.encrypt 必须带 connectSessionId。
        connectSessionId: session.sessionId
      });
      const response = await popup.runRequest(request);
      // 收到结果后再检查一次：用户在等待期间点了"取消"。
      if (saveCancelledRef.current) {
        // 用户已主动取消：忽略 popup 的结果，**不**写盘。
        return;
      }
      if (!response.ok) {
        setLastError(formatProtocolError(response.error.code, response.error.message, t));
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
      saveOwnerSpace(session.ownerPublicKeyHex, next);
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
        setLastError(formatTransportError(err, t));
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
      setLastError(translateDragReason(check.reason!, t));
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
      title: t("app.renameFolderDialog.title"),
      description: t("app.renameFolderDialog.description"),
      initialValue: target.title,
      placeholder: t("app.renameFolderDialog.placeholder"),
      confirmLabel: t("app.renameFolderDialog.confirmLabel")
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
      title: t("app.renameNoteDialog.title"),
      description: t("app.renameNoteDialog.description"),
      initialValue: initial,
      placeholder: t("app.renameNoteDialog.placeholder"),
      confirmLabel: t("app.renameNoteDialog.confirmLabel")
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
      setLastError(translateDragReason(check.reason!, t));
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
      // 翻译由 App 层统一收口：lib 层只返回结构化 segments，
      // 这里把每个 segment 转成当前语言字符串后用 " / " 拼起来。
      pathLabelFor: (folderId) => {
        const segments = folderPathSegments(viewSpace.folders, folderId);
        const parts = segments.map((seg) =>
          seg.kind === "root"
            ? t("sidebar.root.name")
            : seg.title || t("sidebar.placeholder.folder")
        );
        return parts.join(" / ");
      }
    });
  }, [isSearchMode, viewSpace, searchQuery, activeTag, t]);

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
    if (check.ok) return null;
    // UI 层按 failure.code 翻译——**不**直接展示 lib 层兜底消息。
    // lib 层 message 字段仅供 log / 调试；展示层只信 code。
    if (check.failure.code === "empty") return t("titleError.empty");
    return null;
  }, [currentEditorState, t]);

  const ownerLabel = session ? truncate(session.ownerPublicKeyHex, 8) : "";

  /**
   * 给 NoteEditor 的 `editable` 标志。
   * 边界：未登录 / decryptFailed / loading / 保存阻塞态 → 不可编辑。
   */
  const editorEditable =
    !!session &&
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
        ? t("app.banner.decryptFailed", { error: decryptError ?? "" })
        : decryptError;
    }
    if (bannerKind === "move") {
      return t("app.banner.moveMode");
    }
    return null;
  }, [bannerKind, lastError, decryptError, currentEditorState?.decryptFailed, t]);

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
    // 施工单 2026-06-28 001 第 4.4 / 8.3 章：退回登录壳清本地 session + 工作区。
    setSession(null);
    clearConnectSession();
    setAuthFlow(null);
    setResumeFailed(false);
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
    if (!session || authFlow !== null) return;
    const ownerHex = session.ownerPublicKeyHex;
    setConfirmDialog({
      title: t("app.deleteDataConfirm.title"),
      message: t("app.deleteDataConfirm.message"),
      confirmLabel: t("app.deleteDataConfirm.confirm"),
      cancelLabel: t("app.deleteDataConfirm.cancel"),
      onCancel: () => setConfirmDialog(null),
      onConfirm: () => {
        setConfirmDialog(null);
        const ok = deleteOwnerSpace(ownerHex);
        if (!ok) {
          setLastError(t("app.error.deleteCurrentDataFailed"));
          return;
        }
        exitWorkspace();
      }
    });
  }

  /* ============== 顶层渲染 ============== */

  /**
   * 锁屏层 mode 推导（施工单 2026-06-28 001 第 4.3 章）：
   *   - `login` ：无本地 session，等用户输入 target origin 后点登录；
   *   - `resume`：有本地 session，自动 / 手动 resume 中（不允许重复点击）；
   *   - `resumeFailed`：resume 失败 / 跨 origin / 本地记录损坏；展示恢复失败。
   *
   * 锁屏层不再区分"需要登录 / 正在恢复 / 恢复失败"为多个组件，全部由
   * `LockScreen` 内部按 `mode` 自行切。
   */
  const lockScreenMode: LockScreenMode = (() => {
    if (authFlow === "resume") return "resume";
    if (resumeFailed) return "resumeFailed";
    if (authFlow === "login") return "login";
    return "login";
  })();

  // 未登录态：只渲染 LockScreen；不显示 notes 工作区任何部分。
  //
  // 设计缘由（施工单 2026-06-28 001 第 4.3 / 5.2 章 +
  //          review 反馈：临时失败后必须仍可重新 resume）：
  //   - 锁屏层永远把"本地已记住的 session"（若存在）下发给 `LockScreen`；
  //     锁屏根据 `mode` 决定是否显示"恢复 session"按钮：
  //       * `resume` → 始终显示（用户主动点的 resume 进行中）；
  //       * `resumeFailed` → **不**显示（服务端已判定无效；本地 session 已清，
  //         `loadConnectSession` 也会返回 null）；
  //       * `login` + 有 stored session → 显示，并允许用户重试 resume（关键）：
  //           - 这正是 review 反馈的"临时失败后必须仍可重新 resume"；
  //           - 临时失败包括 `user_rejected`、transport 异常、`internal_error` 等
  //             **非 session 失效** 类失败；
  //           - 这类失败下 `clearConnectSession()` 没被调，`loadConnectSession()`
  //             仍能拿到记录 → `LockScreen` 即可继续渲染"恢复 session"按钮。
  //   - 不再"只在 `resumeFailed` 或正在 `resume` 时才把 `storedSession` 传给
  //     LockScreen"——那会把临时失败场景下"用户点 Resume 但被弹回登录壳"的恢复路径打断。
  if (!session) {
    const stored = loadConnectSession();
    return (
      <LockScreen
        mode={lockScreenMode}
        targetInput={targetOrigin}
        defaultTargetOrigin={DEFAULT_TARGET_ORIGIN}
        lastError={lastError}
        isLoggingIn={authFlow !== null}
        storedSession={
          stored
            ? {
                sessionId: stored.sessionId,
                ownerPublicKeyHex: stored.ownerPublicKeyHex,
                targetOrigin: stored.targetOrigin,
                resolvedAt: stored.resolvedAt
              }
            : null
        }
        onTargetInputChange={setTargetOrigin}
        onUseDefault={() => setTargetOrigin(DEFAULT_TARGET_ORIGIN)}
        onLogin={() => void handleLogin()}
        onResume={() => void handleResume()}
      />
    );
  }

  // 已登录态：渲染完整 notes 工作区。
  const sidebarOpen = isSidebarOpenOnMobile !== false; // null / true → 视为展开

  return (
    <div className="app-shell">
      <header className="app-header">
        <div className="app-header__brand">
          <span className="app-header__eyebrow">{t("app.brand")}</span>
          <h1>{t("app.demoName")}</h1>
          <p>{t("app.demoDescription")}</p>
        </div>
        <button
          type="button"
          className="app-header__sidebar-toggle"
          onClick={() => setIsSidebarOpenOnMobile((v) => !(v ?? false))}
          aria-label={sidebarOpen ? t("header.sidebar.toggle.expand") : t("header.sidebar.toggle.collapse")}
          aria-expanded={sidebarOpen}
        >
          {sidebarOpen ? t("header.sidebar.toggle.close") : t("header.sidebar.toggle.open")}
        </button>
        <label className="app-header__theme">
          <span>{t("header.theme.label")}</span>
          <select
            value={themePreference}
            onChange={(e) => setThemePreference(e.target.value as AppThemePreference)}
            aria-label={t("header.theme.aria")}
          >
            <option value="dark">{t("header.theme.dark")}</option>
            <option value="light">{t("header.theme.light")}</option>
            <option value="system">{t("header.theme.system")}</option>
          </select>
        </label>
        <label className="app-header__language">
          <span>{t("header.language.label")}</span>
          <select
            value={language}
            onChange={(e) => setLanguage(e.target.value as typeof language)}
            aria-label={t("header.language.aria")}
          >
            {SUPPORTED_LANGUAGES.map((code) => (
              <option key={code} value={code}>
                {LANGUAGE_DISPLAY[code]}
              </option>
            ))}
          </select>
        </label>
        <ConnectStatus
          state={popupState}
          currentOrigin={currentOrigin}
          targetOrigin={normalizedTargetOrigin || targetOrigin}
          publicKeyHex={session?.ownerPublicKeyHex ?? null}
          sessionId={session?.sessionId ?? null}
          lastLoginAt={session?.resolvedAt ?? null}
          isLoggingIn={authFlow !== null}
          onLogin={() => void handleLogin()}
          onResume={() => void handleResume()}
          onForget={handleSwitchIdentity}
          onLogout={() => void handleLogout()}
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
              {t("action.cancel")}
            </button>
          ) : null}
          {bannerKind === "error" ? (
            <button
              type="button"
              className="app-banner__action"
              onClick={() => setLastError(null)}
            >
              {t("app.banner.dismiss")}
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
          disabled={authFlow !== null}
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
              language={language}
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
                  !!session &&
                  authFlow === null &&
                  !currentEditorState.decryptFailed &&
                  !currentEditorState.loading &&
                  !isBlockingSave
                }
                canDelete={!!session && authFlow === null && !isBlockingSave}
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
                  placeholder={t("note.title.placeholder")}
                  disabled={
                    !!currentEditorState.decryptFailed ||
                    currentEditorState.loading ||
                    isBlockingSave
                  }
                  spellCheck={false}
                />
                <span className="document-head__hint">
                  {currentEditorState.kind === "new"
                    ? t("note.head.hint.new")
                    : currentEditorState.loading
                      ? t("note.head.hint.loading")
                      : t("note.head.hint.persisted")}
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
              <h2>{t("folder.empty.title", { title: currentFolder.title || t("sidebar.toolbar.title.fallbackFolder") })}</h2>
              <p>{t("folder.empty.description")}</p>
            </div>
          ) : (
            <div className="document-panel__empty">
              <h2>{t("root.empty.title")}</h2>
              <p>{t("root.empty.description")}</p>
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
                {t("action.acknowledge")}
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

function formatProtocolError(
  code: ProtocolErrorCode,
  message: string,
  t: (key: import("./i18n/types").MessageKey, values?: import("./i18n/types").InterpolationValues) => string
): string {
  const keyByCode: Record<ProtocolErrorCode, import("./i18n/types").MessageKey> = {
    invalid_request: "error.protocol.invalid_request",
    invalid_origin: "error.protocol.invalid_origin",
    user_rejected: "error.protocol.user_rejected",
    active_key_unavailable: "error.protocol.active_key_unavailable",
    decrypt_failed: "error.protocol.decrypt_failed",
    internal_error: "error.protocol.internal_error"
  };
  return `${t(keyByCode[code])}: ${message}`;
}

/**
 * 把 `checkDragLegality` 的 reason code 翻译成当前语言的展示文案。
 * 单一收口入口——避免在 handler 里反复写 `t("drag.reason." + code)`。
 */
function translateDragReason(
  reason: DragLegalityFailureCode,
  t: (key: import("./i18n/types").MessageKey, values?: import("./i18n/types").InterpolationValues) => string
): string {
  const keyByCode: Record<DragLegalityFailureCode, import("./i18n/types").MessageKey> = {
    drop_to_note: "drag.reason.drop_to_note",
    drop_to_self: "drag.reason.drop_to_self",
    drop_to_descendant: "drag.reason.drop_to_descendant",
    drop_to_missing_source: "drag.reason.drop_to_missing_source"
  };
  return t(keyByCode[reason]);
}

function formatTransportError(
  error: unknown,
  t: (key: import("./i18n/types").MessageKey, values?: import("./i18n/types").InterpolationValues) => string
): string {
  if (error instanceof ProtocolTransportError) {
    const keyByCode: Record<string, import("./i18n/types").MessageKey> = {
      popup_blocked: "error.transport.popup_blocked",
      popup_closed: "error.transport.popup_closed",
      ready_timeout: "error.transport.ready_timeout",
      result_timeout: "error.transport.result_timeout",
      invalid_origin: "error.transport.invalid_origin",
      session_busy: "error.transport.session_busy",
      no_session: "error.transport.no_session"
    };
    return `${t(keyByCode[error.code] ?? ("error.transport.no_session"))}: ${error.message}`;
  }
  if (error instanceof Error) return `${error.name}: ${error.message}`;
  return String(error);
}

/**
 * 锁屏态 login / resume 流程里"是否应静默吞掉"的判定。
 *
 * 设计缘由（施工单 2026-06-28 003 第 4.2 / 5.1 / 5.2 章）：
 *   - `popup_closed` 在锁屏态只代表"这次尝试结束了"——用户可能手动关 popup、
 *     popup 锁屏、稍后再试；**不**自动算锁屏页错误；
 *   - 真实 `popup_blocked`（浏览器未允许开窗）仍必须展示给用户；
 *   - 其它 transport / protocol 错误在锁屏态仍按既有策略处理。
 *
 * 收口位置：
 *   - 不放到 transport 层，避免污染底层真值；
 *   - 不在 LockScreen 组件里判，避免把业务错误映射漏到 UI 层；
 *   - 仅服务锁屏态 `handleLogin` / `performResume` 这两个流程，不扩展成通用 transport 框架。
 */
function shouldSilenceErrorOnLockScreen(error: unknown): boolean {
  return error instanceof ProtocolTransportError && error.code === "popup_closed";
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
