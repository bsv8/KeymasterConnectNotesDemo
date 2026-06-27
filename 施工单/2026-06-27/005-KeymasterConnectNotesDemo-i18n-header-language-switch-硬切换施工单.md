# KeymasterConnectNotesDemo 多语言与 Header 语言切换硬切换一次性施工单

## 1. 本单定位

本单不是“先在 `header` 放一个语言下拉框，剩下文案以后再补”的过渡方案，也不是“先接一个 i18n 库，再慢慢迁文案”的分步计划。

本单定义一次**硬切换**，目标是把当前 demo 从：

- 用户可见文案大面积硬编码在组件内；
- 语言固定为中文；
- `header` 没有语言入口；
- 日期/状态文案不跟随语言；

切到下面这套新定义：

- 系统支持三种语言：`en`、`zh-CN`、`ja`
- `header` 提供稳定的语言切换入口
- 首屏先决定语言，再渲染 React
- 所有用户可见文案统一走一套轻量 i18n 字典
- `<html lang>` 与当前语言同步
- 日期/时间展示跟随当前语言

后续实现、联调、验收均以本单为单真值。若与当前代码、临时实现、口头理解冲突，以本单为准。

## 2. 简述缘由

### 2.1 这不是“做个下拉框”，而是系统级文案真值切换

如果只在 `header` 上加语言切换，而页面主体继续大量硬编码中文，会立刻出现这些问题：

1. 用户以为系统支持多语言，实际切换后只有局部变化；
2. 登录页、sidebar、banner、弹窗、空态、错误提示仍然固定中文；
3. 新文案继续随手写死，系统没有统一入口；
4. 后续每个组件都可能再长出各自的“临时翻译写法”。

因此这次必须把“语言切换”定义为**用户可见文案真值切换**，而不是一个视觉控件。

### 2.2 当前项目体量不适合引入重型 i18n 体系

参考 `/home/david/Workspaces/keymaster.cc` 的核心价值，不是“必须上 `i18next`”，而是：

- 语言状态自己可控；
- 浏览器语言映射规则明确；
- `localStorage` 持久化语义明确；
- 组件侧通过 hook 取文案，不直接散用底层实现；
- `<html lang>` 在首屏前写入。

当前 demo 没有插件资源动态装载、没有多 namespace、没有复杂插值体系。  
因此最合理的方案不是上重库，而是做一套**轻量、自解释、可控**的 i18n 基础层。

这更符合本项目“简单优先、边缘失败别把系统复杂度拉高”的方向。

### 2.3 多语言必须一次收口，不接受组件各自为政

当前用户可见文案分散在：

1. [src/App.tsx](/home/david/Workspaces/KeymasterConnectNotesDemo/src/App.tsx)
2. [src/components/LockScreen.tsx](/home/david/Workspaces/KeymasterConnectNotesDemo/src/components/LockScreen.tsx)
3. [src/components/NotesSidebar.tsx](/home/david/Workspaces/KeymasterConnectNotesDemo/src/components/NotesSidebar.tsx)
4. [src/components/DocumentToolbar.tsx](/home/david/Workspaces/KeymasterConnectNotesDemo/src/components/DocumentToolbar.tsx)
5. [src/components/ConnectStatus.tsx](/home/david/Workspaces/KeymasterConnectNotesDemo/src/components/ConnectStatus.tsx)
6. [src/components/SearchResultsPanel.tsx](/home/david/Workspaces/KeymasterConnectNotesDemo/src/components/SearchResultsPanel.tsx)
7. 其他输入弹层、错误映射、空态与提示文案

如果不一次收口，系统很快会退化成：

- 有的组件用字典；
- 有的组件继续硬编码；
- 有的组件自己拼接中文；
- 有的组件只翻一半。

这类状态比“暂时只有中文”更糟，因为它会制造长期维护噪音。

## 3. 本次硬切换的最终目标

本次完成后，系统必须达到以下状态：

1. 支持语言固定为 `en`、`zh-CN`、`ja`。
2. `header` 存在稳定语言切换入口。
3. 首屏渲染前先完成语言解析与 `<html lang>` 写入。
4. 用户手动切换语言后，刷新页面仍保持该选择。
5. 未手动选择时，系统按浏览器语言自动落到受支持语言。
6. 所有用户可见文案统一走 i18n 字典，不允许继续散落硬编码中文。
7. 日期/时间展示跟随当前语言。
8. 协议错误码、内部状态值、存储结构不因为多语言而改变。
9. 语言切换不影响 notes 数据、选中态、树展开态、主题态与登录态。
10. 未来新增文案时，有唯一明确入口可扩展。

