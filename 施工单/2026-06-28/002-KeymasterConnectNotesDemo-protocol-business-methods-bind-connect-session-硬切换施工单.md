# 002 KeymasterConnectNotesDemo 跟进 Protocol 业务方法绑定 Connect Session 硬切换一次性施工单

## 参考文档与依赖项目

本次施工、联调、验收以下列文档与代码为准：

- 本仓库：
  - `README.md`
  - `src/lib/protocol.ts`
  - `src/lib/keymaster.ts`
  - `src/App.tsx`
  - `src/components/LockScreen.tsx`
  - `src/i18n/messages.ts`
  - `src/i18n/types.ts`
- 依赖项目：
  - `/home/david/Workspaces/keymaster.cc/施工单/2026-06-28/001-connect-session-bound-key-and-popup-unlock-runtime-hard-switch.md`
  - `/home/david/Workspaces/keymaster.cc/施工单/2026-06-28/002-protocol-business-methods-bind-connect-session-hard-switch.md`

发生冲突时：

1. Keymaster 协议真值以上游 `002-protocol-business-methods-bind-connect-session-hard-switch.md` 为准。
2. 本单只定义 notes demo 作为 caller 如何同步这次协议收口，不扩展为 provider 侧实现施工单。
3. 本单关于“本 demo 实际接入哪些方法、哪些只保留最小兼容壳”的定义，优先于旧 README、旧注释、旧施工单表述。
4. 后续若再改 notes demo 的协议边界，必须先改本单，再改代码与文档，不允许只改实现。

---

## 1. 本单定位

本单不是继续在现有 `001` 结果上修几个文案，也不是给本 demo 引入一套“新旧 `identity.get` 双模型兼容层”。

本单定义一次**硬切换**，目标是让本 demo 对上游 `002` 的理解彻底收口到下面这组边界：

- `connectSessionId` = 应用会话真值
- `ownerPublicKeyHex` = owner 唯一真值
- `connect.login / connect.resume / connect.logout` = 会话生命周期方法
- `identity.get / cipher.*` = 会话内业务方法
- transport 顶层报文 `ready / request / result / closing / cancel` **不**带 `connectSessionId`

结合本 demo 当前处境，本次施工范围固定为：

1. 同步本地最小协议壳对 `identity.get` 的新 contract 认知；
2. 清掉 README / i18n / 注释里仍残留的“本 demo 实际调用 `identity.get` 作为登录能力”旧叙事；
3. 保持当前工作主链继续只走 `connect.* + cipher.*`；
4. 不把 `intent.sign` / `p2pkh.transfer` / `feepool.*` 硬接进这个 demo。

也就是说，本次不是“扩功能”，而是“收口真值、消除错误叙事、避免本地协议壳继续误导后续开发”。

---

## 2. 简述缘由

### 2.1 当前主链已经切到 session 真值，但本地协议壳和文案还残留旧世界

当前代码主链已经满足下面这些关键点：

- 登录只走 `connect.login`
- 恢复只走 `connect.resume`
- 退出只走 `connect.logout`
- `cipher.encrypt` / `cipher.decrypt` 都显式带 `connectSessionId`

但本仓库仍残留下面这些旧边界：

- `src/lib/protocol.ts` 里的 `IdentityGetParams` 还没有 `connectSessionId`
- `src/lib/keymaster.ts` 里的 `buildIdentityGetRequest` 还是旧签名
- `README.md` 与 i18n 文案里仍有“demo 实际调用 `identity.get`”的旧表述

这会造成一个危险状态：

- 真实业务主链按 session 模型运行；
- 本地协议定义和产品文案却还在向后来的开发者暗示旧模型；
- 最终把错误重新引回仓库。

### 2.2 上游 `002` 的重点不是多一个字段，而是统一所有业务方法的归属语义

上游这次硬切换的重点不是“给 `identity.get` 顺手补个 `connectSessionId`”，而是：

- 所有外部业务方法都属于某个 `connectSessionId`
- owner 单真值只认 `ownerPublicKeyHex`
- 不允许任何路径 fallback 到当前全局 `active key`

如果本 demo 不跟进，仓库里就会继续存在两套互相打架的协议认知：

- 业务主链：`connectSessionId` 是真值
- 本地兼容壳与文案：`identity.get` 仿佛还可脱离 session 独立成立

这正是后面最容易把人带回旧坑的地方。

### 2.3 本项目应优先选“简单、干净、一次切断”，而不是兼容旧说法

按本项目一贯原则，这里不应该为了照顾旧表述再引入：

- 新旧 `identity.get` 双签名兼容
- “缺 `connectSessionId` 就当旧协议继续跑”的兜底
- README 里一边写 session 登录，一边又写“实际调用 `identity.get`”

