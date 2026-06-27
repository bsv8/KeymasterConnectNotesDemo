# KeymasterConnectNotesDemo note 打开解密取消替换与 transport 去单飞硬切换一次性施工单

## 1. 本单定位

本单不是对当前 `openChainRef` 串行队列的局部修补，也不是“先兼容旧 `session_busy`，后面再慢慢重构”的过渡方案。

本单定义一次**硬切换**，目标是把当前 demo 的 note 打开链路从：

- 前端自己串行排队
- 前一个没处理完，后一个不能发
- 用户切走后旧请求还继续占着前端时序

切到下面这套新定义：

- Keymaster popup 会话允许并行接受多条 request；
- Keymaster 内部执行仍可串行，这由 Keymaster 自己负责，不由 demo 前端排队；
- demo 前端切 note 时，对旧 note 解密请求发 `cancel`；
- `cancel` 只做 best-effort，不等它成功；
- 立即发新 note 的解密请求；
- 不是当前要的结果，一律丢弃，不写回 UI。

后续实现、联调、验收以本单为单真值。

## 2. 简述缘由

### 2.1 现有前端串行队列已经与协议能力错位

当前项目里有两层旧约束：

- `src/App.tsx` 里的 `openChainRef`
  把 note 解密做成前端串行排队；
- `src/lib/popupSessionClient.ts`
  把整个 popup session 写成单 in-flight request，第二条直接报 `session_busy`。

这两层设计的出发点原本是为了规避旧协议能力下的单请求限制。

但现在 `keymaster.cc` 已经改成：

- popup 会话可以并行接受多条 request；
- 外部可以并行发 `cancel`；
- 内部执行顺序与排队由 Keymaster 自己负责；
- request 的最终结果继续按 `request.id` 回来。

因此本项目继续保留自己的串行队列，只会制造额外延迟和错误交互，不再有存在价值。

### 2.2 当前用户看到的“第二个 note 要等第一个确认完才发”是前端人为造成的

用户连续点击多个未解密 note 时，当前 demo 的行为是：

1. 第一个 note 发起解密；
2. 第二个 note 先被 UI 选中；
3. 但第二个 note 的真正请求不会立刻发；
4. 必须等第一个 note 的请求先跑完，第二个才会继续发。

这与用户直觉完全相反。

对“当前正在看的 note”来说，更合理的策略是：

- 当前不想看的旧 note，不要继续占着打开链路；
- 旧请求能取消就取消；
- 不能取消也没关系，至少不能卡住新的 note。

### 2.3 本 demo 需要的是“当前 note 优先”，不是“通用多请求编排器”

虽然协议层现在允许多 request 并存，但本 demo 的需求仍然很简单：

- 我们只需要把“打开 note 解密”从串行排队改成“切换即替换”；
- 不需要顺手做成一个通用复杂调度器；
- 不需要引入请求池、优先级、批处理、重试、恢复。

系统设计上优先简单，应该把复杂度压在最小边界：

- 业务层只认“当前 note 是谁”；
- transport 层只保留最薄的一层 pending 收尾能力；
- 不做额外业务状态机。

## 3. 最终目标

本次完成后，系统必须达到以下状态：

1. note 打开链路不再使用 `openChainRef` 串行排队。
2. popup session client 不再用单 `inFlight` 拒绝第二条 request。
3. 切 note 时，若旧 note 解密仍在 pending：
   - 对旧请求发 `cancel`
   - 不等 cancel 结果
   - 立即发新 note 解密请求
4. 旧请求结果即使晚回来，也不能覆盖当前 UI。
5. 从 note 切到 folder / root 时，也要取消当前 pending decrypt。
6. `cancel` 命中失败、被忽略、或旧请求已进入 `executing` 时：
   - 不能阻塞新 note 请求
   - 不能把旧 note 结果写回当前 UI
7. `identity.get` / `cipher.encrypt` 继续能正常工作，但不再依赖 transport 的 single-flight 假设。
8. 关闭 popup、切换 `targetOrigin`、退出当前 identity 时，所有 pending request 都能被收尾 reject，不留下悬挂 promise。

## 4. 设计总原则

### 4.1 业务真相只认“当前想看的 note”

对于 note 打开链路，业务层不再追求“精确追踪所有历史请求的完整生命周期”。

业务层只需要维护：

- 当前打开操作代际；
- 当前正在等待的 decrypt request id；
- 该 request 对应的 note id。

规则固定为：

- 当前 note 变了，旧 request 立刻失去业务价值；
- 失去业务价值的结果一律丢弃；
- `cancel` 只是尽力而为，不是 UI 真相源。

### 4.2 transport 只做最薄的 request/promise 收尾

本单明确允许业务层粗糙化，但**不**允许 transport 层完全不记 pending。

