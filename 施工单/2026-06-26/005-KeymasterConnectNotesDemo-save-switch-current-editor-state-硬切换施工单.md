# KeymasterConnectNotesDemo 保存链路、切换拦截与当前编辑内存态硬切换一次性施工单

## 1. 本单定位

本单不是对 004 施工单的小修补，也不是“先留旧逻辑，后面再慢慢收敛”的过渡方案。

本单定义一次**硬切换**，目标是彻底解决当前这组高关联问题：

- 新建 note 默认已有标题，但 save 不可点
- save 后 title 回退到初始标题
- save 后按钮不变灰，系统误判仍可再次保存
- 左侧文件树标题与当前编辑标题不同步
- 刷新重新登录后，刚保存的 notes / 树结构不稳定甚至消失
- 点击文件树切换时，当前未保存内容的处理策略不清晰

本单与 [004-KeymasterConnectNotesDemo-save-tag-folder-ux-硬切换施工单.md](/home/david/Workspaces/KeymasterConnectNotesDemo/施工单/2026-06-26/004-KeymasterConnectNotesDemo-save-tag-folder-ux-硬切换施工单.md) 的关系如下：

- 004 中关于 tag chip 控件、命名弹层、创建时自动补编号的设计继续有效
- 004 中关于 `draft + pendingDrafts + save` 的旧定义，**全部以本单为准**

后续实现、联调、验收以本单为单真值。

## 2. 简述缘由

### 2.1 当前最大问题不是“加密失败”，而是编辑真值被拆成了三份

现在页面里实际上存在三套彼此打架的状态：

- `space.notes`
  已持久化 note 真值
- `pendingDrafts`
  未保存 note 的半成品 record
- `draft`
  当前编辑器里的真实输入

这会直接导致：

1. 文件树标题看一份状态
2. 编辑器输入看另一份状态
3. save 后某个 effect 又拿旧状态回灌当前输入

用户看到的结果就是：

- title 明明已经改了，但 save 后又跳回初始值
- save 明明已经成功加密，但按钮不变灰
- 树上的名字和当前编辑区的名字对不上

这不是某一个字段没同步，而是状态模型本身就是错的。

### 2.2 当前保存链路错误地把“保存”做成了“再打开当前 note 一次”

现在 save 前后会同时动这些状态：

- `space`
- `pendingDrafts`
- `selection`
- `draft`

而当前页面又把“选中 note 后重灌编辑态”的逻辑挂在这些状态变化上。

于是 save 虽然走完了 `cipher.encrypt`，但前端体验却像：

- 重新选中了一次当前 note
- 重新 hydration 了一次 title / tags / markdown

这就是 title 回退、save 不变灰、树消失感知的根因之一。

### 2.3 “多个 note 各自挂一个未保存 draft”不是必须能力，反而是复杂度来源

当前 demo 更合理的策略不是：

- 每个 note 都允许各自挂一份未保存草稿

而是：

- 全局只允许一个“当前正在编辑的内存态”
- 离开当前 note 前，要么保存成功，要么取消切换

这样做的收益很直接：

1. 状态模型更简单
2. save 成功后的收口路径唯一
3. 文件树、编辑器、持久层不会再长期分裂

### 2.4 新建 note 的“默认标题已存在，但还不能 save”不符合产品直觉

用户点击 `新建 note` 后，系统已经替用户生成了一个默认文件名。

这说明用户已经表达了明确创建意图。

因此更合理的规则是：

- 新建 note 一出现，就允许 save
- 不应要求用户必须先再手改一次标题或正文，save 才亮

否则“默认标题存在但不能保存”的行为没有产品意义，只会制造困惑。

## 3. 最终目标

本次完成后，页面必须达到以下状态：

1. 不再存在 `pendingDrafts` 这套未保存 note 容器。
2. 持久化真值只保留 `space.folders + space.notes`。
3. 当前编辑区只保留一份**当前编辑内存态**。
4. 新建 note 后，默认标题已存在，save 立即可点。
5. save 成功后：
   - 当前标题不回退
   - 文件树标题同步更新
   - save 立即变灰
   - 当前 note 不重新打开、不重新解密
6. 点击文件树切换时，若当前有未保存修改：
   - 弹页面内遮罩
   - 按钮只有 `保存并切换` / `取消`
7. 用户主动点击 save 时：
   - 弹页面内遮罩
   - 按钮只有 `取消`
