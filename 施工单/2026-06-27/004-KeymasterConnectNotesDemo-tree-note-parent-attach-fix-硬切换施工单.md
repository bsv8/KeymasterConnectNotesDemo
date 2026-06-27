# KeymasterConnectNotesDemo 文件树 note 挂载层级错误修复硬切换施工单

## 1. 本单定位

本单只处理一个明确 bug：

- 左侧文件树里，所有 note 都显示在根目录下；
- 没有正确显示在各自所属的子目录下面。

这不是 sidebar 样式问题，也不是搜索结果页问题，而是**树真值构建错误**。

因此本单不是“在 `NotesSidebar` 渲染时补挂 note”的权宜补丁，也不是“只让 UI 看起来对”的修饰方案，而是一次针对 `buildTree()` 的**硬修复**：

- 树结构真值回到正确语义；
- sidebar、搜索结果排序、祖先路径展开等所有上层能力继续依赖这份真值；
- 不引入第二套“临时树”或“渲染时纠偏树”。

后续实现、联调、验收均以本单为单真值。若与当前临时行为冲突，以本单为准。

## 2. 简述缘由

### 2.1 这是树真值错误，不是视图层错误

当前左侧树来自 [src/lib/path.ts](/home/david/Workspaces/KeymasterConnectNotesDemo/src/lib/path.ts) 的 `buildTree()`。

`NotesSidebar` 只是消费这棵树：

- folder 怎么递归显示；
- note 显示在哪一层；
- 根目录显示哪些直属 note。

因此现在“所有 note 都跑到根目录”这个现象，不应在 sidebar 里通过额外判断补救。  
一旦在渲染层补，会立刻出现这些问题：

1. sidebar 看到的树和搜索结果排序用的树不再一致；
2. 祖先路径展开依赖的 folder / note 拓扑会继续错；
3. 后续拖拽、选中、计数、折叠行为都可能再分叉一套逻辑。

### 2.2 当前 `buildTree()` 只消费了根和一层 folder 的 note

根因可以直接概括为：

- `notesByParent` 是按 `note.folderId` 分桶的，这一步没问题；
- 但后续 `consumeNotes()` 只对：
  - `null`（根目录）
  - `root.folders`
  做了有限几次消费；
- 它**没有递归走完整棵 folder 树**，因此更深层目录下的 note 永远不会被挂到对应 folder；
- 最后残留的 note 被当成 leftover，统一塞回 `root.notes`。

所以这不是“显示顺序错了”，而是“挂载节点错了”。

### 2.3 必须修树构建，而不是在别处补洞

当前项目已经有这些依赖树真值的地方：

1. 左侧 sidebar 渲染
2. 搜索结果的树顺序排序
3. 点击搜索结果后的祖先路径展开
4. 根目录直属 note 的展示

如果树真值不修，这些能力都会建立在错误拓扑上。  
因此最合理的办法只有一个：

- **把 `buildTree()` 修成真正递归挂载 note 的实现**

## 3. 最终目标

本次修复完成后，必须满足：

1. `note.folderId === null` 的 note 显示在根目录。
2. `note.folderId === 某个 folder.id` 的 note 显示在该 folder 下。
3. 多层嵌套目录下的 note，也能正确挂到对应层级。
4. 真正找不到所属 folder 的 note，才按“根目录孤儿”兜底显示。
5. sidebar 树、搜索结果排序、祖先路径展开，都继续共用同一份 `buildTree()` 真值。
6. 不在 `NotesSidebar` 或 `App.tsx` 里新增“渲染时补挂 note”的并行逻辑。

## 4. 当前错误的具体机制

以当前 [src/lib/path.ts](/home/david/Workspaces/KeymasterConnectNotesDemo/src/lib/path.ts) 的 `buildTree()` 为例，问题在于：

1. 先建好了 folder 树骨架；
2. 再把 note 按 `folderId` 放进 `notesByParent`；
3. 之后只做了这些消费：
   - `consumeNotes(null, root)`
   - 对 `root.folders` 做少量 `consumeNotes(f.id, f)`