这些兼容都会增加系统复杂度，但不会给当前 demo 带来真实收益。

本次最合理的方案是：

- 一次性把错误叙事切掉；
- 一次性把本地协议壳改成 session-bound 认知；
- 当前不接入的业务方法就明确“不接”，而不是半接半不接。

---

## 3. 最终目标

本次完成后，系统必须达到以下状态：

1. 本 demo 的登录真值仍然是 `connectSessionId`，不是 `identity.get`。
2. 本 demo 的 owner 真值仍然是 `ownerPublicKeyHex`，不是任何内部 key id。
3. `identity.get` 若继续保留在本地最小协议壳中，其请求参数必须显式包含 `connectSessionId`。
4. `identity.get` 在本仓库中的定位固定为“会话内身份断言能力”，不再被任何文档、注释、UI 文案描述为登录入口。
5. README、锁屏能力说明、产品描述不再声称“本 demo 实际调用 `identity.get`”。
6. `App.tsx` 的既有工作主链保持不变，仍然只实际使用 `connect.* + cipher.*`。
7. 本仓库内不存在“缺 `connectSessionId` 的业务方法也能成立”的暗示性定义。
8. 本仓库内不存在 `ownerKeyId` 作为 owner 身份参与协议叙事的路径。
9. 这次迭代不引入新的本地存储 shape，不引入迁移脚本，不引入双读双写兼容。

---

## 4. 怎么做

## 4.1 协议认知收口

本地最小协议壳需要同步到上游 `002` 的边界，但只同步本 demo 真正持有的那一小部分。

具体做法：

1. 保留 `connect.login / connect.resume / connect.logout / cipher.encrypt / cipher.decrypt` 的现有定义。
2. 保留 `identity.get` 这一个可选业务方法壳，但把它改成**session 内能力**：
   - `IdentityGetParams` 增加 `connectSessionId`
   - 相关中文注释改成“subject 来自 session 绑定 owner”
   - 不再把它描述成“caller 登录入口”
3. 不新增 `intent.sign` / `p2pkh.transfer` / `feepool.*` 到本 demo 的本地协议壳。

设计缘由：

- 本 demo 当前不接这些能力，强行加进来只会扩大状态面；
- 但 `identity.get` 已经存在于本地协议壳中，彻底删掉反而会让本仓库对上游协议的对齐更差；
- 因此最佳平衡是：**保留，但改对**。

## 4.2 业务收口保持最小

本次不改 `App.tsx` 的主流程，不为了“协议更完整”去新增额外业务入口。

固定为：

- 登录：`connect.login`
- 恢复：`connect.resume`
- 退出：`connect.logout`
- 打开 / 保存 note：`cipher.decrypt` / `cipher.encrypt`

`identity.get` 即便在本地 helper 里保留，也不新增页面入口、不新增按钮、不新增状态机分支。

设计缘由：

- 当前 demo 的目标是证明“session 绑定下的加密笔记工作区”；
- 不是展示全部协议能力；
- 不应为了协议文档同步把 UI 和状态机重新拉复杂。

## 4.3 文档与文案一次切干净

需要把下面这些旧叙事统一删掉或改写：

- “本 demo 实际调用 `identity.get` 与 `cipher.*`”
- “identity.get 是登录相关能力”
- “锁屏能力说明里包含 `identity.get` 登录语义”

改成下面这套最终表述：

- 本 demo 实际调用 `connect.* + cipher.*`
- `identity.get` 在协议上属于会话内业务方法，但本 demo 当前不把它暴露为产品路径
- 所有持续登录语义都由 `connectSessionId` 承担

## 4.4 注释也必须同步，不允许代码真值和注释真值分裂

这次不只是改类型和 README。

凡是仍在向读代码的人暗示下面任一旧认知的注释，都必须同步处理：

- `identity.get` 仍像登录入口
- 本 demo 仍实际依赖 `identity.get`
- 业务方法可以不带 `connectSessionId`

原则：

- 只改与本单直接相关的注释；
- 不顺手重写无关注释；
- 但凡保留下来的注释，必须与代码真实边界一致。

---

## 5. 不能怎么做

1. 不能把这次施工做成“先改 README，后面再慢慢改类型”的分步兼容。
2. 不能保留旧 `IdentityGetParams`，再额外加一个“新版本 helper”并存。
3. 不能让 `buildIdentityGetRequest` 在缺少 `connectSessionId` 时继续偷偷构造旧请求。
4. 不能在 README 或 i18n 里继续说“demo 实际调用 `identity.get`”。
5. 不能为了“看起来协议更完整”把 `intent.sign` / `p2pkh.transfer` / `feepool.*` 直接塞进本 demo。
6. 不能新增“默认当前 session”语义；缺 `connectSessionId` 的业务请求就是不成立。
7. 不能把 transport 报文描述成携带业务 session。
8. 不能引入 `ownerKeyId` 兼容说法、兼容字段或兼容注释。
9. 不能改成双模型文档：一边写 `connect.login` 是登录入口，另一边又写 `identity.get` 也是登录入口。
10. 不能为了兼容旧文案而接受仓库继续自相矛盾。

