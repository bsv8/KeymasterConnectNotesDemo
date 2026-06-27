# KeymasterConnectNotesDemo Notion 风格文档工具条、全局横条与窄屏文件树硬切换一次性施工单

## 1. 本单定位

本单不是“先把右栏搬一下，再慢慢补移动端”的分步计划，也不是在当前三栏布局上继续打补丁的过渡方案。

本单定义一次**硬切换**，目标是把当前 notes 工作区从：

- 左侧树
- 中间编辑区
- 右侧 `NoteInspector`

切到下面这套新定义：

- 顶部 `header`
- `header` 与 `body` 中间统一的全局横条 `banner`
- `body` 只保留两栏：左侧文件树、右侧文档区
- 文档区内部固定为：
  - `document-toolbar`
  - `document-head`
  - `document-editor`
- 窄屏下文件树改成可手工开合、选中后自动收起的抽屉/折叠区

后续实现、联调、验收均以本单为单真值。若与当前代码、旧布局、旧施工单的局部描述冲突，以本单为准。

## 2. 简述缘由

### 2.1 当前右栏本质是元数据面板，不是编辑器格式化工具栏

当前 `NoteInspector` 承载的是：

- tag 编辑
- note / folder 元信息
- 保存 / 删除 / 放弃修改

它并不是 BlockNote 的格式化入口。

所以本次需求的正确理解不是“做一套 Office 式富文本功能条”，而是：

- 把现有右栏内容搬到文档区上方；
- 仍然保持它是“文档上下文工具条”，不是“正文格式化面板”；
- 不顺手扩需求去做粗体、标题、列表按钮那套编辑器二次封装。

这能把改动收敛在布局层与少量组件拆分上，避免系统复杂度膨胀。

### 2.2 `title` 必须回到文档本体，不能继续像表单控件一样游离在旁边

Notion 风格的关键不是“顶部有工具条”，而是：

- 标题和正文看起来是一整块文档；
- 工具条只是轻量文档 chrome；
- 视觉焦点必须落在文档本体，而不是应用面板。

因此本次必须明确：

- `title` 不属于 toolbar；
- `title` 属于 `document-head`；
- `document-head` 与 `document-editor` 共用同一条内容轴线；
- toolbar 虽然放在上方，但存在感必须弱于标题与正文。

### 2.3 三栏布局已经不适合当前信息量，继续保留只会浪费宽度

当前右栏宽度固定，主要放的是少量元信息和几个动作按钮。

这会带来两个问题：

1. 正文宽度被长期压缩；
2. 窄屏时右栏直接消失，功能只能靠隐藏，不是合理响应式。

既然右栏信息量不大，最合理的方案就是：

- 桌面端改成两栏；
- 把右栏内容上收；
- 把正文宽度还给文档区。

### 2.4 提示、警告、模式信息不应散落在 header、sidebar、editor 各处

当前页面里提示信息分散在多处：

- `ConnectStatus` 内部错误提示
- sidebar 内部的移动模式条
- editor 内部解密失败提示

这种分散式提示会破坏页面结构，也会导致移动端更难排版。

因此本次必须把“应用级提示”统一收到 `header` 和 `body` 之间的横条区域。

### 2.5 窄屏不能简单把桌面三栏压扁，必须改成“文件树按需展开”

在手机或窄屏上，同时常驻：

- header
- toolbar
- title
- editor
- 文件树

会让正文高度被切碎。

正确做法不是“把所有东西都塞进一个竖向长页面”，而是：

- 文件树平时可以收起；
- 需要选文件时再展开；
- 选中文件后自动收起，回到正文；
- 用户也可以手工再次展开。

这比“树和编辑区长期同时可见”更符合移动端的空间约束。

## 3. 本次硬切换的最终目标

本次完成后，工作区必须达到以下状态：