4. 但没有“递归进入每个 child folder 再消费它自己的 note”
5. 所以深层 folder 的 note 会残留在 `notesByParent`
6. 最后残留 note 被 fallback 到 `root.notes`

这就是“所有文档都显示在根目录”的直接原因。

## 5. 修复方案

## 5.1 总体原则

修复必须收口在 `buildTree()`：

1. 先完整构建 folder 树
2. 再递归给每个 folder 挂它自己的 note
3. 根目录最后只保留：
   - 真正的根目录 note
   - 找不到父 folder 的孤儿 note

不能在 sidebar 里额外按 `folderId` 再做一次映射，那会把树真值和显示逻辑分裂成两套。

## 5.2 推荐实现步骤

建议把 `buildTree()` 重写成下面这个更直接的流程：

### 第一步：创建所有 folder 节点

- 遍历 `folders`
- 为每条 folder record 创建 `TreeFolderNode`
- 存入 `folderById`

这一步保持不变。

### 第二步：把 folder 挂成完整树

- 遍历 `folderById`
- 若 `parentId` 存在且能找到父 folder：
  - 挂到父 folder 的 `folders`
- 否则：
  - 挂到 `root.folders`

这一步也基本保持现有思路不变。

### 第三步：把 note 直接挂到目标 folder 或 root

这里不要再先“只消费一层”，而是直接逐条 note 挂载：

1. 遍历所有 `notes`
2. 若 `note.folderId === null`：
   - 直接挂到 `root.notes`
3. 若 `note.folderId` 能在 `folderById` 里找到：
   - 直接挂到对应 folder 的 `notes`
4. 若 `note.folderId` 找不到：
   - 按孤儿 note 兜底挂到 `root.notes`

这一步是本单真正的修复核心。

### 第四步：递归排序

排序规则保持当前语义：

1. 同一父目录下 folder 按 `title` 排序
2. 同一父目录下 note 按 `title` 排序
3. 根目录下的 folder / note 同样按各自 title 排序

建议增加一个递归函数，例如：

- `sortFolderTree(node: TreeFolderNode)`

逻辑：

1. 先对 `node.folders` 排序
2. 对 `node.notes` 排序
3. 再递归对子 folder 调 `sortFolderTree`

最后：

1. 对 `root.folders` 排序
2. 对 `root.notes` 排序
3. 对每个 root child folder 递归排序

## 5.3 为什么建议“逐条 note 直接挂载”，而不是继续 `notesByParent + consumeNotes`

因为这次需求不是“做通用树遍历框架”，而是“把 note 挂对地方”。

直接挂载方案有几个明显优点：

1. 逻辑短
2. 不会漏递归层级
3. 不需要 leftover 二次消费来弥补主流程缺口
4. 根目录直属 note 和孤儿 note 的语义非常清楚

这更符合当前项目的简化原则。

## 6. 特殊情况与提前决策

## 6.1 根目录 note

若 `note.folderId === null`：

- 这条 note 本来就属于根目录
- 必须显示在 `root.notes`

这不是异常态。

## 6.2 孤儿 note

若 `note.folderId` 指向一个不存在的 folder：

- 不额外报错
- 不中断构树
- 直接兜底挂到根目录

理由：

- 这符合当前项目“系统简单优先”的方向；
- 比起为了这类脏数据再引入复杂校验或失败态，更合理的是保守可见；
- 用户至少还能在根目录看到这条 note，而不是整条丢失。

## 6.3 多层嵌套 folder

若 folder 是多层嵌套：

- note 必须挂到它真实 `folderId` 对应的那一层
- 不能因为它不是 root child，就被当成 leftover 扔回根目录

这正是本单要修的主问题。

## 6.4 空标题

排序时仍沿用当前逻辑：

- `title.localeCompare(...)`

显示时继续由上层组件负责：

- 空标题显示 `未命名 note`
- 空 folder 标题显示 `未命名文件夹`

