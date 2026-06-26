# KeymasterConnectNotesDemo 保存链路、Tag 控件与新建文件夹交互硬切换一次性施工单

## 1. 本单定位

本单不是零散 bug list，不是“先修一点、再补一点”的分步计划，也不是兼容旧交互的过渡方案。

本单定义一次**硬切换**，目标是把当前 notes 编辑页里这几类问题一次性收口：

- 保存时编辑区出现“像被清空一次”的错觉
- 新建 note 只改 markdown 时，保存按钮不亮
- tag 被错误感知成必填项
- tag 输入仍是普通文本框，交互过于原始
- 新建 note / 文件夹遇到重名时没有统一编号策略
- 新建文件夹仍依赖浏览器原生弹窗思路，交互不一致

后续实现、联调、验收均以本单为准。若与旧施工单或当前代码行为冲突，以本单为准。

## 2. 简述缘由

### 2.1 当前保存问题不是“加密问题”，而是编辑态真值切换问题

用户点保存后，`cipher.encrypt` 本身只是一次外部请求。

真正的问题在于：

- 保存成功前后，`space`、`pendingDrafts`、`selection`、`draft` 多处状态同时切换
- 当前页面又把“选中 note 后重新灌 draft”的逻辑挂在这些状态上
- 于是保存动作看起来像“重新打开了当前 note 一次”

这会带来两个坏结果：

1. 用户感知成“内容被清空一下，像没保存”
2. 编辑器光标、滚动位置、输入连续性容易被打断

本质上，保存不应该像一次“切换 note”，而应该像一次“当前 note 原地落盘”。

### 2.2 当前 save 按钮亮灭规则把“是否改过 markdown”判断错了

现在新建 note 走的是 `pendingDrafts` 内存态，尚未持久化，也没有已保存 markdown 基线。

但当前 dirty 判定对 pending note 并没有正确比较 markdown 变化，导致：

- 只改 markdown 时，save 可能仍不亮
- 一旦改 tag，save 又亮了
- 用户就会误以为“tag 不填不能保存”

所以问题不是“tag 必填”，而是“pending note 的 dirty 真值算错了”。

### 2.3 tag 现在是“把整串文本强行归一化成数组”，不是一个合格的 tag 控件

当前 tag 输入框把整段字符串直接 `normalizeTags(...)` 成数组，这会导致：

- 输入中的临时态无法存在
- 分隔符一敲就触发整体重算，手感很差
- 无法自然支持 chip 展示、逐个删除
- 无法稳定处理粘贴多 tag、回车提交、退格删最后一个 tag 这类常见交互

这类控件不该再伪装成普通 `<input>`。

### 2.4 新建命名与重命名语义不能混在一起

“新建”是系统生成名字，合理行为应是：

- 先尽量用默认名
- 若重名，系统自动补编号

而“重命名”是用户显式输入，合理行为应是：

- 若重名，直接阻断并提示
- 不能偷偷帮用户改成另一个名字

如果把这两类语义混在一起，后面会不断出现“为什么这次自动补号、那次却报错”的混乱。

### 2.5 浏览器原生弹窗不应该继续存在

当前项目已经有页面内确认框语义，再继续混用 `window.prompt(...)` 会带来这些问题：

- 视觉风格断裂
- 焦点和键盘行为不可控
- 无法做 inline 校验
- 无法表达“输入后若重名如何处理”

因此本次应明确：

- 新建文件夹不用浏览器弹窗
- folder / note 重命名也不再用浏览器弹窗
- 页面内统一收口到自定义输入框弹层

## 3. 本次硬切换的最终目标

本次完成后，页面必须达到以下状态：

1. 保存当前 note 时，编辑器正文不闪空、不走一次“重新打开 note”的体验。
2. tag 可以为空；save 是否可点，不得依赖“有没有 tag”。
3. 新建 pending note 只要改了 markdown，就必须被视为 dirty。
4. tag 输入改成独立 chip 控件：
   - 输入中有临时文本
   - 回车可提交
   - 半角逗号、全角逗号、空格可提交
   - 提交后在下方显示成独立 tag
   - 每个 tag 可单独删除
5. 新建 note 遇到重名自动补编号。
6. 新建文件夹必须先弹页面内输入框，再真正创建。
7. 新建文件夹遇到重名自动补编号。
8. folder / note 重命名统一改用页面内输入框弹层。

## 4. 最终交互与真值定义

## 4.1 保存链路

保存动作的定义是：

- 对当前 draft 做合法性校验
- 调 `cipher.encrypt`
- 把返回密文写入 note record
- 原地更新当前页面的 note 元数据与缓存

保存成功后必须满足：

- 当前选中的 note 不变
- 当前 draft 不置空
- 不重新进入“解密中...”
- 不重新调用 `openNote`
- 不把编辑器先卸载再挂回去