1. 已登录态主布局从三栏变成两栏，右侧独立 inspector 完全退出主结构。
2. note 的 tag / 状态 / 操作整体搬到文档区顶部。
3. 文档区固定为 `document-toolbar -> document-head(title) -> document-editor`。
4. `title` 与正文视觉上是一体，不被工具条切碎。
5. `header` 与 `body` 中间存在统一 `banner` 区域，用于应用级提示。
6. sidebar 内不再保留移动模式横条。
7. sidebar 根目录上方仅在“当前选中 folder”时显示简化 folder 工具条。
8. sidebar 根目录上方**不**显示 note 工具条，避免与文档区 toolbar 重复。
9. 窄屏下文件树支持手工展开 / 收起；选中项后自动收起。
10. 现有保存、删除、放弃修改、解密失败、未保存拦截等业务规则不回归。

## 4. 最终布局与交互定义

## 4.1 桌面端总布局

桌面端固定为：

1. `app-header`
2. `app-banner`
3. `workspace`

其中 `workspace` 为两栏：

- 左栏：`sidebar`
- 右栏：`document-panel`

不再存在独立的第三栏 `inspector`。

## 4.2 文档区结构

右侧文档区固定为：

1. `document-toolbar`
2. `document-head`
3. `document-editor`

其中：

- `document-toolbar` 是轻量控制层，不是正文内容；
- `document-head` 只承载 `title`；
- `document-editor` 承载 BlockNote 正文或空态/失败态。

## 4.3 `document-toolbar` 的最终内容

本单最终采用**两排**，不采用三排。

原因：

- 当前功能量不足以支撑三排；
- 三排会压缩首屏正文高度；
- 窄屏下更难收缩；
- Notion 风格强调克制，不应让工具区比正文更厚。

最终两排定义如下：

### 4.3.1 第一排：标签排

只放：

- `TagInput`
- 一段极短说明：`tag 明文存储，仅用于本地搜索`

说明文案必须弱化，不能做成长段帮助文字。

### 4.3.2 第二排：状态与动作排

左侧放紧凑状态信息：

- `created`
- `updated`
- `contentType`
- 密文长度 / 未保存状态

右侧放动作按钮：

- `加密保存`
- `放弃修改`
- `删除`

这里必须做成同一排，而不是把按钮再单独拆一排。

## 4.4 `document-head`

`document-head` 只放大号 `title` 输入框。

明确要求：

- `title` 与正文共用同一内容宽度；
- `title` 左边缘与正文左边缘对齐；
- `title` 与正文之间的垂直间距，必须小于 `toolbar` 与 `title` 的间距；
- `title` 输入框看起来像文档标题，不像表单输入框。

不能再把 `title` 画成一个独立面板或卡片。

## 4.5 `document-editor`

`document-editor` 继续承载：

- BlockNote 编辑区
- 解密失败时的正文失败占位
- 无 note 选中时的空态

但应用级错误不再散落在 editor 内多个位置。

编辑区内只保留“与当前文档正文直接相关”的内容：

- 正文
- 正文空态
- 正文失败态

## 4.6 sidebar 最终结构

左侧 `sidebar` 从上到下为：

1. 顶部标题与新建按钮
2. 窄屏时的树开合入口
3. 搜索框
4. tag 过滤
5. 当前选中 folder 的简化工具条（若当前选中是 folder）
6. 根目录条目
7. folder / note 树

### 4.6.1 根目录上方的简化工具条最终只保留 folder 场景

虽然可以技术上做成“folder 或 note 都显示”，但本单明确**不这样做**。

最终决策：

- 当前选中 `folder`：在根目录上方显示简化 folder 工具条；
- 当前选中 `note`：不在 sidebar 重复显示 note 工具条；
- 当前选中 `root`：不显示该工具条。

理由：

1. note 的主要操作已经在文档区 toolbar 里；
2. 若 sidebar 再显示一份 note 工具条，会制造双入口；
3. 双入口在窄屏下尤其容易让人误判“哪个才是主操作区”。