## 4. 最终方案定义

## 4.1 支持语言

本单固定只支持以下三种语言：

- `en`
- `zh-CN`
- `ja`

不在本单中引入：

- `auto` 作为用户可选项
- `zh-TW`
- `ko`
- 任意“浏览器语言原样透传”

原因很直接：

1. 当前需求只明确要三种语言；
2. 多一门语言就多一整套文案维护成本；
3. “浏览器给什么就按什么”会把系统语言边界变得不清楚。

## 4.2 语言模式语义

系统只有两种内部模式：

1. `auto`
2. `manual`

语义定义如下：

- 首次进入且无持久化记录：`auto`
- 用户在 `header` 手动切过语言：`manual`
- `manual` 下刷新页面，继续使用用户上次选择
- 本单**不**提供“切回自动”的 UI 入口

这是一个刻意收缩的决定。

原因：

1. 当前需求只要求提供英/简中/日语切换；
2. `header` 上再加“跟随浏览器”会增加一个多余分支；
3. 本单先把“手动切换稳定可用”做实，避免为了完整性增加复杂度。

内部仍保留 `auto` 语义，是为了：

- 首屏无记录时有稳定默认行为；
- 以后若要补“跟随浏览器”入口，不需要推翻底层结构。

## 4.3 浏览器语言解析规则

浏览器语言映射规则固定如下：

- `en` / `en-*` -> `en`
- `zh` / `zh-*` -> `zh-CN`
- `ja` / `ja-*` -> `ja`
- 其他全部回退到 `en`

这里不做：

- 地域猜测
- IP 推断
- 时区推断
- “脚本标签更细分”的扩展逻辑

原因：

1. 当前目标只是把语言落到受支持集合；
2. `zh-Hans`、`zh-TW`、`zh-HK` 在本系统都统一折到 `zh-CN`；
3. 没有 `ja-JP` 之外的额外资源差异，不需要更复杂分流。

## 4.4 文案组织方式

本单要求新增一套轻量字典资源，建议形态如下：

1. 语言类型定义
2. message 字典对象
3. `t(key)` / `format` 风格的轻量访问函数
4. React hook：`useI18n()`

文案组织原则：

1. 所有用户可见文案都走 key，不允许在组件内直接写中文/英文/日文展示文本
2. key 稳定、英文命名、面向语义，不面向页面临时结构
3. 允许少量插值
4. 不做运行时远程加载
5. 不拆 namespace，不做懒加载语言包

原因：

1. 当前 demo 规模不值得上复杂资源组织；
2. 所有文案本地静态打包，最直接；
3. namespace/懒加载只会带来更多失配面。

## 4.5 首屏初始化语义

在 React 挂载前，必须先完成：

1. 读取语言持久化记录
2. 若无记录则解析浏览器语言
3. 得到最终语言
4. 写入 `<html lang="...">`

然后才挂载 React。

原因：

1. 否则首屏会先闪默认语言，再切到目标语言；
2. `html[lang]` 应与真实语言同步，利于可访问性与浏览器行为；
3. 这与当前主题首屏预应用的做法一致，边界清楚。

## 4.6 Header 语言切换入口定义

`header` 必须新增语言切换器，放在主题选择器同一组控制区域。

行为要求：

1. 当前值显示为用户正在使用的语言
2. 切换后立即全页文案重渲染
3. 切换后写入持久化
4. 不弹确认框
5. 不刷新页面
6. 不影响当前编辑状态

建议展示名称直接用各自语言自称：

- `English`
- `简体中文`
- `日本語`

这样比“English / Chinese / Japanese”更清晰，也避免当前语言看不懂其他选项。

## 4.7 日期与时间展示

所有 `toLocaleString()` 这类展示必须显式带当前语言 locale。

原因：

1. 否则 UI 文案切成日语后，时间仍可能按浏览器默认语言格式显示；
2. 同一页面会出现“文案语言”和“时间格式语言”不一致；
3. 这是用户感知非常直接的错位。

本单要求：