原因不是为了“精确业务编排”，而是为了最基本的协议收尾：

- `result` 是按 `request.id` 回来的；
- `cancel` 没有单独 ack；
- popup 关闭 / `closing` / `targetOrigin` 切换时，pending promise 必须统一 reject。

所以 transport 层只保留最薄的一层 pending request 注册表，用来：

- 把 `result(id)` 分发给对应 promise；
- 给每条 request 单独挂 timeout；
- 在 session 断开时批量 reject。

它不是业务状态机，也不承担“当前 note 是谁”的判断。

### 4.3 不把“发出 cancel”误当成“旧请求一定消失”

协议已经明确：

- `cancel` 没有成功回执；
- `executing` 阶段会忽略 `cancel`；
- 旧请求可能在 cancel 之后仍然回结果。

因此 UI 侧正确做法只能是：

- 发 cancel；
- 继续前进；
- 对旧结果做代际淘汰。

不能把系统建立在“cancel 发出后旧请求绝不会回来”的假设上。

## 5. 最终行为定义

## 5.1 note -> note 切换

用户从 note A 切到 note B 时：

1. 若当前没有未保存拦截，先落地 selection 到 note B；
2. 若 A 的 decrypt request 仍 pending：
   - 立即对 A 发 `cancel(A.requestId)`；
   - 本地把 A 标记为过期请求；
   - 不等待 A 的 reject / result；
3. 立即为 B 生成新的打开代际和新的 decrypt request；
4. editor 立刻进入 B 的 `loading` 占位态；
5. B 的请求结果回来时，只有当它仍是当前代际，才允许写回 UI。

明确要求：

- B 不能等待 A 完成后再发送；
- B 不能因为 A 的 cancel 结果还没回来就卡住；
- A 晚回来的结果不能把 B 的 editor 覆盖掉。

## 5.2 note -> folder / root 切换

用户从 note 切到 folder 或 root 时：

1. 若当前没有未保存拦截，允许切换；
2. 若当前 decrypt request 仍 pending：
   - 发 `cancel`
   - 不等待结果
3. 清空当前 editorState；
4. 后续旧 decrypt 结果一律丢弃。

这里不能因为“目标不是另一个 note”就省略 cancel。

## 5.3 同一 note 重复点击

同一 note 重复点击仍然是 no-op：

- 不重发 decrypt；
- 不重置当前 editorState；
- 不额外发 cancel。

### 5.3.1 例外：当前 note 已是失败态且用户明确触发重试

若后续产品要做“重试打开当前 note”，必须走显式入口，不在本单范围内。

本单不引入：

- 点击当前 note 自动重试
- `decryptFailed` 自动轮询重试
- 基于 focus 的隐式重试

## 5.4 save / login 与 decrypt 的边界

本单的主要变化面是“打开 note 解密”。

`identity.get` 与 `cipher.encrypt` 的业务交互仍按现有页面规则：

- login 仍由显式按钮触发；
- save 仍由显式按钮触发，并继续受遮罩/阻塞 UI 约束。

但 transport 层不再假设“全局同一时刻只能有一条 request”。

这意味着：

- save / login 不需要复用 note 打开队列；
- 它们也不能再依赖 `session_busy` 作为前端控制手段；
- UI 若要继续阻止用户重复点 save，应在业务层做，而不是靠 transport 拒绝。

## 5.5 popup session 生命周期

popup session 级别继续保持：

- `ready` 代表连接建立；
- `closing` / popup closed 代表窗口断开；
- `result` 只代表单条 request 的业务结果。

本单不改变这些定义，但要求 client 收尾逻辑改成：

- session 断开时，所有 pending request 统一 reject；
- 不能只 reject “当前唯一 in-flight”；
- 不能留下孤儿 timeout 或悬挂 promise。

## 6. 特殊情况与提前决策

## 6.1 快速连续点 A -> B -> C

最终必须表现为：

- A 发出 decrypt；
- 点 B：对 A 发 cancel，立刻发 B；
- 点 C：对 B 发 cancel，立刻发 C；
- 谁最后仍是当前代际，谁才有资格写 UI。

即使 A/B 的结果后来都回来，也只能被丢弃。

## 6.2 cancel 被协议忽略

出现下列任一情况都允许：

- 旧请求已经进入 `executing`
- `cancel.id` 没命中
- popup 已经在内部收尾

此时系统行为仍必须正确：

- 新 note 已经发出请求；
- 旧请求晚回来的结果不会覆盖当前 UI；
- 不因此报“当前 note 解密失败”。

## 6.3 popup 被用户关闭

若用户在一个或多个 pending request 存在时手动关掉 popup：