### 4.6.2 folder 简化工具条内容

只保留：

- 文件夹标题
- `updated`
- `删除文件夹`

不放：

- `created`
- `id`
- path
- 重命名入口

重命名继续走右键菜单，不把左栏重新膨胀成 inspector。

## 4.7 `banner` 最终承载范围

`banner` 放在 `header` 与 `workspace` 之间。

只承接**应用级**提示，包含：

- 最近错误 `lastError`
- 当前 note 的解密失败提示摘要
- 移动模式提示
- 其他短提示信息

优先级固定为：

1. 错误
2. 解密失败
3. 移动模式
4. 普通提示

同一时刻只显示最高优先级的一条主横条；若需要附带操作按钮，可在横条右侧放一个轻量按钮，例如移动模式下的“取消”。

## 4.8 保存遮罩的最终决策

本单明确：

- `saveOverlay` 保留阻塞遮罩，不改成普通横条。

原因：

- 保存中的 Keymaster 许可等待本来就是阻塞动作；
- 若改成 banner，用户会误以为还能继续切换或编辑；
- 这会破坏当前项目已经收口好的保存状态机。

因此：

- 应用级提示进 banner；
- 强阻塞保存流程继续用 overlay。

## 5. 窄屏与移动端定义

## 5.1 窄屏总原则

窄屏不做“缩小版桌面三栏”，而做：

- 顶部 header
- 中间 banner
- 文件树抽屉 / 折叠区
- 文档区

文件树不需要时应能完全收起，给正文让出高度。

## 5.2 文件树开合规则

需要新增一个明确的窄屏 UI 状态，例如：

- `isSidebarOpenOnMobile`

交互规则固定为：

1. 用户点击“目录”按钮时，展开文件树。
2. 用户再次点击时，收起文件树。
3. 用户在窄屏下选中 root / folder / note 后，文件树自动收起。
4. 用户后续仍可再次手工展开文件树。

## 5.3 窄屏下 sidebar 呈现方式

本单允许两种实现形式，但要求只选一种，不双修：

- 内联折叠区
- overlay 抽屉

结合当前项目简单性原则，本单建议优先采用：

- **内联折叠区**

理由：

- 不需要额外处理复杂遮罩、点击外部关闭、层级冲突；
- 与当前 DOM 结构更接近；
- 实现和调试都更简单。

除非实际实现中发现 BlockNote 与内联折叠高度冲突明显，否则不做 overlay drawer。

## 5.4 窄屏下文档工具条策略

窄屏下 `document-toolbar` 允许换行，但不允许：

- 把状态和按钮重新拆回右侧独立栏；
- 把 toolbar 做成横向不可滚动导致内容截断；
- 把 title 挤成一行不可读的小字。

工具条在窄屏下可以表现为：

- 第一排：tag
- 第二排：状态块
- 第三排：动作按钮

注意：这只是窄屏自适应结果，不代表桌面结构回到三排。

## 6. 特殊情况与提前决策

## 6.1 `decryptFailed` note

若当前 note 为 `decryptFailed`：

- `document-toolbar` 仍显示状态与删除入口；
- tag 继续禁用；
- `加密保存` 继续禁用；
- `title` 继续禁用；
- `document-editor` 显示失败态；
- `banner` 额外显示一条摘要级警告。

不能因为 toolbar 改位，就让失败态又分散到多个区域难以理解。

## 6.2 当前 note `loading`

若当前 note 正在解密：

- `title` 禁用；
- tag 禁用；
- `加密保存` 禁用；
- toolbar 状态排要明确显示“正在解密正文”；
- 正文区域继续显示 loading 对应内容。

不能在 loading 时让 toolbar 看起来像“仍可完整编辑”。

## 6.3 当前无 note，仅选中 folder

若当前只选中 folder：

- 文档区显示 folder 语义的空态，不显示 note toolbar；
- sidebar 根目录上方显示简化 folder 工具条；
- 删除 folder 的主要入口在该简化工具条；
- 文档区不重复再放一份“删除文件夹”。