- 用户可见的日期/时间展示统一跟随当前语言

本单不要求：

- 自定义统一日期模板
- 引入 `date-fns` / `dayjs`

继续使用原生 `Intl` / `Date` 即可。

## 5. 特殊情况与提前决策

## 5.1 localStorage 不可用

若语言持久化读写失败：

- 不报错中断
- 不额外弹错误横条
- 直接退化为当前运行时解析出的语言

原因：

1. 语言持久化失败不应阻断主业务；
2. 这类失败常见于隐私模式或浏览器限制；
3. 为此增加复杂容错收益很低。

## 5.2 浏览器语言不受支持

若浏览器语言不是 `en` / `zh-*` / `ja-*`：

- 一律回退到 `en`

不能做的事：

- 回退到中文
- 根据当前系统时区猜日语或英语
- 报错要求用户手动选择

`en` 作为默认语言最稳妥，也最符合当前系统已有英文字段与协议语义。

## 5.3 新增文案但漏翻一门语言

这是实现时必须正面处理的问题。

本单要求字典结构采用“每个 key 三语都必须存在”的静态方式，让 TypeScript 在开发期暴露缺口。

不能接受：

1. 某个 key 只写中文和英文，日语临时缺失
2. 运行时发现缺 key 再默默显示 key 名
3. 在组件里写 `t("xxx") || "中文兜底"`

原因：

1. 这种兜底会掩盖问题；
2. 最终系统会带着残缺翻译上线；
3. 开发期类型约束远比运行时补洞更干净。

## 5.4 用户数据与默认新建名

像“新 note”“新文件夹”“未命名 note”这类展示文案需要区分两层：

1. **真实存储值**
2. **仅展示用 fallback**

本单要求：

- 真实创建默认名也走当前语言
- 仅展示 fallback 文案也走当前语言

特殊点在于：

- 如果用户在中文环境下创建了“新文件夹”，以后切到英文，这条记录的真实 title 仍然是中文，这是正确行为
- 系统不能因为切语言去改写已有用户数据

因此规则是：

1. **新创建时**按当前语言生成默认名
2. **已存量数据**保持原值，不做迁移
3. **空标题展示 fallback**按当前语言显示

## 5.5 协议错误与内部错误码

本单不改变协议层 error code，也不把内部状态值翻译进业务真值。

例如：

- `invalid_request`
- `user_rejected`
- `active_key_unavailable`

这些 code 仍保持英文稳定值；  
变化的只有“映射给用户看的说明文案”。

这样可以避免：

1. 协议语义受 UI 语言影响
2. 调试、日志、分支判断因为翻译而变脆弱
3. 存储层、逻辑层被迫感知多语言

## 5.6 排序行为

本单**不**把树排序、搜索排序改成“按当前语言 locale 重新排序”。

继续保持现有基于标题字符串的稳定排序语义即可。

原因：

1. 当前需求是多语言 UI，不是多语言内容排序；
2. 若切语言就改排序，文件树会在用户不改数据的前提下重排，感知更差；
3. 这会把“语言切换”耦合到“业务顺序变化”，不值得。

## 6. 不能怎么做

下面这些做法本单明确禁止：

1. 只改 `header`，其余页面继续硬编码中文。
2. 先引入 `i18next` / `react-i18next`，再说“以后再慢慢接文案”。
3. 在组件里混用三种写法：
   - 一部分 `t(key)`
   - 一部分本地 `const labels = {}`
   - 一部分直接硬编码字符串
4. 把内部 error code、存储值、状态机枚举直接翻译成多语言真值。
5. 为了少改代码，在渲染点写大量 `language === "ja" ? ... : ...` 三元表达式。
6. 让缺失翻译在运行时静默回退成 key 名。
7. 顺手改主题、布局、树逻辑、搜索逻辑、协议流程等与本单无关的能力。
8. 切语言时刷新页面或重置当前编辑状态。
9. 因为要做多语言，顺手新增“设置页”“语言详情页”“自动模式开关”等新功能面。
10. 引入运行时远程拉语言包、懒加载 namespace、动态注册资源这类超出当前体量的机制。

## 7. 推荐实现骨架

## 7.1 新增轻量 i18n 基础层

建议新增一个 `src/i18n/` 目录，职责拆分如下：

1. `types.ts`
   - 定义 `SupportedLanguage`
   - 定义 message key 与字典类型