8. popup 拒绝 / 关闭 / 超时 / 加密失败时：
   - 保留当前编辑内容
   - 不错误切换
   - 不把当前 note 回滚成旧状态

## 4. 最终状态模型

## 4.1 持久化真值

继续保留：

- `space.folders`
- `space.notes`

它们是唯一落盘真值。

明确不要：

- `pendingDrafts`
- “未保存 note 也先生成一条半持久化 record”
- 一份文件树标题真值 + 一份编辑区标题真值长期并存

## 4.2 当前编辑内存态

页面中只允许存在**一份**当前编辑内存态。

这里故意不强制命名成 `editingSession`，因为用户已经明确不认同那个术语。

实现上可以叫：

- `currentEditorState`
- `editingNoteState`
- `editorState`

都可以，但语义必须固定成同一件事：

- 当前正在编辑哪一条 note，或“当前是一个尚未落库的新建 note”
- 当前 title
- 当前 tags
- 当前 markdown
- 当前已保存基线
- 当前是否 `decryptFailed`

这份状态只活在内存里：

- 不进 localStorage
- 不给其他 note 各自保留一份
- 退出工作区时一起清掉

## 4.3 新建 note 的内存态

新建 note 后：

- 不立即写入 `space.notes`
- 但立即创建当前编辑内存态
- 默认 title 已经存在
- save 立即可点

直到第一次 save 成功后，才真正生成持久化 note record。

这条很重要：

- “新建 note”与“已落库 note”不是同一件事
- 但“新建 note”必须已经是一个完整可保存的编辑对象

## 5. 最终交互定义

## 5.1 主动点击 save

用户点击 `加密保存` 时：

1. 页面进入阻塞态
2. 显示半透明遮罩
3. 中间显示提示，要求用户到 popup 处理许可
4. 按钮只有：
   - `取消`

这里没有“保存并切换”，因为此时没有目标 note。

### 5.1.1 save 成功

成功后必须：

- 写入 `space.notes`
- 同步文件树标题
- 更新当前编辑内存态的“已保存基线”
- save 变灰
- 保持留在当前 note

### 5.1.2 save 失败或取消

若 popup 被取消、关闭、超时，或加密失败：

- 关闭遮罩
- 留在当前 note
- 保留当前未保存 title / tags / markdown
- save 状态继续按当前 dirty 判定

明确禁止：

- 失败后把 title 回滚成旧值
- 失败后把 markdown 清空
- 失败后错误提示成功

## 5.2 点击文件树切换

### 5.2.1 当前无未保存修改

直接切换。

### 5.2.2 当前有未保存修改

不允许直接切换，必须先弹遮罩。

遮罩按钮只有：

- `保存并切换`
- `取消`

行为定义：

- `保存并切换`
  先走 popup 保存，成功后再切到目标 note / folder
- `取消`
  关闭遮罩，回到当前编辑状态，不切换

### 5.2.3 保存并切换失败

若 popup 被取消、关闭、超时，或加密失败：

- 不切换
- 保留当前编辑内容
- 关闭遮罩或回到错误可见态
- 用户仍留在当前 note

明确禁止：

- 先切到目标 note，再尝试保存原 note
- 保存失败后仍然切换
- 保存失败后清掉当前未保存编辑态

## 5.3 遮罩视觉与交互

遮罩至少满足：

- 背后页面半透明，不可继续编辑
- 中央提示当前正在等待 Keymaster 许可
- 能明确区分：
  - `主动保存`
  - `保存并切换`

建议文案可按模式区分：

- 主动保存：
  - 标题：`等待 Keymaster 完成保存许可`
  - 按钮：`取消`
- 保存并切换：
  - 标题：`保存当前修改后再切换`
  - 按钮：`保存并切换` / `取消`

## 6. dirty 判定

## 6.1 已持久化 note

dirty 基线来自“当前编辑内存态里的已保存基线”。

只要以下任一不同，就算 dirty：

- title
- tags
- markdown

## 6.2 新建 note

新建 note 一创建出来，就视为可保存对象。

因此规则明确为：

- 新建 note 默认就是 dirty

理由：

- 它尚未持久化
- 用户已经触发了创建动作
- 默认 title 已经存在

不需要再依赖：

- 用户是否手动改过 title
- 用户是否手动输入过 markdown

## 6.3 save 变灰条件