## 6.4 当前选中 root

若当前选中 root：

- sidebar 不显示简化 folder 工具条；
- 文档区显示当前根目录空态；
- 不显示 note toolbar。

## 6.5 有未保存修改时切换 folder / note / root

现有“保存并切换”拦截规则必须保留原定义。

本次只改布局，不改这条业务规则：

- 先拦截
- 用户确认后再保存并切换
- 保存遮罩期间仍阻塞其他破坏性操作

不能因为新增窄屏树抽屉或 toolbar，就绕开当前拦截状态机。

## 6.6 移动模式

当前 move 模式提示要从 sidebar 内部挪到 `banner`。

规则：

- 进入移动模式后，banner 显示“正在选择移动目标”
- 右侧提供“取消”按钮
- sidebar/tree 自身只负责高亮目标，不再额外画一条横幅

## 6.7 保存失败

保存失败时：

- 文档区当前内容保持不变；
- toolbar 当前内容保持不变；
- banner 显示错误；
- 文件树开合状态不被强制改写。

不允许出现“保存失败却顺手把窄屏文件树弹开/收起”的副作用。

## 6.8 窄屏下选择文件

窄屏下用户从文件树选择：

- note
- folder
- root

都应自动收起文件树。

但若选择动作最终被“未保存拦截”阻断，则应保持当前树状态与当前文档状态一致，不做半切换。

## 7. 不能怎么做

下面这些做法本单明确禁止：

1. 保留当前三栏布局，只是把右栏宽度缩窄。
2. 把 `NoteInspector` 原样塞到编辑器顶部，当成一个横向压扁的旧面板。
3. 把本次需求扩成真正的 Office 富文本工具栏，顺手增加粗体、标题、列表等二次编辑按钮。
4. 为了“看起来有工具区”，把 `title` 也塞进 toolbar。
5. 在 sidebar 根目录上方同时显示 note 工具条和 folder 工具条。
6. 继续把错误、解密失败、移动模式提示分散在 `ConnectStatus`、sidebar、editor 三处。
7. 把 `saveOverlay` 改成普通 banner。
8. 窄屏下让文件树和正文长期同时常驻，压缩正文高度。
9. 为了窄屏做一套完全独立的业务状态机，与桌面端分叉。
10. 顺手重做保存、解密、未保存拦截的业务逻辑。

## 8. 文件级实施方案

## 8.1 [src/App.tsx](/home/david/Workspaces/KeymasterConnectNotesDemo/src/App.tsx)

目标：

- 收口新的页面结构与顶层状态；
- 统一 banner 内容来源；
- 管理窄屏文件树开合态。

需要做的事：

1. 主布局从三栏改成两栏。
2. 新增 `banner` 渲染层，放在 `header` 与 `workspace` 之间。
3. 聚合 banner 文案来源：
   - `lastError`
   - `decryptError`
   - `moveState`
4. 新增窄屏文件树开合状态，例如 `isSidebarOpenOnMobile`。
5. 在窄屏下处理：
   - 手工展开 / 收起 sidebar
   - 选中 root / folder / note 后自动收起
6. 当前选中 folder 时，把 folder 简化工具条所需数据传给 sidebar。
7. 当前选中 note 时，不再渲染 `NoteInspector` 右栏。
8. 接入新的 `DocumentToolbar`。

不能做的事：

- 不能把 banner 状态拆成多套彼此覆盖的局部 state。
- 不能在 `App` 里同时保留旧 `inspector` 布局和新 toolbar 布局。
- 不能让窄屏开合状态影响桌面端正常布局。

## 8.2 [src/components/ConnectStatus.tsx](/home/david/Workspaces/KeymasterConnectNotesDemo/src/components/ConnectStatus.tsx)

目标：

- 让 header 只承担连接状态与身份动作；
- 不再承载页面级错误横条。