2. `languageMap.ts`
   - 负责浏览器语言归一与映射
3. `i18nStore.ts`
   - 负责语言状态、持久化、`<html lang>` 同步、订阅
4. `messages.ts`
   - 维护三语字典
5. `useI18n.ts`
   - React hook，向组件暴露 `t`、`language`、`setLanguage`
6. 可选 `format.ts`
   - 若日期格式封装需要单独收口

核心原则：

- 不依赖第三方 i18n 库
- 只做这次需求真正需要的最小能力

## 7.2 文案访问方式

组件侧统一按以下思路使用：

1. `const { t, language } = useI18n()`
2. 所有展示文本都通过 `t(...)`
3. 日期通过 `toLocaleString(language)`

不能做：

1. 每个组件自己 import 一份 messages 常量
2. 每个组件自己读写 localStorage
3. 每个组件自己从 `navigator.language` 猜语言

## 8. 文件级实施方案

## 8.1 新增 [src/i18n/types.ts](/home/david/Workspaces/KeymasterConnectNotesDemo/src/i18n/types.ts)

目标：

- 定义系统支持语言与字典类型边界。

需要做的事：

1. 定义 `SupportedLanguage = "en" | "zh-CN" | "ja"`
2. 定义 message 字典类型，确保每个 key 三语齐全
3. 定义语言持久化模式类型（`auto` / `manual`）

不能做的事：

1. 把 message key 放成任意字符串无约束
2. 允许单门语言缺失

## 8.2 新增 [src/i18n/languageMap.ts](/home/david/Workspaces/KeymasterConnectNotesDemo/src/i18n/languageMap.ts)

目标：

- 负责浏览器语言解析与系统支持语言映射。

需要做的事：

1. 规范化语言标签
2. 实现浏览器语言到 `en` / `zh-CN` / `ja` 的映射
3. 提供 `resolveBrowserLanguage(...)`

不能做的事：

1. 混入 localStorage 逻辑
2. 直接读 DOM
3. 把“不支持语言”原样返回

## 8.3 新增 [src/i18n/i18nStore.ts](/home/david/Workspaces/KeymasterConnectNotesDemo/src/i18n/i18nStore.ts)

目标：

- 作为语言状态单真值。

需要做的事：

1. 读写 `localStorage`
2. 维护 `auto` / `manual`
3. 首屏应用最终语言
4. 同步 `<html lang>`
5. 提供订阅能力

不能做的事：

1. 把 React hook 写在这个文件里
2. 让组件直接依赖本文件内部细节到处散用
3. localStorage 失败时抛错阻断应用

## 8.4 新增 [src/i18n/messages.ts](/home/david/Workspaces/KeymasterConnectNotesDemo/src/i18n/messages.ts)

目标：

- 集中维护全部三语文案。

需要做的事：

1. 收口当前所有用户可见文案
2. 保证每个 key 的 `en` / `zh-CN` / `ja` 都存在
3. 对需要插值的文案保留简洁模板能力

建议覆盖范围至少包括：

1. 登录页
2. `header`
3. 主题与语言选择器
4. sidebar
5. 文档工具条
6. 搜索结果页
7. banner
8. 确认弹窗 / 命名弹窗
9. 错误映射与状态文案
10. 空态与默认名

不能做的事：

1. 留下一部分中文硬编码“以后再迁”
2. 把协议 code 也改成翻译文本真值

## 8.5 新增 [src/i18n/useI18n.ts](/home/david/Workspaces/KeymasterConnectNotesDemo/src/i18n/useI18n.ts)

目标：

- 提供组件使用层的稳定 API。

需要做的事：

1. 通过 `useSyncExternalStore` 或等价稳定订阅方式响应语言变化
2. 暴露：
   - `t`
   - `language`
   - `setLanguage`
3. 若有插值，统一在这里或 messages 层处理

不能做的事：

1. 让组件自己订阅 store
2. 在 hook 里夹带与语言无关的业务逻辑

## 8.6 修改 [src/main.tsx](/home/david/Workspaces/KeymasterConnectNotesDemo/src/main.tsx)

目标：

- 在 React 挂载前应用语言。

需要做的事：

1. 在主题首屏应用逻辑旁边加入语言首屏应用
2. 确保 `<html lang>` 与初始语言同步

不能做的事：