---

## 6. 特殊情况提前定义

## 6.1 provider 已升级到上游 `002`，本 demo 正常工作

处理：

1. `connect.* + cipher.*` 主链行为不变；
2. 本次改动主要体现为本地协议壳更正确、文档与文案更一致；
3. 若未来需要接入会话内 `identity.get`，本地 helper 已是正确 contract。

## 6.2 provider 尚未升级 `identity.get(connectSessionId)`，但本 demo 主链只走 `connect.* + cipher.*`

处理：

1. 不阻塞本 demo 当前主链；
2. 本地不新增任何“旧 `identity.get` 降级调用”兼容；
3. 若有人未来尝试调用本地 `buildIdentityGetRequest`，应按新 contract 构造请求；
4. 对不上游旧实现的联调失败，视为 provider 尚未升级，不在本 demo 内做补丁。

设计缘由：

- 当前 demo 不实际走 `identity.get`；
- 为一个未使用路径引入双协议兼容，没有收益，只有复杂度。

## 6.3 浏览器里仍留有 `001` 版本的 connect session 记录

处理：

1. 继续沿用现有 `StoredConnectSessionRecord`；
2. 不新增 localStorage 迁移；
3. 只要记录 shape 合法，就按现有 `resume` 逻辑处理；
4. 若服务端判定 session 无效，仍按既有逻辑清本地并回登录壳。

设计缘由：

- 本次改动不改变本 demo 的本地 session record shape；
- 没必要为了这次文档/协议收口再引入本地迁移逻辑。

## 6.4 README、i18n、类型定义之间出现冲突

处理：

1. 以本单定义为准；
2. 具体落地时要求三者一致；
3. 任何一个地方仍残留旧叙事，都视为未完成施工。

## 6.5 后续有人想把 `identity.get` 再当作登录入口接回页面

处理：

1. 本次明确禁止；
2. 若未来真要改设计，必须先改施工单；
3. 未改施工单前，直接改代码视为破坏本次硬切换边界。

---

## 7. 文件级一次性迭代施工单

## 7.1 `README.md`

要做：

1. 把项目描述从“真实调用 `identity.get` 与 `cipher.*`”改成“真实调用 `connect.*` 与 `cipher.*`”。
2. 明确 `identity.get` 不再是本 demo 的登录路径。
3. 若 README 中还列出了本地协议壳包含 `identity.get`，必须把其定位改成“可选的会话内身份断言能力”，不是实际主流程能力。
4. 删除或改写任何会让读者误以为本 demo 登录依赖 `identity.get` 的表述。

## 7.2 `src/lib/protocol.ts`

要做：

1. 给 `IdentityGetParams` 增加 `connectSessionId: string`。
2. 更新 `identity.get` 相关中文注释：
   - 不再描述为登录入口；
   - 明确属于会话内业务方法；
   - 明确其 owner 取自 session 绑定 owner。
3. 保持 `connect.*` 与 `cipher.*` 的既有 contract 不变。
4. 不新增本 demo 未使用的方法定义。

## 7.3 `src/lib/keymaster.ts`

要做：

1. 更新 `buildIdentityGetRequest` 的入参，要求显式传入 `connectSessionId`。
2. 构造出的 `IdentityGetParams` 必须带 `connectSessionId`。
3. 更新 `identity.get` 相关中文注释：
   - 改成“旧 helper 保留，但定位是会话内身份断言能力”
   - 不再出现“本 demo 仍会调用它做登录”的表述
4. 保持 `connect.*` 与 `cipher.*` helper 的既有行为不变。

## 7.4 `src/i18n/messages.ts`

要做：

1. 把应用描述文案从“实际调用 `identity.get` 与 `cipher.*`”改掉。
2. 检查三语文案，统一改成“基于 connect session 与 cipher.* 的加密笔记工作区”。
3. 删除或改写任何把 `identity.get` 作为锁屏能力、登录能力、主流程能力的旧文案。
4. 保证三语语义一致，不允许只改中文。

## 7.5 `src/i18n/types.ts`

要做：

1. 若 `messages.ts` 中删除了 `identity.get` 相关展示 key，这里同步删除对应类型声明。
2. 若仅改文案、不删 key，则保持与 `messages.ts` 完全一致。
3. 以“不要留下无引用旧 key”为优先。

实现建议：