需要做的事：

1. 移除或收敛组件内部 `lastError` 的整行错误展示。
2. 保持连接状态点、origin、publicKey、重新登录/切换身份/删除当前本地数据按钮。
3. 样式继续保持轻量信息条，不演变成第二条 banner。

不能做的事：

- 不能让 `ConnectStatus` 与新 `banner` 同时重复展示同一条错误。

## 8.3 [src/components/NotesSidebar.tsx](/home/david/Workspaces/KeymasterConnectNotesDemo/src/components/NotesSidebar.tsx)

目标：

- 承接窄屏开合入口与 folder 简化工具条；
- 不再承接应用级横幅提示。

需要做的事：

1. 增加窄屏“目录”开合入口或其渲染槽位。
2. 增加 folder 简化工具条区域：
   - 仅 folder 选中时显示
   - 展示标题、`updated`、删除按钮
3. 移除 sidebar 内部 `move banner` 的主展示职责。
4. 继续保持现有搜索、tag 过滤、根目录、树、右键菜单、拖拽逻辑。

不能做的事：

- 不能把 note 工具条也复制进 sidebar。
- 不能为了加工具条而把 tree 结构再拆成多套渲染分支。

## 8.4 新增 `src/components/DocumentToolbar.tsx`

目标：

- 取代旧 `NoteInspector` 在 note 场景的职责；
- 形成文档区顶部的 Notion 风格工具条。

职责：

1. 第一排渲染 tag 区。
2. 第二排渲染状态信息与动作按钮。
3. 继续复用现有的：
   - `TagInput`
   - save / delete / reset 回调
   - `isDirty` / `isSaving` / `decryptFailed` / `canEdit` / `canDelete`
4. 保持 save 亮灭规则不变，只改变布局与视觉组织。

不能做的事：

- 不能在该组件里新增业务真值。
- 不能把 title 再搬进来。
- 不能顺手塞编辑器格式化按钮。

## 8.5 [src/components/NoteInspector.tsx](/home/david/Workspaces/KeymasterConnectNotesDemo/src/components/NoteInspector.tsx)

本单目标是让该文件退出主流程。

建议处理方式：

- 停止在 `App.tsx` 中使用；
- 若实现时确认新 `DocumentToolbar` 已完全覆盖其职责，可删除该文件；
- 若暂时保留文件，也必须明确它不再参与主渲染。

不能做的事：

- 不能让 `NoteInspector` 与 `DocumentToolbar` 同时渲染，形成双入口。

## 8.6 [src/components/NoteEditor.tsx](/home/david/Workspaces/KeymasterConnectNotesDemo/src/components/NoteEditor.tsx)

目标：

- 尽量不动业务逻辑；
- 只配合新的文档区结构。

需要做的事：

1. 如有必要，只调整最外层容器类名或间距挂点。
2. 保持 markdown 单真值、失败态、加载灌入逻辑不变。

不能做的事：

- 不能因为布局改造去重写 BlockNote 行为。

## 8.7 [src/styles.css](/home/david/Workspaces/KeymasterConnectNotesDemo/src/styles.css)

目标：

- 重写工作区布局与响应式；
- 落地 Notion 风格的工具条、文档头、banner、窄屏折叠行为。

需要做的事：

1. `workspace` 从三栏 grid 改成两栏。
2. 新增：
   - `app-banner`
   - `document-panel`
   - `document-toolbar`
   - `document-head`
   - sidebar folder 简化工具条
   - 窄屏开合按钮与折叠样式
3. 调整 `editor-stage` 样式语义，使其变成 `document-panel` 语义。
4. 调整移动端断点：
   - sidebar 可收起
   - toolbar 自动换行
   - title 保持可读

不能做的事：

- 不能引入厚重卡片化或 dashboard 风格。
- 不能把工具条做成高对比、厚边框、重阴影的 Office 仿制带。

## 8.8 `README.md`