- session client 统一 reject 所有 pending promise；
- 当前代际对应的打开请求若仍是当前 note：
  - editor 进入 `decryptFailed` 或等价失败态
  - 错误文案按 transport 错误展示
- 已过期请求的失败结果只收尾，不写 UI。

## 6.4 切换 target origin

切换 `targetOrigin` 时：

- 旧 session 直接关闭；
- 所有 pending request 统一 reject；
- 不尝试把旧 origin 下的 request “迁移”到新 session；
- 不对旧 request 再额外补发 cancel。

原因很简单：

- session 已经整体作废；
- 继续补偿只会增加复杂度，没有业务收益。

## 6.5 退出当前 identity / 重新登录

退出当前 identity 或切换 owner 时：

- 旧 session 关闭；
- 当前 note 打开代际清零；
- 当前 pending decrypt 引用清空；
- 旧结果全部视为过期。

不能把旧 owner 的 late result 写到新 owner 的工作区。

## 6.6 当前 note 正在 loading 时又被删除或空间被清空

若 pending decrypt 对应的 note 在本地空间里被删除，或整个 owner 空间被清空：

- 当前打开代际直接失效；
- editor 回到 root / null；
- 旧请求结果回来时继续丢弃。

不需要为这种边界引入额外恢复机制。

## 7. 不能怎么做

下面这些做法本单明确禁止：

1. 继续保留 `openChainRef`，把 note 打开链路串行排队。
2. 继续保留 `PopupSessionClient` 的单 `inFlight` + `session_busy` 限制。
3. 用“关闭整个 popup session”代替“取消单条旧 decrypt request”。
4. 把 DOM focus 当成请求真相源，用焦点变化驱动 cancel 或重试。
5. 把“cancel 已发送”当成“旧请求一定不会再回结果”。
6. 把所有 `result` 粗暴地路由给“最新一次调用者”，忽略 `request.id`。
7. 为了追求业务完整，额外引入：
   - 请求队列
   - 自动重试
   - 补偿事务
   - 通用请求编排器
8. 在 `executing` 后继续尝试做“半取消”或“结果反转”。
9. 因为旧请求失败，就把当前新 note 误标成 `decryptFailed`。
10. 因为 transport 已支持并发，就顺手改写 save/login 的产品交互。

## 8. 文件级实施方案

## 8.1 `src/lib/protocol.ts`

目标：

- 补齐顶层 `cancel` 报文类型；
- 把协议消息定义与 `keymaster.cc` 当前 V1 收口对齐。

需要做的事：

1. 新增 `ProtocolCancelMessage` 类型。
2. 把 `ProtocolMessage` union 纳入 `cancel`。
3. 保持 `cancel` 不是业务 method，不进入 `ProtocolMethod`。

不能做的事：

- 不能把 `cancel` 写成 `method: "cancel"`。
- 不能给 `cancel` 定义独立 `result`。

## 8.2 `src/lib/connectClient.ts`

目标：

- 保持现有 `requestId -> result callback` 分发模型；
- 如有必要，补足 `cancel` 相关日志/类型支持。

需要做的事：

1. 保持 dispatcher 继续只按 `result.id` 分发业务结果。
2. 若日志阶段需要扩展，可增加 `cancel_sent` 一类 transport 日志。

不能做的事：

- 不能把 dispatcher 改成“永远只认最后一个 requestId”。
- 不能把 `cancel` 的无回包语义误做成要等待一条 `result`。

## 8.3 `src/lib/popupSessionClient.ts`

目标：

- 从 single-flight session client 改成 multi-pending session client；
- 仍保持实现简单，不做业务调度。

需要做的事：

1. 删除单 `inFlight` 设计。
2. 改成最薄的 pending request 注册表：
   - key = `request.id`
   - value = 该 request 的 resolve / reject / timer
3. `runRequest()`：
   - 不再因为已有 pending 就报 `session_busy`
   - 每次独立注册结果回调与 timeout
4. 新增 `cancelRequest(id: string)`：
   - 仅向 popup 发顶层 `cancel`
   - fire-and-forget
   - 不等待 ack
5. `closeSession()` / `closing` / popup closed：
   - 批量 reject 全部 pending
   - 清空所有 timer
   - 清空注册表

不能做的事：

- 不能把它扩展成通用业务状态机。
- 不能做“cancel 后自动帮上层吞掉原 request promise”这种模糊语义。
- 不能保留 `session_busy` 作为正常控制流。

## 8.4 `src/App.tsx`

目标：

- 去掉 note 打开串行队列；
- 改成“旧 decrypt cancel + 新 decrypt 立即发 + 旧结果淘汰”。

需要做的事：

1. 删除 `openChainRef`。
2. 保留并继续使用 `openOperationRef` 或等价代际机制。
3. 为当前 pending decrypt 单独保存最小引用：
   - request id
   - note id
   - 对应代际
