# 003 KeymasterConnectNotesDemo 锁屏页 popup 关闭语义与重新登录入口硬切换一次性施工单

## 参考文档与依赖项目

本次施工、联调、验收以下列文档与代码为准：

- 本仓库：
  - `README.md`
  - `src/App.tsx`
  - `src/components/LockScreen.tsx`
  - `src/lib/popupSessionClient.ts`
  - `src/lib/connectClient.ts`
  - `src/i18n/messages.ts`
  - `src/i18n/types.ts`
- 关联施工单：
  - `施工单/2026-06-28/001-KeymasterConnectNotesDemo-connect-session-bound-key-integration-硬切换施工单.md`
  - `施工单/2026-06-28/002-KeymasterConnectNotesDemo-protocol-business-methods-bind-connect-session-硬切换施工单.md`

发生冲突时：

1. `connect session` 作为登录真值、`ownerPublicKeyHex` 作为 owner 真值，仍以 `001` 为准。
2. 本单只收口两个边界：
   - 锁屏页如何理解 `popup_closed` 与 `popup_blocked`
   - 锁屏页如何收口“登录 / 重新登录 / 忘掉当前 session”入口
3. 只要后续实现碰到这两个边界，均以本单为最新真值；旧 README、旧注释、旧施工单里与本单冲突的表述都视为待清理残留。

---

## 1. 本单定位

本单不是在现有锁屏页上继续加一个“更精细的错误文案”，也不是保留“忘掉当前 session”按钮再顺手加一个“重新登录”按钮。

本单定义一次**硬切换**，目标是把锁屏页从下面这套混杂语义：

- popup 失联后，用户容易看到像“被浏览器拦截”这样的错误感知；
- 有本地 `sessionId` 时，同时暴露“登录”和“忘掉当前 session”两个入口；
- “重新登录”与“忘掉 session”在产品心智上分裂；
- 为了换 key / 换 provider，页面要求用户先做一次“忘掉”动作；

切到下面这套更简单的定义：

- `popup_blocked` 只表示**浏览器没有允许开窗**
- 锁屏页里的 `popup_closed` 只表示**这次尝试结束了**，不自动算页面错误
- 有本地 `sessionId` 时，主按钮文案固定为**重新登录**
- 没有本地 `sessionId` 时，主按钮文案固定为**登录**
- 锁屏页删除“忘掉当前 session”按钮
- 想换 key / 换 provider / 放弃当前本地 session 的用户，直接点**重新登录**

后续实现、联调、验收以本单为单真值。

---

## 2. 简述缘由

### 2.1 `popup_closed` 和 `popup_blocked` 不是一回事

当前 transport 层里：

- `popup_blocked` 的正确定义是：`window.open(...)` 返回 `null`
- `popup_closed` 的正确定义是：popup 曾经存在，但在协议完成前被关闭、刷新或失联

这两个状态在技术上和产品上都不是一回事。

对锁屏页来说，`popup_closed` 往往只是：

1. 用户手动把 popup 关了；
2. popup 正在锁屏 / 解锁页；
3. 用户这次不想继续，稍后再点一次；
4. 下次点击本来就会重新开一个 popup。

因此，在**锁屏页**把这类情况当成一条需要挂出来的错误，会放大噪音，还会误导用户以为浏览器拦截了弹窗。

### 2.2 “忘掉当前 session”没有提供独立价值，只会增加按钮数量

在锁屏页，有本地 `sessionId` 时，用户真正想做的事通常只有两类：

1. 继续用当前 session：点“恢复 session”
2. 不想继续当前 session，改走新的 key / 新的 provider / 新的登录流程：点“重新登录”

“忘掉当前 session”只是第二类目标前面的一个中间动作。

把这个中间动作单独做成按钮的问题是：

- 按钮数量变多；
- 用户要先理解“忘掉”再理解“登录”；
- 实际目标明明是“换一个登录结果”，却被拆成两步；
- 失败路径也更差：如果先清 session，再登录失败，连原来的恢复入口都没了。

### 2.3 重新登录不应先清旧 session

本项目优先简单系统，不做没必要的中间状态。

因此更合理的收口是：

1. 有本地 session 时，直接允许“重新登录”
2. 重新登录成功后，用新 session 覆盖旧 session
3. 重新登录失败时，旧 session 继续保留，用户仍可点“恢复 session”

这样做的好处是：

- 行为简单；
- 没有“先清后失败”的空窗态；
- 不需要额外做“忘掉 session”这一层状态编排；
- 更符合“系统优先简单、失败就失败、不要为了边缘业务补复杂度”的项目原则。

---

## 3. 最终目标