目标：

- 文档与新布局一致。

需要做的事：

1. 若 README 描述了“三栏布局 / 右侧 inspector”，必须改写。
2. 补充说明：
   - 顶部 banner
   - 文档工具条
   - 窄屏文件树开合

不能做的事：

- 不能让 README 继续描述已不存在的右侧 inspector。

## 9. 实施顺序

本单是一次性硬切换，不保留兼容布局。

实施顺序固定为：

1. 先在 `App.tsx` 收口新页面结构与顶层状态。
2. 再把 sidebar、toolbar、banner 组件位置改到位。
3. 然后统一改 `styles.css` 的布局与响应式。
4. 最后清理旧 `NoteInspector` 出口，并更新 README。

不能先只改 CSS 伪装成新布局，而保留旧 DOM 结构长期并存。

那样会让：

- 条件渲染越来越复杂；
- 窄屏行为越来越难收口；
- 旧右栏逻辑残留更久。

## 10. 最终验收清单

### 10.1 结构验收

- [ ] 主工作区已经不再是三栏布局。
- [ ] 页面中不再存在右侧独立 inspector 面板。
- [ ] 文档区已经固定为 `document-toolbar -> document-head -> document-editor`。
- [ ] `title` 不在 toolbar 内，而在 `document-head` 内。

### 10.2 文档区验收

- [ ] 当前选中 note 时，tag、状态、保存/删除/放弃修改都出现在文档区顶部。
- [ ] `title` 与正文视觉上是一体，左边缘对齐。
- [ ] `document-toolbar` 为两排，不是三排厚工具带。
- [ ] `decryptFailed` 时，toolbar 仍可显示状态，但不会错误放开编辑或保存。

### 10.3 sidebar 验收

- [ ] 当前选中 folder 时，根目录上方会显示简化 folder 工具条。
- [ ] 当前选中 note 时，sidebar 不会重复出现 note 工具条。
- [ ] 当前选中 root 时，sidebar 不显示该简化工具条。
- [ ] 搜索、tag 过滤、树、右键菜单、拖拽仍可正常工作。

### 10.4 banner 验收

- [ ] `header` 与 `body` 中间存在统一 banner 区域。
- [ ] `lastError` 不再只困在 `ConnectStatus` 内部。
- [ ] 移动模式提示已从 sidebar 挪到 banner。
- [ ] 解密失败摘要可在 banner 中看到。
- [ ] `saveOverlay` 仍是阻塞遮罩，没有被降级成普通横条。

### 10.5 窄屏验收

- [ ] 窄屏下文件树可以手工展开。
- [ ] 窄屏下文件树可以手工收起。
- [ ] 窄屏下选中 root / folder / note 后，文件树会自动收起。
- [ ] 文件树收起后，正文区域不会被多余空白占位。
- [ ] 工具条在窄屏下可换行，但不出现关键按钮不可达或标题不可读。

### 10.6 业务不回归验收

- [ ] 现有保存动作仍可正常工作。
- [ ] 未保存拦截仍可正常工作。
- [ ] note 解密 / 打开链路不因布局变化而回归。
- [ ] folder 删除、note 删除仍可正常工作。
- [ ] `npm run typecheck` 通过。
- [ ] `npm run build` 通过。

## 11. 本单结论

本单的核心不是“把右栏挪个位置”，而是把整个工作区重新收口成一套更符合当前产品方向的结构：

- 应用级信息上提到统一 banner；
- 文档级信息下沉到文档区顶部；
- `title` 回到文档本体；
- sidebar 只负责导航与 folder 上下文；
- 窄屏改成按需展开文件树，而不是勉强保留桌面三栏；
- 保存遮罩、未保存拦截、解密失败等关键业务状态机保持原定义。

后续实现若偏离这些原则，例如重新做成厚重 ribbon、复制双入口、或为了移动端新造一套业务状态机，就说明又把简单问题做复杂了。