4. `openPersistedNote(record)` 改成：
   - 进入 loading 占位
   - 若存在旧 pending decrypt，先 `cancelRequest(oldId)`
   - 立即发新 decrypt
   - 结果回来时按代际 + 当前 note 校验决定是否写 UI
5. 从 note 切到 folder / root，或 owner/session 被重置时：
   - 清空当前 pending decrypt 引用
   - 尽量对旧 decrypt 发 cancel
6. 失败分支只允许把“当前代际的当前 note”打成失败态；
   已过期请求只能静默收尾。

不能做的事：

- 不能把旧请求的 reject 直接展示成当前 note 的错误。
- 不能因为 cancel 后收到 `user_rejected`，就把当前新 note 判成解密失败。
- 不能在 `openPersistedNote` 里重新引入 await 上一个请求的逻辑。

## 8.5 `README.md`

目标：

- 文档与行为一致。

需要做的事：

1. 更新 note 打开链路描述：
   - 快速切 note 时，旧 decrypt 会被取消；
   - 当前 note 优先；
   - 旧结果会被丢弃。
2. 若 README 里还有“同一时刻只允许一条在途 request”之类表述，必须删掉或改写。

不能做的事：

- 不能继续让 README 描述旧 single-flight 事实。

## 9. 实施顺序

本单是一次性硬切换，不分阶段保留兼容逻辑。

实施顺序固定为：

1. 先改协议类型与 session client，移除 single-flight 前提。
2. 再改 `App.tsx` 的 note 打开链路，删除 `openChainRef`。
3. 最后更新 README 与验收描述。

不能反过来先删 `openChainRef` 再保留旧 `session_busy` client。

那样只会把 note 打开链路从“显式排队”变成“随机报错”。

## 10. 最终验收清单

### 10.1 代码结构验收

- [ ] `src/App.tsx` 中已不存在 `openChainRef` 串行队列。
- [ ] `src/lib/popupSessionClient.ts` 中已不存在单 `inFlight` 限制。
- [ ] `src/lib/protocol.ts` 已支持顶层 `cancel` 报文。
- [ ] transport 层存在最薄 pending request 收尾能力，但没有膨胀成业务调度器。

### 10.2 note 打开链路验收

- [ ] 点击未解密 note A，会发起 A 的 decrypt。
- [ ] 在 A 尚未处理完时点击未解密 note B，前端会立即对 A 发 `cancel`，并立即发 B 的 decrypt。
- [ ] B 不需要等待 A 完成后才发送。
- [ ] 若 A 后来仍回结果，A 的结果不会覆盖当前 B 的 UI。
- [ ] 从 note 切到 folder / root 时，当前 pending decrypt 会被取消，旧结果不会再写 UI。
- [ ] 同一 note 重复点击不会重复发 decrypt。

### 10.3 cancel 边界验收

- [ ] `cancel` 没有独立 ack 时，前端逻辑仍然稳定。
- [ ] 旧请求已进入 `executing`、导致 cancel 被忽略时，新 note 仍能正常继续打开。
- [ ] 旧请求被取消后若回 `user_rejected`，不会把当前新 note 误判成失败。
- [ ] 多次快速切换 A -> B -> C 时，只有最后当前 note 的结果会落 UI。

### 10.4 session 生命周期验收

- [ ] popup 被手动关闭时，所有 pending request 都会被 reject 收尾。
- [ ] 切换 `targetOrigin` 时，旧 session pending request 不会泄漏到新 session。
- [ ] 退出当前 identity / 切换 owner 后，旧 owner 的 late result 不会写进新工作区。

### 10.5 save / login 不回归验收

- [ ] 登录链路仍可正常工作。
- [ ] 保存链路仍可正常工作。
- [ ] save / login 的 UI 控制仍然在业务层，不依赖 `session_busy`。
- [ ] 本次改动没有顺手引入 save / login 的自动重试、自动取消、复杂并发编排。

### 10.6 构建与手工联调验收

- [ ] `npm run typecheck` 通过。
- [ ] `npm run build` 通过。
- [ ] 本地手工联调可复现并确认：原先“第二个 note 要等第一个确认完才发”的现象已消失。

## 11. 本单结论

本单的核心不是“支持任意复杂并发”，而是把系统收口到一个更符合当前协议能力、也更符合 demo 简单性原则的定义：

- Keymaster 负责内部执行串行；
- 前端不再自建 note 打开队列；
- 旧 decrypt 失去业务价值后立即 cancel；
- cancel 不可靠也没关系，旧结果直接丢弃；
- transport 只保留最薄的 pending 收尾能力；
- 不为了业务完整度把 demo 变成复杂调度系统。

后续实现如果偏离这几条，就说明又在把简单问题做复杂。