本单不顺手改命名规则。

## 7. 不能怎么做

下面这些做法本单明确禁止：

1. 在 `NotesSidebar.tsx` 里重新按 `note.folderId` 把 note 补挂到 folder。
2. 在 `App.tsx` 里给 sidebar 单独构一棵“修正版树”。
3. 保留当前 `buildTree()` 的有限消费逻辑，再靠 leftover 兜底掩盖问题。
4. 只修 sidebar，不修搜索结果排序。
5. 为了处理孤儿 note，直接把异常 note 丢弃不显示。
6. 顺手重构拖拽、搜索、展开状态等无关逻辑。

## 8. 文件级实施方案

## 8.1 [src/lib/path.ts](/home/david/Workspaces/KeymasterConnectNotesDemo/src/lib/path.ts)

目标：

- 修正 `buildTree()`，让 note 正确挂到所属 folder。

需要做的事：

1. 保留当前 folder 节点创建逻辑
2. 保留当前 folder 树挂载逻辑
3. 删除当前“只消费根和 root child folder 的 note”逻辑：
   - `notesByParent`
   - `consumeNotes`
   - 基于“少数几次消费 + leftover”的路径
4. 改为“逐条 note 直接挂载”：
   - `folderId === null` → `root.notes`
   - `folderId` 命中 `folderById` → 对应 folder 的 `notes`
   - 否则 → `root.notes`
5. 补一个递归排序函数，把 folder 和 note 都在正确层级排好序

不能做的事：

- 不能为了省事只在 `root.folders` 一层补排序。
- 不能把“找不到 folderId”的 note 静默吞掉。

## 8.2 [src/components/NotesSidebar.tsx](/home/david/Workspaces/KeymasterConnectNotesDemo/src/components/NotesSidebar.tsx)

目标：

- 原则上不改业务逻辑。

需要做的事：

- 理论上不需要改；
- 仅在 `buildTree()` 修正后复测：
  - 根目录直属 note
  - 子目录 note
  - 多层目录 note

不能做的事：

- 不能在这里增加“如果 node.notes 为空就去全局 note 里再查一次”的补丁。

## 8.3 [src/App.tsx](/home/david/Workspaces/KeymasterConnectNotesDemo/src/App.tsx)

目标：

- 原则上不改逻辑，只做联动复测。

需要验证：

1. 搜索结果排序仍按树自然顺序
2. 点击搜索结果后祖先路径展开仍正确
3. 展开状态持久化不受影响

不能做的事：

- 不能因为树挂载修复，再在 `App` 里新增对 note 层级的二次计算。

## 9. 最终验收清单

以下清单全部通过，才算本单完成：

1. 根目录直属 note 仍显示在根目录。
2. 某个一级 folder 下的 note 显示在该 folder 下，不再跑到根目录。
3. 某个二级或更深层 folder 下的 note，也显示在对应 folder 下。
4. 左侧树里不再出现“几乎所有 note 都堆在根目录”的现象。
5. 折叠某个 folder 后，该 folder 下的 note 会随 folder 一起隐藏。
6. 展开某个 folder 后，该 folder 下的 note 会正确显示出来。
7. 搜索结果排序仍与左侧树顺序一致。
8. 点击搜索结果中的某条 note，左侧会展开到正确祖先路径。
9. `note.folderId` 指向不存在 folder 时，该 note 仍会出现在根目录，而不是消失。
10. `npm run typecheck` 通过。
11. `npm run build` 通过。

## 10. 结论

这次问题的本质不是“树看起来错了”，而是：

- `buildTree()` 没有把 note 正确挂到完整 folder 树上。

因此修复也必须回到树构建真值：

- folder 树照常建；
- note 逐条直接挂到目标 folder 或根目录；
- 排序递归做完；
- 其他上层能力继续复用这棵树。

这比在 sidebar 或搜索结果层继续补洞简单得多，也更符合当前项目“单真值、少分支、不做补丁树”的方向。