1. 等 React 挂载后再用 effect 补语言
2. 让首屏先闪一种语言再切换

## 8.7 修改 [src/App.tsx](/home/david/Workspaces/KeymasterConnectNotesDemo/src/App.tsx)

目标：

- 接入语言切换器与全局文案翻译。

需要做的事：

1. 在已登录态 `header` 上增加语言选择器
2. 翻译 `header`、banner、空态、按钮、对话框、默认名、错误映射等文案
3. 让新建 note / folder 默认名跟随当前语言
4. 让各类 `toLocaleString()` 跟随当前语言

不能做的事：

1. 把多语言逻辑零散塞进各个局部 helper，缺少统一入口
2. 因为翻译顺手重构保存/切换/解密流程

## 8.8 修改 [src/components/LockScreen.tsx](/home/david/Workspaces/KeymasterConnectNotesDemo/src/components/LockScreen.tsx)

目标：

- 登录页完全接入字典。

需要做的事：

1. 标题、副标题、能力说明、表单标签、按钮、提示、错误区域全部翻译
2. 不改变登录行为

不能做的事：

1. 把默认 target origin、协议 method 名翻译进业务真值

## 8.9 修改 [src/components/ConnectStatus.tsx](/home/david/Workspaces/KeymasterConnectNotesDemo/src/components/ConnectStatus.tsx)

目标：

- 顶部连接状态区完全接入字典。

需要做的事：

1. 状态标签翻译
2. 行标签翻译
3. 动作按钮与 tooltip 翻译
4. `last login` 的时间格式跟随当前语言

不能做的事：

1. 改动 popup 状态机本身

## 8.10 修改 [src/components/NotesSidebar.tsx](/home/david/Workspaces/KeymasterConnectNotesDemo/src/components/NotesSidebar.tsx)

目标：

- sidebar 的所有展示文案接入字典。

需要做的事：

1. 标题、按钮、placeholder、tag 区、根目录、选中态说明、tooltip、空态全部翻译
2. 当前文件夹/文件更新时间跟随当前语言

不能做的事：

1. 因多语言顺手改 tree 行为、拖拽行为或展开逻辑

## 8.11 修改 [src/components/DocumentToolbar.tsx](/home/david/Workspaces/KeymasterConnectNotesDemo/src/components/DocumentToolbar.tsx)

目标：

- 文档工具条接入字典。

需要做的事：

1. 标签说明文案翻译
2. 元信息标签翻译
3. 保存/放弃/删除按钮翻译
4. tooltip 与状态文案翻译
5. 时间展示跟随当前语言

不能做的事：

1. 改动工具条布局与业务亮灭规则

## 8.12 修改 [src/components/SearchResultsPanel.tsx](/home/david/Workspaces/KeymasterConnectNotesDemo/src/components/SearchResultsPanel.tsx)

目标：

- 搜索结果页接入字典。

需要做的事：

1. 标题、筛选摘要、空态、fallback 文案翻译
2. 结果数文本支持插值

不能做的事：

1. 顺手改搜索匹配规则

## 8.13 修改 [src/components/NameInputDialog.tsx](/home/david/Workspaces/KeymasterConnectNotesDemo/src/components/NameInputDialog.tsx)

目标：

- 命名弹窗默认错误与默认按钮文案接入字典。

需要做的事：

1. “名称不能为空”
2. 默认“确认 / 取消”

不能做的事：

1. 改弹窗校验语义

## 8.14 修改 [src/components/SaveOverlayDialog.tsx](/home/david/Workspaces/KeymasterConnectNotesDemo/src/components/SaveOverlayDialog.tsx)

目标：

- 保存遮罩文案接入字典。

需要做的事：

1. 标题
2. 说明
3. 按钮

不能做的事：

1. 改保存流程

## 8.15 修改 [src/components/NoteEditor.tsx](/home/david/Workspaces/KeymasterConnectNotesDemo/src/components/NoteEditor.tsx)

目标：

- 解密失败占位与相关文案接入字典。

不能做的事：

1. 改 BlockNote 行为

## 8.16 修改 [src/components/TagInput.tsx](/home/david/Workspaces/KeymasterConnectNotesDemo/src/components/TagInput.tsx)

目标：

- placeholder、删除按钮 `aria-label` 等接入字典。

特殊说明：