设计约束：

- 保存是“原地落盘”
- 不是“删除旧 note 后再重新选中”
- 不是“先清 draft，再从 record 回填”

## 4.2 save 按钮亮灭规则

save 是否可点，按以下规则收口：

### 4.2.1 已持久化 note

需同时满足：

- 当前不是 `decryptFailed`
- title 合法
- 相比已保存版本，title / tags / markdown 至少有一项变更

### 4.2.2 pending note（首次保存前）

需同时满足：

- 当前不是 `decryptFailed`
- title 合法
- 相比 pending 基线，title / tags / markdown 至少有一项变更

其中 markdown 的 pending 基线定义必须明确：

- pending note 尚未保存过
- 因此它的 markdown 基线就是空字符串
- 不能因为没有 persisted cipher，就把 markdown 变化忽略掉

这条是本次修复的关键，否则又会回到“只改 markdown 不算 dirty”的错误状态。

### 4.2.3 tag 为空

明确允许：

- `tags.length === 0` 仍可保存

明确禁止：

- 把 tag 当必填项
- 因 tag 为空而禁用 save

## 4.3 tag 控件

tag 控件改成“两段式真值”：

1. `draft.tags: string[]`
   这是最终业务真值
2. `tagInputValue: string`
   这是控件内部临时输入态

交互定义：

- 用户输入普通字符，只更新 `tagInputValue`
- 用户按回车时，尝试把当前输入提交为一个或多个 tag
- 用户输入半角逗号 `,`、全角逗号 `，`、空格时，也触发提交
- 用户粘贴 `a b,c，d` 这类文本时，应拆成多个 tag
- 已提交的 tag 在输入框下方展示为 chip
- 每个 chip 后有删除按钮

提交规则沿用既有约束：

- `trim`
- 过滤空
- 转小写
- 去重
- 单 tag 长度不超过 `MAX_TAG_LENGTH`
- 总数不超过 `MAX_TAGS_PER_NOTE`

输入限制的表达方式：

- 空格、半角逗号、全角逗号都是分隔符，不属于 tag 内容
- 也就是说，一个已提交 tag 内部不能包含这些字符

补充交互：

- 当输入框为空时按退格，可删除最后一个 tag
- 删除某个 chip 只影响该 tag，不重建整串文本

明确不需要：

- 真的再造一个隐藏 `<input>`
- 真的把 tag 串接成逗号文本作为另一份真值

React state 本身就是隐藏真值，不必为“像表单”而制造第二套数据。

## 4.4 新建 note 命名规则

新建 note 继续保留一键创建，不额外弹输入框。

默认基名：

- `新 note`

若同目录下已存在同名 note，则自动编号：

- `新 note`
- `新 note 2`
- `新 note 3`

以此类推，直到找到当前目录内可用名。

这里的“同目录”判断必须同时覆盖：

- 已持久化 `space.notes`
- 未持久化 `pendingDrafts`

否则会再次出现“UI 上看见重名，但检查没算进去”的错误。

## 4.5 新建文件夹交互与命名规则

新建文件夹改为：

1. 用户点击“新建文件夹”
2. 页面中央弹出自定义输入框弹层
3. 用户输入文件夹名
4. 确认后才真正创建 folder record

弹层要求：

- 页面中央展示
- 自动聚焦输入框
- 支持回车确认、Esc 取消
- 能展示 inline 校验文案

输入框初始值建议：

- 预填 `新文件夹`

理由：

- 既满足“先问名字再创建”
- 又不让用户每次都从空白开始敲

创建时命名规则：

- 用户提交值先 `trim`
- 若为空，阻断并提示“文件夹名不能为空”
- 若与同父目录现有文件夹重名，则自动补编号

例如：

- 用户提交 `项目`
- 同父目录已有 `项目`
- 则创建为 `项目 2`

注意：

- 自动补编号只用于“创建”
- 不用于“重命名”

## 4.6 重命名交互

虽然本轮用户明确点名的是“新建文件夹不要浏览器弹窗”，但本单要求顺手统一：

- folder 重命名
- note 重命名

都改为页面内输入框弹层。

原因很简单：

- 同一页面不能并存“自定义命名弹层”和 `window.prompt(...)` 两套命名系统

重命名规则：

- 输入值 `trim` 后不能为空
- 若目标目录下重名，直接阻断并提示
- 不自动补编号

## 5. 怎么做

## 5.1 保存链路怎么改

实现上应把“保存成功后的 UI 更新”当成一次**原地 patch**，而不是一次重新选中。

建议收口方式：

- 保存成功后，先同步最新 `decryptedCacheRef`
- 然后把 note record 写入 `space`
- 若是 pending note，再移除对应 `pendingDrafts`
- 最后仅 patch 当前 `draft` 的元数据，不触发重新打开链路