save 变灰只在以下情形成立：

- 当前没有未保存修改
- 或当前处于 `decryptFailed`
- 或当前处于保存阻塞态

新建 note 刚出现时，不应变灰。

## 7. 怎么做

## 7.1 状态模型怎么改

在 `App.tsx` 做硬切换：

- 删除 `pendingDrafts`
- 删除依赖 `pendingDrafts` 的 hydration / merge / conflict 补丁逻辑
- 引入单一的“当前编辑内存态”
- 引入单一的“阻塞遮罩状态”

遮罩状态至少要能表达：

- `mode: "save"`
- `mode: "save-and-switch"`
- 目标切换对象（仅 `save-and-switch` 需要）

## 7.2 保存链路怎么改

save 成功时，只允许走下面这条路径：

1. 拿当前编辑内存态做 title / tags / markdown 校验
2. 调 `cipher.encrypt`
3. 生成或更新 note record
4. 写入 `space.notes`
5. 若是新建 note，则正式生成 persisted id
6. 用保存后的最终值回写当前编辑内存态的已保存基线
7. 关闭遮罩
8. 当前 note 保持选中

这里绝不能再出现：

- save 成功后，再从旧 record 回灌当前 title
- save 成功后，再走一次“选中 note → openNote → setDraft”

## 7.3 文件树标题怎么改

文件树显示必须遵循：

- 已保存 note：显示 `space.notes` 的 title
- 当前是新建未保存 note：显示当前编辑内存态里的 title

也就是说：

- 未保存新 note 可以出现在树里
- 但它是“当前编辑临时节点”
- 不是 `pendingDrafts` record

保存成功后：

- 临时节点无缝切换为 persisted note 节点
- 标题不跳回默认值

## 7.4 切换拦截怎么改

当前点击文件树：

- 若当前不 dirty：直接切换
- 若当前 dirty：不立即切换 selection，不立即改编辑区
- 先打开 `save-and-switch` 遮罩

只有在 save 成功后，才真正执行目标切换。

## 7.5 新建 note 怎么改

新建 note 时：

- 立即进入当前编辑内存态
- 默认 title 使用同目录唯一名策略
- save 立即可点
- 不往 `space.notes` 塞空密文占位 record

## 8. 不能怎么做

本次明确禁止以下实现方式：

1. 不能继续保留 `pendingDrafts`。
2. 不能让文件树 title 与编辑区 title 分别依赖两套不同真值。
3. 不能 save 成功后再触发一轮“重新打开当前 note”的 hydration。
4. 不能 save 成功后把 title 回退到初始标题。
5. 不能靠“用户必须手改一次 title 或 markdown”来让 save 变亮。
6. 不能点击文件树后先切过去，再尝试保存原 note。
7. 不能在 popup 失败时仍然切换到目标 note。
8. 不能在 popup 失败时丢掉当前未保存内容。
9. 不能为了简化状态而把当前 markdown 明文写进 localStorage。
10. 不能保留多个 note 的并行未保存内存态。
11. 不能把“当前编辑内存态”落成第二套长期 record 容器。
12. 不能继续用 effect 监听 `space.notes` 变化后无脑覆盖当前编辑输入。

## 9. 特殊情况与处理原则

## 9.1 popup 取消 / 关闭 / 超时

统一视为保存未完成。

处理原则：

- 主动保存：留在当前 note，保留输入
- 保存并切换：不切换，留在当前 note，保留输入

## 9.2 新建 note 后立即切换

若用户刚新建 note，还没 save，就点了另一个 note：

- 进入 `保存并切换` 遮罩
- 不允许静默丢弃

## 9.3 新建 note 后什么都没改

默认 title 已存在。

因此：

- save 仍然允许

若用户点击切换，也仍然按“当前 dirty”处理。

## 9.4 解密失败态

若当前 note 是 `decryptFailed`：

- 不能编辑 markdown
- 不能 save
- 不能走“保存并切换”
- 直接允许切到其他 note

因为此时不存在“当前未保存修改”。

## 9.5 创建后刷新页面

若新建 note 尚未 save 就刷新：

- 它消失是合理的

若 save 已成功：

- 刷新后重新登录必须仍能在树里看到

## 9.6 重命名与保存联动

当前标题输入框修改后：

- 当前编辑内存态立刻更新
- 若当前对象是未保存新 note，树里临时节点标题也要同步更新