本次完成后，系统必须达到以下状态：

1. 锁屏页只有两类主入口：
   - 主按钮：`登录` 或 `重新登录`
   - 次按钮：`恢复 session`（仅在存在可恢复 session 且 origin 匹配时显示）
2. 锁屏页不再显示“忘掉当前 session”按钮。
3. 有本地 `sessionId` 时，主按钮文案固定为“重新登录”。
4. 没有本地 `sessionId` 时，主按钮文案固定为“登录”。
5. 锁屏页中的 `popup_closed` 不再展示成错误提示。
6. 真正的 `popup_blocked` 仍然要明确提示给用户。
7. 点击“重新登录”时，不预先清本地 session。
8. “重新登录”成功后覆盖旧 session；失败后保留旧 session。
9. `popupSessionClient` 对 `popup_blocked = window.open(...) === null` 的定义不被改坏。
10. README、注释、i18n 文案与实际 UI 行为一致，不再保留“忘掉当前 session”这套旧入口叙事。

---

## 4. 怎么做

## 4.1 锁屏页主按钮文案只看“是否存在本地 session”

锁屏页主按钮文案不再由 `mode` 决定，而是由**当前是否存在本地 `sessionId`** 决定：

- 无本地 session：显示“登录”
- 有本地 session：显示“重新登录”

这里故意不看 `resumeFailed`。

原因：

- `resumeFailed` 只代表“上一次自动/手动恢复失败了”；
- 不代表“当前页面上不存在可理解为旧 session 的语义”；
- 对用户来说，“当前设备上记住过一个 session，现在我选择放弃它并重新走登录”这个心智，比“先忘掉再登录”更直接。

## 4.2 `popup_closed` 的产品收口发生在 App 层，不发生在 transport 层

本次不改 `src/lib/popupSessionClient.ts` 对 `popup_blocked` / `popup_closed` 的底层判定逻辑。

原因：

- transport 层目前的定义是合理的；
- 错的不是底层判定，而是上层在锁屏页把 `popup_closed` 当成要展示给用户的错误；
- 若为了修锁屏页体验去改 transport 判定，会把底层真值弄脏。

因此本次固定：

1. transport 继续抛真实的 `ProtocolTransportError`
2. `App.tsx` 在**锁屏态 login/resume 流程**里，对 `popup_closed` 做静默收口
3. `popup_blocked` 仍正常展示错误
4. 其它 transport 错误保持现有策略，除非它们也被明确判定为锁屏页噪音

## 4.3 “重新登录”不等于“先忘掉再登录”

点击“重新登录”时，流程固定为：

1. 保留当前本地 session 记录
2. 直接发起一次新的 `connect.login`
3. 若成功，写入新 session，覆盖旧记录
4. 若失败，旧 session 不动，锁屏页仍可继续显示“恢复 session”

这条规则是本单的核心边界，不能被实现时偷换成：

- 点“重新登录”先 `clearConnectSession()`
- 或者点“重新登录”时偷偷复用旧 sessionId

前者会制造无谓的空窗态，后者会把“重新登录”和“恢复 session”重新混在一起。

## 4.4 “恢复 session”按钮只在 session 真可恢复时显示

锁屏页上的“恢复 session”按钮继续遵守现有约束：

1. 必须存在本地 session
2. 当前输入归一化后的 `targetOrigin` 必须与本地 session 记录一致
3. 当前不处于 `resumeFailed` 的永久失效态

本次不把“恢复 session”扩展成跨 origin 恢复，也不自动篡改用户输入。

## 4.5 文案与 README 一次切干净

需要把当前产品叙事统一切到下面这套：

- 无 session：登录
- 有 session：恢复 session 或重新登录
- 锁屏页没有“忘掉当前 session”
- popup 被关闭不等于 popup 被浏览器拦截

这不只是改按钮文案，还包括：

1. 锁屏页注释
2. `App.tsx` 注释
3. README 对锁屏入口的描述
4. i18n 三语文案

---

## 5. 特殊情况提前定义

## 5.1 锁屏页发起 login，popup 被用户手动关闭

处理：

1. 不显示“popup 被浏览器拦截”
2. 不显示“popup 在协议完成前被关闭”横幅
3. 不清本地 session
4. 页面停留在当前锁屏页
5. 用户下次再点主按钮时重新开 popup

设计缘由：

- 这是一次未完成尝试，不是系统性错误；
- 锁屏页本来就没有需要保活的工作区状态；
- 没必要把这种情况升级为用户可见错误。

## 5.2 锁屏页发起 resume，popup 被用户手动关闭

处理：