必须确保：

- 当前 note hydration effect 不会把“刚保存好的当前 draft”又覆盖掉
- pending note 首次保存成功后，不会因为 `pendingDrafts` 被删掉而把正文短暂回退到空字符串

## 5.2 dirty 判定怎么改

dirty 判定需要显式区分三种基线：

1. 已持久化 note
   markdown 基线来自解密缓存
2. pending note
   markdown 基线是空字符串
3. 根本没有 note record 的纯空态
   这类状态不应长期存在；当前项目仍以 pending note 作为新建入口

重点是：

- 不能为了判断 dirty，把明文 markdown 塞进 `pendingDrafts`
- `pendingDrafts` 仍只保存“未持久化 note 的结构与明文 metadata”
- 明文正文继续只活在内存 draft / 编辑器里

## 5.3 tag 控件怎么改

tag 相关逻辑应拆成两层：

- 规范化逻辑仍保留在 `notes.ts`
- 交互逻辑单独做成组件

推荐新增一个独立组件，职责只做：

- 临时输入态维护
- 分隔符提交
- chip 展示
- chip 删除

`NoteInspector` 不再直接拿一个普通文本框绑定 `draft.tags.join(", ")`。

## 5.4 命名弹层怎么改

推荐新增一个通用输入弹层组件，覆盖以下动作：

- 新建文件夹
- 重命名文件夹
- 重命名 note

原因：

- 这三类动作本质上都是“输入一个名称并校验”
- 不需要做三套 UI
- 也不应该继续残留 `window.prompt(...)`

但这不是“做大而全组件平台”，而只是一个非常轻的页面内弹层。

## 5.5 自动补编号怎么改

编号策略必须独立成可复用的小工具：

- 给定父目录 / 文件夹、基名、现有实体集合
- 返回第一个可用名字

分别用于：

- 新建 note
- 新建 folder

重命名流程不得复用这个“自动补编号”分支。

## 6. 不能怎么做

本次明确禁止以下实现方式：

1. 不能把 tag 改成“继续用一个普通文本框，只是外面再画几个假 chip”。
2. 不能把 `draft.tags.join(", ")` 当成另一份业务真值长期维护。
3. 不能把 tag 设成必填，只为绕开 save 按钮不亮的问题。
4. 不能为了修 dirty 判定，把 markdown 明文写进 localStorage。
5. 不能为了修 dirty 判定，把 markdown 明文塞进 `pendingDrafts` record。
6. 不能在保存成功后先 `setDraft(null)`，再从 record 回填。
7. 不能在保存成功后重新调用 `openNote` 或重新解密当前 note。
8. 不能把新建文件夹实现成“先创建默认名，再立刻弹重命名”。
9. 不能继续使用 `window.prompt(...)` 做新建文件夹、重命名文件夹、重命名 note。
10. 不能把“自动补编号”扩散到重命名流程。
11. 不能让同目录重名检查只看 persisted，不看 pending。
12. 不能引入复杂重试、复杂撤销栈、复杂草稿持久化，借机扩大需求。

## 7. 特殊情况与处理原则

## 7.1 中文输入法

tag 输入时若用户正在 IME composition：

- 回车不能立即提交 tag
- 需等 composition 结束后再按规则处理

否则中文输入会被错误打断。

## 7.2 连续分隔符

若用户输入：

- `a,,b`
- `a  b`
- `a，, b`

应等价于：

- `a`
- `b`

空 token 直接丢弃，不报错，不污染已有 tag。

## 7.3 粘贴多 tag

若用户一次粘贴：

```txt
alpha beta,gamma，delta
```

应一次拆成多个 tag chip。

## 7.4 重复 tag

若用户提交的 tag 已存在：

- 直接忽略该 tag
- 已有 tag 保持不变

不需要弹阻断对话框。

## 7.5 tag 超长或超量

处理原则保持简单：

- 单 tag 超过上限，不入列
- 超过总数上限的后续 tag，不入列

不引入复杂逐字校验或批量报错系统。

必要时只在控件下方给一条规则提示即可。

## 7.6 新建文件夹时用户取消

若用户关闭命名弹层或按 Esc：

- 不创建任何 folder record
- 不改 selection
- 不改 draft

也就是“当作没发生过”。

## 7.7 创建时重名

创建 folder / note 若重名：

- 自动补编号
- 然后直接创建最终可用名

不需要二次弹框追问用户。

## 7.8 重命名时重名

重命名 folder / note 若重名：

- 阻断
- 在输入弹层内展示错误
- 保留用户当前输入，允许继续改

不能自动补编号。

## 7.9 解密失败态

若当前 note 是 `decryptFailed`：

- 正文仍不可编辑
- save 仍不可点
- tag 仍不可编辑
- 删除仍允许

这条不能因为换了 tag 控件而被破坏。