save 成功后：

- persisted title 与树标题一致
- save 立刻变灰

## 10. 文件级实施范围

## 10.1 [src/App.tsx](/home/david/Workspaces/KeymasterConnectNotesDemo/src/App.tsx)

负责改动：

- 删除 `pendingDrafts`
- 重做当前编辑内存态模型
- 重做 save / save-and-switch 遮罩状态机
- 重做新建 note 的创建与首次保存路径
- 重做切换拦截逻辑
- 重做当前 note 的 hydration 规则
- 重做 dirty 判定

这是本次硬切换的核心文件。

## 10.2 [src/components/NotesSidebar.tsx](/home/david/Workspaces/KeymasterConnectNotesDemo/src/components/NotesSidebar.tsx)

负责改动：

- 支持显示“当前未保存新 note 临时节点”
- 点击树节点时不再直接假定切换一定成功
- 配合 `App` 的切换拦截流程

## 10.3 [src/components/NoteInspector.tsx](/home/david/Workspaces/KeymasterConnectNotesDemo/src/components/NoteInspector.tsx)

负责改动：

- save 按钮禁用逻辑对齐新的 dirty 规则
- 保存中阻塞态与普通态区分
- 保持 tag 控件接入不变

## 10.4 [src/components/NoteEditor.tsx](/home/david/Workspaces/KeymasterConnectNotesDemo/src/components/NoteEditor.tsx)

负责改动：

- 避免外部状态小变化就重灌 markdown
- 保证 save 成功后不会表现成“重新打开当前 note”

## 10.5 新增 `src/components/SaveOverlayDialog.tsx`

职责：

- 页面中央阻塞遮罩
- 支持两种模式：
  - 主动保存：`取消`
  - 保存并切换：`保存并切换` / `取消`
- 展示等待 Keymaster 许可的提示

若不单独建文件，也可以收在现有组件里，但职责必须明确。

## 10.6 [src/lib/storage.ts](/home/david/Workspaces/KeymasterConnectNotesDemo/src/lib/storage.ts)

负责改动：

- 保留 folder / note 持久化真值
- 不再为未保存 note 提供半持久化容器语义
- 唯一名生成工具继续保留

## 10.7 [src/styles.css](/home/david/Workspaces/KeymasterConnectNotesDemo/src/styles.css)

负责改动：

- 保存阻塞遮罩样式
- 半透明禁用层样式
- 遮罩按钮双模式样式

## 11. 最终验收清单

## 11.1 新建 note

- 点击 `新建 note` 后，默认标题已存在。
- 新建 note 后，即使 markdown 还是空，save 也立即可点。
- 新建 note 修改标题时，树里的临时节点标题同步变化。

## 11.2 主动保存

- 点击 save 后，页面出现阻塞遮罩。
- 主动保存的遮罩按钮只有 `取消`。
- popup 成功后，当前 note title 不回退。
- popup 成功后，文件树标题与当前标题一致。
- popup 成功后，save 立即变灰。
- popup 成功后，不重新进入“解密中...”。
- popup 取消/失败后，当前输入内容仍保留。

## 11.3 保存并切换

- 当前有未保存修改时，点击其他 note 不直接切换。
- 此时出现阻塞遮罩。
- 按钮只有 `保存并切换` / `取消`。
- `取消` 后留在当前 note，内容不丢。
- `保存并切换` 成功后，先保存，再切到目标 note。
- `保存并切换` 失败后，不切换，内容不丢。

## 11.4 持久化与刷新

- save 成功后的 note，刷新并重新登录后仍能在树中看到。
- save 成功后的 note，点开后能正常解密并显示正文。
- 未 save 的新建 note，刷新后消失是符合预期的。

## 11.5 结构性约束

- 代码中不再存在 `pendingDrafts`。
- 当前编辑状态只有一份内存态。
- save 成功后不会再触发旧 title 回灌。
- 文件树与编辑区不会长期依赖两套 title 真值。

## 12. 本单完成标志

以下条件同时满足，才算本单完成：

1. 新建 note 默认即可保存。
2. save 成功后 title 不回退。
3. save 成功后文件树标题同步且按钮变灰。
4. 切换 note 时未保存内容必须先经过遮罩流程。
5. 主动保存和保存并切换两种遮罩按钮集合不同。
6. 刷新重新登录后，已成功保存的 notes 树仍稳定存在。