- 先检查 `LockScreen.tsx`、`ConnectStatus.tsx` 是否仍使用这些 key；
- 若无使用，优先删 key，而不是保留废弃字典项。

## 7.6 `src/App.tsx`

要做：

1. 仅在存在与本单冲突的中文注释时同步收口。
2. 不改登录 / 恢复 / 退出 / note 打开保存的现有业务逻辑。
3. 不新增 `identity.get` 页面入口。

## 7.7 `src/components/LockScreen.tsx`

要做：

1. 检查锁屏能力说明是否仍展示 `identity.get`。
2. 若已不展示，则无需功能改动。
3. 若仍展示，必须删掉或改成不误导用户的表述。

---

## 8. 实施顺序

一次性硬切换，固定按下面顺序执行：

1. 先改本地施工单
2. 再改 `README.md`
3. 再改 `src/lib/protocol.ts`
4. 再改 `src/lib/keymaster.ts`
5. 再改 `src/i18n/messages.ts` 与 `src/i18n/types.ts`
6. 最后扫一遍 `App.tsx` / `LockScreen.tsx` / 相关注释，确认没有残留旧叙事
7. 跑 `npm run typecheck`
8. 必要时跑 `npm run build`

不允许跳成“先顺手改代码，最后再想文档怎么补”。

---

## 9. 最终验收清单

### 9.1 协议与代码边界

1. `IdentityGetParams` 已显式包含 `connectSessionId`。
2. `buildIdentityGetRequest` 已要求调用方传入 `connectSessionId`。
3. `buildIdentityGetRequest` 生成的 params 已带上 `connectSessionId`。
4. `connect.login / connect.resume / connect.logout / cipher.*` 的既有 contract 未被破坏。
5. 本仓库内不存在“缺 `connectSessionId` 的 `identity.get` 仍可成立”的定义。

### 9.2 产品叙事与文档

1. README 不再声称“本 demo 实际调用 `identity.get`”。
2. README 对登录路径的描述只有 `connect.login / connect.resume / connect.logout`。
3. README 若提到 `identity.get`，其定位明确为“会话内身份断言能力”，不是登录入口。
4. 三语应用描述文案都不再把 `identity.get` 写成主流程能力。
5. 锁屏能力说明与实际 UI 一致，没有残留 `identity.get` 登录语义。

### 9.3 范围控制

1. 本次没有把 `intent.sign` / `p2pkh.transfer` / `feepool.*` 新增进本 demo。
2. 本次没有修改 `App.tsx` 的既有 session 工作主链。
3. 本次没有引入本地存储迁移、双读双写、旧协议降级兼容。
4. 本次没有引入 `ownerKeyId` 相关字段、注释或文案。

### 9.4 质量验证

1. `npm run typecheck` 通过。
2. 若改动影响构建路径，`npm run build` 通过。
3. 在**实现代码、`README.md`、当前有效的产品文案**（`src/i18n/messages.ts` 三语字典 + 锁屏 / 页头实际渲染文案）中搜索 `identity.get`，不应再出现把它描述为登录入口或当前主流程能力的残留表述。
4. 在**实现代码、`README.md`、当前有效的产品文案、当前活跃施工单**（不含已被显式标注为 archived / superseded 的历史施工单）中搜索 `ownerKeyId`，不应出现该字样作为 owner 身份参与协议叙事的残留。

> **关于 9.4.3 / 9.4.4 的搜索口径补充**
>
> 上面两条搜索的"应清零范围"是 **当前生效的实现与文案**，**不**包括：
> - 已显式标注为「已被取代（archived）」的施工单（即顶部含 `> **本施工单已被取代（archived）**` 引用块的历史施工单）；
> - 当前活跃施工单中**显式说明为"旧模型条目 / 历史对照 / 不再成立"** 的引用条目（如 2026-06-28/001 第 1 章旧模型列表）；
> - 本施工单自身在条款定义、边界讨论、废弃清单中提到 `identity.get` / `ownerKeyId` 的位置（定义条款本身必须提到这些词才能形成边界约束）。
>
> 这一约束与本单第 1 章定位一致：旧的失败叙事必须清掉，但**历史归档与定义性边界**不应被改写。

---

## 10. 完成定义

满足以下条件，才算本单完成：

1. 本地最小协议壳已与上游 `002` 在本 demo 关心的范围内对齐。
2. 本仓库文档、文案、类型、helper 对“登录真值 = `connectSessionId`”表述一致。
3. 本仓库文档、文案、类型、helper 对“`identity.get` 是会话内业务方法，不是登录入口”表述一致。
4. 本 demo 现有工作主链未被扩大、未被复杂化、未被重新引回旧模型。

做到这四条，这次硬切换才算真正收干净。