## 7.10 popup / encrypt 失败

若保存时外部请求失败：

- 当前 draft 保持原样
- 当前 tag 输入态保持原样
- 不清空编辑器
- 不清空选择状态
- 只展示错误文案，允许用户重试

## 8. 文件级实施范围

## 8.1 [src/App.tsx](/home/david/Workspaces/KeymasterConnectNotesDemo/src/App.tsx)

负责改动：

- 修正 pending note 的 dirty 判定
- 调整 save 成功后的状态 patch 顺序
- 引入页面内命名弹层状态
- 新建 folder 先开弹层，再创建
- folder / note 重命名改走页面内弹层
- 新建 note / folder 的自动补编号策略接入

## 8.2 [src/components/NoteInspector.tsx](/home/david/Workspaces/KeymasterConnectNotesDemo/src/components/NoteInspector.tsx)

负责改动：

- 删除普通 tag 文本框实现
- 接入新的 tag chip 输入组件
- 保持 save / delete / reset 的现有布局语义

## 8.3 新增 `src/components/TagInput.tsx`

职责：

- 维护 `tagInputValue`
- 处理回车 / 空格 / 半角逗号 / 全角逗号提交
- 展示 chip
- 删除 chip
- 处理粘贴多 tag
- 处理输入法 composition

## 8.4 新增 `src/components/NameInputDialog.tsx`

职责：

- 页面中央输入框弹层
- 支持标题、说明、输入、错误提示
- 支持回车确认、Esc 取消
- 供“新建文件夹 / 重命名文件夹 / 重命名 note”复用

## 8.5 [src/lib/notes.ts](/home/david/Workspaces/KeymasterConnectNotesDemo/src/lib/notes.ts)

负责改动：

- 继续作为 tag 规范化单真值
- 如有必要，补一个“按分隔符拆 tag token”的轻量辅助函数
- 不改变既有 `normalizeTags` 的核心约束

## 8.6 [src/lib/storage.ts](/home/david/Workspaces/KeymasterConnectNotesDemo/src/lib/storage.ts)

负责改动：

- 新增或补充“生成同目录可用名”的轻量工具
- folder / note 各自按自身集合判定重名
- 不改变持久层 schema

## 8.7 [src/styles.css](/home/david/Workspaces/KeymasterConnectNotesDemo/src/styles.css)

负责改动：

- tag chip 输入区样式
- tag 删除按钮样式
- 页面中央命名弹层样式
- inline 校验与提示文案样式

## 9. 最终验收清单

## 9.1 保存链路

- 新建 note，只输入 markdown，不输入 tag，save 按钮会亮。
- 新建 note，只改标题，不输入 tag，save 按钮会亮。
- 已有 note，只改 markdown，不改 tag，save 按钮会亮。
- save 成功后，正文不闪空、不进入“解密中...”。
- save 失败后，正文、tag、标题都仍留在当前页面，可直接重试。

## 9.2 tag 控件

- tag 可为空，空 tag 不阻止保存。
- 输入 `a` 后按回车，生成一个 `a` chip。
- 输入 `a,b` 后能拆成两个 chip。
- 输入 `a，b c` 后能拆成三个 chip。
- 粘贴 `alpha beta,gamma` 后能拆成多个 chip。
- 点击某个 chip 后面的删除按钮，只删除该 chip。
- 输入框为空时按退格，会删除最后一个 chip。
- 重复 tag 不会重复加入。

## 9.3 新建与命名

- 点击“新建文件夹”后，先看到页面中央命名弹层。
- 取消命名弹层后，不创建任何文件夹。
- 新建文件夹输入空白名会被阻断。
- 在同父目录下新建重名文件夹，会自动变成 `名字 2`、`名字 3`。
- 在同目录下新建重名 note，会自动变成 `新 note 2`、`新 note 3`。
- folder 重命名不再使用浏览器原生弹窗。
- note 重命名不再使用浏览器原生弹窗。
- 重命名若与同目录已有名称冲突，会阻断并保留当前输入。

## 9.4 边界态

- `decryptFailed` note 仍禁止保存和编辑 tag。
- popup / encrypt 失败时不会清空当前编辑内容。
- pending note 与 persisted note 的重名检查都覆盖到，不会出现 UI 上可见重名。

## 10. 本单完成标志

以下条件同时满足，才算本单完成：

1. 保存动作不再制造“编辑器像被清空一次”的体验。
2. save 按钮亮灭逻辑不再与 tag 是否为空错误绑定。
3. tag 输入已经不是普通文本框，而是可提交 / 可删除的 chip 控件。
4. 新建 folder 已改为页面内命名弹层，且创建前输入名称。
5. 新建 note / folder 的自动补编号策略已经生效。
6. folder / note 命名交互不再残留浏览器原生 prompt。