1. 不显示错误横幅
2. 不清本地 session
3. 继续保留“恢复 session”按钮
4. 主按钮仍按“有 session”显示为“重新登录”

设计缘由：

- 这属于临时中断，不代表 session 永久失效；
- 用户可以稍后继续 resume，也可以直接重新登录。

## 5.3 浏览器真的拦截 popup

处理：

1. 只有 `window.open(...) === null` 才算 `popup_blocked`
2. 仍然展示“popup 被浏览器拦截”
3. 不吞掉这类错误

设计缘由：

- 这是用户必须知道并处理的真实问题；
- 不能因为要压掉 `popup_closed` 噪音，就连真实开窗失败也一起吞掉。

## 5.4 有本地 session，但用户把 `targetOrigin` 改成了另一个地址

处理：

1. 若当前输入与本地 session 的 `targetOrigin` 不一致，则不显示“恢复 session”
2. 主按钮仍显示“重新登录”
3. 点击“重新登录”时，使用当前输入的 origin 发起新的 `connect.login`
4. 在新的 login 成功前，不主动清掉旧 session

设计缘由：

- 改 origin 本质上就是要走新的登录流程；
- 没必要逼用户先做一次“忘掉”；
- 保留旧 session 直到新登录成功，失败时也还有退路。

## 5.5 本地 session 已失效，`resume` 收到永久失效信号

处理：

1. 仍按现有逻辑清本地 session
2. 进入 `resumeFailed` 语义
3. 此时主按钮因“已无 session”显示为“登录”
4. 不显示“恢复 session”按钮

设计缘由：

- 这是 session 真失效，不是临时中断；
- 必须与“只是 popup 关了”严格区分。

## 5.6 用户只是想丢掉本地 session，但暂时不想重新登录

处理：

1. 锁屏页不提供独立“忘掉当前 session”按钮
2. 不为了这个低频诉求再增加一个入口
3. 若未来产品强需求要求“纯清理、不登录”，必须单独开新施工单再讨论

设计缘由：

- 当前目标是收口复杂度，不是补齐所有低频控制面；
- 这个诉求不值得为锁屏页增加一个长期按钮。

---

## 6. 不能怎么做

1. 不能把 `popup_closed` 直接映射成 `popup_blocked`。
2. 不能为了压掉锁屏页噪音，把 transport 层里真实的 `popup_blocked` 判定改掉。
3. 不能保留“忘掉当前 session”按钮，再额外增加“重新登录”按钮。
4. 不能点“重新登录”时先清本地 session。
5. 不能把“重新登录”偷偷实现成 `connect.resume`。
6. 不能在 `popup_closed` 时自动把 session 当作永久失效并清掉。
7. 不能因为锁屏页不报错，就把已登录工作区中的真实 transport 问题也一并吞掉。
8. 不能在 README、注释、i18n 中继续保留“有 session 时两个动作是恢复 + 忘掉”的旧叙事。
9. 不能引入新的本地存储结构、迁移脚本、双读双写兼容。
10. 不能把这次施工拆成“先改按钮文案，后面再慢慢改错误语义”的分步兼容。

---

## 7. 文件级一次性迭代施工单

## 7.1 `README.md`

要做：

1. 把锁屏页描述从“有本地 session 时提供恢复 session + 忘掉当前 session 两个入口”改成“恢复 session + 重新登录”。
2. 明确写出：
   - `popup_closed` 在锁屏页不算错误
   - `popup_blocked` 只指浏览器未允许开窗
3. 若 README 中有“重新登录前先忘掉 session”的暗示性表述，必须删除。

## 7.2 `src/App.tsx`

要做：

1. 在锁屏态的 `handleLogin` / `performResume` 错误收口里，单独处理 `popup_closed`：
   - 不写 `lastError`
   - 不清本地 session
   - 不把它翻译成用户可见错误横幅
2. 保持 `popup_blocked` 仍走现有错误映射。
3. 锁屏页主按钮文案的来源改成“是否存在 stored session”，而不是固定字典 key。
4. 删除锁屏页 `onForget` 这一套接线。
5. 同步更新相关中文注释，明确“重新登录不会预清本地 session”。

实现建议：

- 可以新增一个只服务锁屏态的辅助判断，例如“当前错误是否应在锁屏页静默吞掉”；
- 但不要把它扩展成新的通用 transport 框架。

## 7.3 `src/components/LockScreen.tsx`

要做：

1. 删除 `onForget` prop 及其按钮渲染。
2. 增加或接收一个明确的主按钮文案来源：
   - `登录`
   - `重新登录`
3. 保留“恢复 session”按钮，但只在现有可恢复条件满足时显示。
4. 同步更新组件中文注释，删除“忘掉当前 session”相关描述。