这里不需要把 tag 内容本身翻译；tag 是用户数据。

## 8.17 可选修改 [src/lib/notes.ts](/home/david/Workspaces/KeymasterConnectNotesDemo/src/lib/notes.ts)

目标：

- 只在必要时调整“展示给用户的中文校验消息”来源。

提前决策：

如果 `validateTitle()` 当前直接返回中文失败消息，而调用方需要把这条消息展示给用户，那么应收口改造为：

1. 返回稳定失败 code
2. UI 层再按 code 翻译

但如果本次改动代价过大，允许退而求其次：

1. 保持校验结构
2. 把失败消息改成由调用方组装

不能做的事：

1. 让底层纯逻辑模块长期携带中文用户文案真值

这里是本单里唯一允许根据实际代码阻力做“小范围结构调整”的点，因为它关系到“逻辑层是否泄漏 UI 语言”。

## 9. 实施顺序

本单虽然是硬切换，但实现顺序仍需固定，避免边改边散。

建议顺序如下：

1. 先补 `src/i18n/` 基础层
2. 再改 `src/main.tsx`，保证首屏语言初始化成立
3. 再改 `src/App.tsx`，把 `header` 语言切换器与全局文案接通
4. 再按组件从外到内迁移文案：
   - `LockScreen`
   - `ConnectStatus`
   - `NotesSidebar`
   - `DocumentToolbar`
   - `SearchResultsPanel`
   - 其他弹窗/编辑器组件
5. 最后统一扫一遍残余硬编码展示文案
6. 跑类型检查与构建验收

这里的“顺序”是实现顺序，不是发布节奏。  
最终交付仍然必须是一笔硬切换完成态。

## 10. 最终验收清单

### 10.1 语言与持久化

- [ ] 首次进入、无语言记录时，浏览器 `en-*` 默认显示英文。
- [ ] 首次进入、无语言记录时，浏览器 `zh-*` 默认显示简中。
- [ ] 首次进入、无语言记录时，浏览器 `ja-*` 默认显示日语。
- [ ] 首次进入、无语言记录时，其他语言默认回退英文。
- [ ] 用户在 `header` 切换到任一语言后，页面立即整体切换。
- [ ] 刷新页面后，仍保持用户上次手动选择的语言。
- [ ] `<html lang>` 始终与当前语言一致。

### 10.2 Header 与主界面

- [ ] `header` 中存在语言切换器。
- [ ] 语言切换器与主题切换器可以同时正常工作，互不覆盖。
- [ ] 切语言不会刷新页面。
- [ ] 切语言不会清空当前编辑态、搜索态、树展开态、主题态或登录态。

### 10.3 文案覆盖

- [ ] 未登录页全部用户可见文案已翻译。
- [ ] 已登录页 `header`、banner、sidebar、document toolbar、搜索结果页全部用户可见文案已翻译。
- [ ] 确认弹窗、命名弹窗、保存遮罩、解密失败占位全部用户可见文案已翻译。
- [ ] 协议错误说明、transport 错误说明、状态标签全部已翻译。
- [ ] 代码中不再遗留面向用户展示的中文硬编码。

### 10.4 数据与业务边界

- [ ] 切语言不修改已有 note / folder 的真实 title。
- [ ] 新建 note / folder 的默认名跟随当前语言。
- [ ] 空标题 fallback 跟随当前语言。
- [ ] 协议 error code、内部状态值、存储结构未被改成翻译文本。

### 10.5 日期与时间

- [ ] `last login`
- [ ] sidebar 选中信息时间
- [ ] document toolbar 的 `created` / `updated`

以上用户可见时间展示都跟随当前语言。

### 10.6 工程验证

- [ ] `npm run typecheck` 通过。
- [ ] `npm run build` 通过。
- [ ] 通过全文搜索确认没有遗留面向用户展示的中文/英文硬编码散落在组件中。

## 11. 收尾说明

本单的核心不是“做国际化基础设施”，而是把当前 demo 收敛到一个足够小、足够稳定、足够一致的多语言实现。

这次只做三件真正重要的事：

1. 语言状态有单真值；
2. 所有用户可见文案有单入口；
3. `header` 提供稳定切换入口。

除此之外，不顺手长新系统，不顺手造设置中心，不顺手引第三方重库。  
只把当前需求一次性硬切到可长期维护的状态。