实现建议：

- 不要把“是否显示重新登录”重新做成新的局部状态；
- 直接由上层基于 `storedSession` 真值下发即可。

## 7.4 `src/i18n/messages.ts`

要做：

1. 为锁屏页补齐“重新登录”文案 key。
2. 删除“忘掉当前 session”文案 key，或在确认无引用后完全移除。
3. 同步三语：
   - 中文
   - 英文
   - 日文
4. 若锁屏页相关提示里仍有把 `popup_closed` 当错误展示的旧描述，一并改掉。

## 7.5 `src/i18n/types.ts`

要做：

1. 与 `messages.ts` 同步增删 key。
2. 不保留失去引用的 `lock.action.forget*` 类型声明。

## 7.6 `src/lib/popupSessionClient.ts`

要做：

1. 默认不改行为。
2. 若实现阶段发现注释会误导后续开发者把 `popup_closed` 理解成 `popup_blocked`，只允许补充注释，不允许改 transport 判定逻辑。

## 7.7 当前活跃施工单与注释残留

要做：

1. 检查当前活跃产品叙事是否仍写着“忘掉当前 session”是锁屏入口之一。
2. 若实现代码、README、当前活跃注释与本单冲突，必须同步清理。
3. 历史归档施工单可保留旧说法，但当前生效文档不允许继续矛盾。

---

## 8. 实施顺序

一次性硬切换，固定按下面顺序执行：

1. 先改本施工单
2. 再改 `src/i18n/messages.ts` 与 `src/i18n/types.ts`
3. 再改 `src/components/LockScreen.tsx`
4. 再改 `src/App.tsx`
5. 再改 `README.md`
6. 最后扫 `popupSessionClient.ts` / 注释 / 当前活跃文档残留
7. 跑 `npm run typecheck`
8. 必要时跑 `npm run build`

不允许跳成“先随手把按钮删了，后面再补错误语义”。

---

## 9. 最终验收清单

### 9.1 产品行为

1. 无本地 session 时，锁屏主按钮显示“登录”。
2. 有本地 session 时，锁屏主按钮显示“重新登录”。
3. 锁屏页不再出现“忘掉当前 session”按钮。
4. 有本地 session 且 origin 匹配时，仍能看到“恢复 session”按钮。
5. 改掉 origin 后，“恢复 session”按钮消失，但主按钮仍是“重新登录”。

### 9.2 错误语义

1. 锁屏页手动关闭 popup，不出现“popup 被浏览器拦截”。
2. 锁屏页手动关闭 popup，不出现“popup 在协议完成前被关闭”错误横幅。
3. 浏览器真实拦截开窗时，仍显示“popup 被浏览器拦截”。
4. `window.open(...) === null` 仍是 `popup_blocked` 的唯一真值。
5. session 永久失效时，仍按既有逻辑清本地并回真正登录入口。

### 9.3 状态与数据边界

1. 点击“重新登录”前，不会先清本地 session。
2. “重新登录”失败后，旧 session 仍保留。
3. “重新登录”成功后，新 session 覆盖旧 session。
4. 本次没有新增 localStorage shape、迁移逻辑或兼容层。

### 9.4 文档与文案一致性

1. README 已改成“恢复 session + 重新登录”叙事。
2. 三语锁屏文案中已不存在“忘掉当前 session”。
3. `App.tsx`、`LockScreen.tsx` 注释与真实行为一致。
4. 当前有效产品文档中，不再把锁屏页 `popup_closed` 说成 `popup_blocked`。

### 9.5 质量验证

1. `npm run typecheck` 通过。
2. 若改动影响构建路径，`npm run build` 通过。
3. 在 `README.md`、`src/App.tsx`、`src/components/LockScreen.tsx`、`src/i18n/messages.ts`、`src/i18n/types.ts` 中搜索 `忘掉当前 session`，不应再有当前生效路径残留。
4. 在当前有效实现与文档中搜索 `popup 被浏览器拦截` 的使用位置，应只对应真实 `popup_blocked` 路径，不应拿来描述 `popup_closed`。

---

## 10. 完成定义

满足以下条件，才算本单完成：

1. 锁屏页入口已从“登录 + 忘掉 session”收口为“恢复 session + 登录/重新登录”。
2. 锁屏页里的 `popup_closed` 已从用户可见错误降级为一次可重试的静默结束。
3. transport 真值没有被改坏，真实 `popup_blocked` 仍能准确暴露。
4. 重新登录路径没有引入“先清再登”的额外复杂度。
5. 代码、注释、README、i18n 对以上边界表述一致。

做到这五条，这次硬切换才算真正收干净。
