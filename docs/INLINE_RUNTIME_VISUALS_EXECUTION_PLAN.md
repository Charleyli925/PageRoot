# PageRoot 固定视觉槽位与编辑态自动原位显示执行规划

- 状态：**规划完成；生产实现尚未获授权**
- 规划日期：2026-08-12
- 规划基线：`main@8fffb0529239b537f25fc0463921325babdf167f`
- 产品依据：[固定视觉槽位与编辑态自动原位显示 PRD](INLINE_RUNTIME_VISUALS_PRD.md)
- 当前生产合同：[Architecture](ARCHITECTURE.md)、[Architecture contract](ARCHITECTURE_CONTRACT.md)、[State ownership](STATE_OWNERSHIP.md)、[Security model](SECURITY_MODEL.md)、[Runtime visual contract](RUNTIME_VISUAL_CONTRACT.md)

> 本文是可审查的串行实施方案，不是开始生产实现、Ready、合并或发布的授权。
> 在 Phase 0 形成可复现实证并获得 Go 结论前，现行行为保持不变：Edit 脚本禁用且
> 不拥有运行视觉，Preview 执行作者脚本，Review 独占现有有界截图补充。

## 1. 执行结论

本项目不能从“把运行页叠上去”直接开工。首先要证明四件最容易把方案拖回旧截图
复杂度的问题可以同时被简单解决：

1. 作者脚本可以在不冻结 Edit 的故障域中被硬终止；
2. 单个运行页可以只显示多个固定槽位，而不复制 DOM、像素或每图创建运行环境；
3. 槽位身份和矩形由可信代码在作者脚本运行前绑定，作者脚本不能伪造；
4. 滚动、缩放、DPR、字体、资源延迟和源码 generation 变化时，系统能够准确显示或
   准确隐藏，而不是靠缓存旧图掩盖问题。

因此采用一项可行性阶段和七个串行 PR：

| 阶段 | 交付 | 是否改变用户行为 |
| --- | --- | --- |
| Phase 0 | 独立技术探针与 Go/No-go 报告 | 否，不进入生产路径 |
| PR-1 | Profile v0.1、静态 Validator 与诊断合同 | 否 |
| PR-2 | 单运行页 owner、一次性 Session 与最小安全协议 | 否，feature flag 强制关闭 |
| PR-3 | 仅 `profile-fixed` 的固定槽位原位显示 | 是，但只在内部 flag/canary |
| PR-4 | Edit 生命周期、源码失效、Selection 与 PageViewContext 收口 | 是，仍在 canary |
| PR-5 | 机械、窄范围的 `legacy-fixed` 兼容 | 是，可独立关闭 |
| PR-6 | 精确离线资源映射（有数据且另行授权时） | 条件项，可跳过 |
| PR-7 | 默认启用决策、规范同步、硬门禁和灰度发布 | 取决于验收结论 |

Phase 0 的任何 No-go 都意味着停止运行视觉实现，转而只交付 Profile/Validator 和内容
迁移建议。后续 PR 不得用扩大容差、添加页面特判或恢复截图来“救活”这个方向。

## 2. 为什么先做可行性门禁

历史 Edit Runtime Snapshot 的复杂度并不主要来自 PNG 本身，而来自它要求系统同时
回答：什么时候捕获、裁哪一块、旧结果能否继续显示、DPR 如何换算、迟到结果归谁、
窗口何时销毁、缓存如何回收、源码变化后如何失效。若新的实时原位方案也需要双会话、
旧视觉保留、复杂裁剪猜测和持续同步，它只是把截图复杂度换了一个载体。

本规划把“简单”定义为可以机械检查的不变量，而不是代码行数较少：

- 每个文档至多一个运行页；
- 视觉结果缓存数量恒为 0；
- 运行页到 Edit 的 DOM/HTML/像素传输数量恒为 0；
- 只有固定源码槽位可以准入；
- 一次只允许当前 generation 可见；
- 不确定时隐藏视觉，静态 Edit 立即可用；
- 生命周期只有创建、运行、隐藏和销毁，不存在恢复旧视觉；
- 保存、切换、提交、关闭和 History 不等待视觉运行页 drain。

只要实现需要打破其中任一条，就必须返回产品决策，而不是在实现层局部加分支。

## 3. 当前事实与迁移边界

### 3.1 当前生产事实

- `HtmlCanvasEditor` 是脚本禁用的源码编辑表面；
- `HtmlInteractionPreview` 是完整交互预览表面；
- `DocumentSession` 独占当前源码字节、Hash、编辑 revision 和 Canvas generation；
- `PageViewContext` 是当前唯一允许跨表面同步的有界页面显示状态；
- Edit 不请求 Review runtime snapshot，也不持有 bitmap/cache/projection；
- Review 的 `RuntimeSnapshotOwner`、PNG 合同和缓存不能被复用到 Edit；
- `workbench.tsx` 是 composition root，不得成为新的生命周期 owner；
- 任何新 owner、Port、协议、资源权限和 mutable fact 都必须进入现行合同与测试影响图。

### 3.2 绝不能迁移回来的历史责任

- `capture -> encode -> IPC -> cache -> Blob -> img`；
- 旧图等待新图、stale-while-revalidate 或双 generation 可见；
- 由运行时测量并推动 Edit 正文高度；
- 运行 DOM 到源码 DOM 的任意持续 diff 或复制；
- 按图表库版本注入适配器；
- 运行时子元素的 TargetRef、评论 ID 或持久语义身份；
- 把视觉运行失败升级为保存/关闭失败。

### 3.3 实现范围

首发只针对桌面应用的当前 Edit 页面。以下保持现状：

- Browser/弱能力模式；
- History 页面；
- AI Review before/after 页面；
- Preview 完整交互；
- Request、Attempt、Version、Draft 和 SourceHistory 持久化结构。

## 4. 目标架构与依赖方向

建议的概念依赖如下；最终文件名可在实现前微调，但 owner 和方向不能漂移：

```text
Source HTML + Source Hash + Canvas generation
                 |
                 v
        InlineVisualProfileValidator
        (pure, static, script-disabled)
                 |
                 v
        InlineVisualSession (renderer)
        one disposable state owner
          |                    |
          v                    v
 CanvasInlineVisualPort   InlineVisualRuntimePort
 (rect/viewport only)     (start/stop/report only)
          |                    |
          v                    v
 HtmlInlineRuntimeVisuals  desktop InlineVisualRuntimeOwner
 pointer-transparent       one isolated runtime page
```

候选模块位置：

| 责任 | 候选位置 |
| --- | --- |
| Profile schema 与纯 Validator | `app/domain/inline-visual-profile.*` |
| 槽位 admission、诊断码和预算 | `app/domain/inline-visual-admission.*` |
| renderer 生命周期唯一 owner | `app/application/inline-visual-session.*` |
| Edit 槽位矩形窄 Port | `CanvasInlineVisualPort`，由 Canvas adapter 实现 |
| runtime owner 窄 Port | `InlineVisualRuntimePort`，由 preload typed capability 实现 |
| pointer-transparent 显示层 | `app/components/HtmlInlineRuntimeVisuals.tsx` |
| 隔离运行页 owner | `desktop/inline-visual-runtime-owner.mjs` |

### 4.1 依赖规则

- domain 不依赖 React、Electron、Bridge 或真实 DOM；
- application Session 只依赖 typed Port，不直接调用 preload 或 Bridge；
- Workbench 只组合 Session、snapshot 和 Port，不保存 shadow loading/ready/error；
- Canvas 只报告当前源码槽位 rect，不接收运行 DOM 或像素；
- runtime owner 不读取 Project/Draft/Version/评论，也不写 Source；
- overlay 不拥有业务状态，只渲染 Session 已准入的当前 snapshot；
- 运行视觉不得导入 Review runtime-snapshot 模块形成隐式复用。

## 5. 单一状态所有者

`InlineVisualSession` 是 renderer 中唯一的运行视觉状态所有者。建议 snapshot 最小包含：

```ts
type InlineVisualSnapshot = {
  status:
    | "disabled"
    | "starting"
    | "waiting-for-stability"
    | "visible"
    | "suspended"
    | "failed";
  documentGeneration: number;
  sourceHash: string;
  visualGeneration: string | null;
  visibleSlots: readonly AdmittedSlot[];
  diagnostics: readonly InlineVisualDiagnostic[];
};
```

它可以拥有：

- 当前视觉 operation/generation；
- 一个 runtime page 句柄的逻辑身份；
- 当前准入槽位和诊断；
- deadline、重建速率和会话级 suspend 状态；
- disposable 取消/终止协调。

它不得拥有：

- HTML 字节的第二份可变副本；
- PNG、Canvas、SVG、Blob、ImageBitmap 或 DOM；
- 上一 generation 的可见结果；
- Source、Draft、Version、评论或 PageViewContext 权威；
- 需要写盘恢复的 durable state；
- DrainCoordinator blocker。

### 5.1 状态机

```text
disabled
   | eligible current generation
   v
starting -> waiting-for-stability -> visible
   |                 |                 |
   +------ failure / timeout / stale --+
                     |
                     v
                   failed

visible/starting/waiting
   | source, document, viewport identity or capability invalidated
   v
hidden immediately -> terminate old -> disabled/starting(new)

failure-rate budget exceeded -> suspended for this document session
```

不引入 `stale-visible`、`refreshing-with-old-result`、`cached` 或 `restoring` 状态。源码变化
时可以出现短暂静态空槽，这是为了换取没有双会话和缓存失效规则。

## 6. 最小协议

运行页只允许向可信 owner 报告身份与几何结果。示意协议：

```ts
type InlineVisualRuntimeReport = {
  protocolVersion: 1;
  visualGeneration: string;
  sourceHash: string;
  viewport: { width: number; height: number; dpr: number };
  slots: Array<{
    bindingId: string;
    rect: { x: number; y: number; width: number; height: number };
    hasVisibleCanvasOrSvgPaint: boolean;
    overflowed: boolean;
    replaced: boolean;
  }>;
};
```

约束：

- `bindingId` 由可信 pre-script bootstrap 创建，不使用作者可写的字符串作为最终权威；
- 消息走一次性、受挑战的私有端口；
- 作者页面不获得回传到 Edit、Bridge 或应用的能力；
- 报告不得包含 DOM 路径、selector、HTML、文本、业务数据、脚本异常文本或像素；
- owner 对字段数量、类型、范围、总字节和 generation 做二次校验；
- runtime rect 与 Edit 源码 rect 必须按同一坐标合同独立测量并匹配；
- 任一未知字段、重复身份、非有限数、越界矩形或迟到 generation 都整体/按槽 fail closed。

## 7. 全局不变量

每个实现 PR 都必须证明：

| ID | 不变量 |
| --- | --- |
| I-01 | Source HTML 字节和 SourcePatch 输出不因运行视觉变化 |
| I-02 | Edit iframe 始终不执行作者脚本 |
| I-03 | 每文档同时存活的运行页不超过 1 |
| I-04 | PageRoot 运行视觉缓存、bitmap、Blob 和截图数量为 0 |
| I-05 | 运行页不能访问 Node、Bridge、文件、任意网络或持久存储 |
| I-06 | overlay `pointer-events: none`，焦点和 IME 始终属于 Edit |
| I-07 | 只有当前 Document/Canvas/source/viewport/context generation 可见 |
| I-08 | runtime 与 Edit 几何不一致时隐藏，不做猜测性裁剪 |
| I-09 | 运行时高度不能改变 Edit natural document height |
| I-10 | 运行失败不阻塞 edit/save/switch/submit/close/history |
| I-11 | Workbench 不拥有重复状态，不新增直接 Bridge 调用 |
| I-12 | legacy 支持不读取库名、版本或分析 JavaScript 因果 |
| I-13 | 真实用户 HTML、路径、标题和业务数据不进入仓库/日志/遥测 |
| I-14 | Preview 与 Review 的现行 owner 和协议保持独立 |

## 8. 串行与并行规则

- Phase 0 必须在任何生产 owner/协议代码之前完成；
- PR-1 必须先于 PR-2，runtime 只能消费已冻结的 profile/admission 合同；
- PR-2 必须先于 PR-3，不能由 UI effect 临时创建窗口；
- PR-3 和 PR-4 串行，先证明静态 generation，再接源码/视口生命周期；
- PR-5 只能在 `profile-fixed` 真实 Electron 路径稳定后开始；
- PR-6 是条件项，不得阻塞不依赖远程资源的首发；
- PR-7 必须基于冻结的 exact head/base 和全量证据；
- 每个 PR 都必须可独立回滚，不允许跨 PR 临时双写；
- 发现需要修改上一阶段合同，先回到上一 PR/ADR，不在下游加兼容分支。

### 8.1 PRD 决策追踪

| PRD 决策 | 首次冻结/证明阶段 | 持续门禁 |
| --- | --- | --- |
| D-01 Source 唯一权威 | PR-1 | exact-byte 与 SourcePatch 回归 |
| D-02 Edit 脚本禁用 | Phase 0 / PR-2 | capability 与 Electron 安全门禁 |
| D-03 自动原位显示 | PR-3 | 无点击主路径 E2E |
| D-04 固定源码槽位 | PR-1 / PR-3 | Validator + geometry admission |
| D-05 每文档单运行页 | Phase 0 / PR-2 | owner/surface 数量断言 |
| D-06 零视觉缓存 | PR-2 / PR-4 | 状态机和 teardown 断言 |
| D-07 不传 DOM/像素 | Phase 0 / PR-2 | 协议 schema/字节 allowlist |
| D-08 pointer-transparent | Phase 0 / PR-3 | input/IME Electron E2E |
| D-09 原子大框选择 | PR-3 | Selection/comment E2E |
| D-10 不支持动态高度 | PR-1 / PR-3 | 负向 geometry fixture |
| D-11 不按库/版本白名单 | PR-1 / PR-5 | 禁止脚本扫描与 legacy 规则审查 |
| D-12 fail closed | Phase 0 起所有阶段 | hostile/negative corpus |
| D-13 Preview 保留完整交互 | PR-3 / PR-4 | Preview 回归和模式切换 |
| D-14 只用 PageViewContext | PR-4 | context allowlist 与事件禁发 |
| D-15 自动运行更严格 | Phase 0 / PR-2 | Security Model 和权限矩阵 |
| D-16 Profile 优先 | PR-1 / PR-5 | tier precedence tests |
| D-17 失败不持久、不阻塞 | PR-2 / PR-4 | outcome、drain、recovery tests |
| D-18 可行性先于合同修改 | Phase 0 / PR-7 | Go 记录与串行发布门禁 |

## 9. Phase 0：技术可行性与 Go/No-go

### 9.1 目标

用完全独立、不可打包到生产的技术探针回答宿主、隔离、裁剪、身份和生命周期是否
同时可行。探针只使用仓库内合成 fixture，不读取或提交真实用户文件。

### 9.2 必答问题

1. Electron 的哪种宿主能让运行脚本与 Edit 分离，并在脚本死循环时由 owner 在预算内
   强制终止？
2. 一个运行页面能否原位显示多个不连续矩形，未准入区域像素是否严格不可见？
3. overlay 是否能在视觉可见时保持完全 pointer-transparent，不截获 wheel、drag、
   selection、contextmenu、keyboard 或 IME？
4. 可信 bootstrap 能否在任何作者脚本前绑定源码槽位 Element，且作者脚本无法伪造、
   替换或重放这个身份？
5. Edit 与 runtime 的 rect 在相同 viewport、DPR、字体和资源策略下能否机械一致？
6. 外层滚动、页面内滚动、窗口 resize、DPR 切换和 PageViewContext 变化需要几个窄 Port？
7. 运行页崩溃、挂起、导航、弹窗、无限 microtask、DOM 爆炸时能否无等待回到静态 Edit？
8. 所有退出路径是否都能证明 runtime page/session/partition/监听器数量归零？

### 9.3 探针 fixture 矩阵

| 组 | fixture |
| --- | --- |
| 正常 | 单 Canvas、单 SVG、Canvas+SVG、多个槽位、15 个 Canvas、动画 Canvas |
| 固定响应式 | 百分比宽度、`aspect-ratio`、媒体查询、窗口 resize、DPR 1/2/非整数 |
| 身份 | 重复 id、重复 report key、宿主替换、子 Canvas 替换、延迟创建、断开重连 |
| 几何 | 嵌套槽位、重叠槽位、transform、zoom、圆角、border、overflow、fixed/sticky |
| 布局漂移 | 动态高度、运行后 margin 变化、字体晚到、图片晚到、文本重排、滚动条出现 |
| 失控脚本 | `while(true)`、无限 microtask、定时器洪水、DOM 增长、内存增长、崩溃 |
| 权限攻击 | 导航、popup、下载、外网、`file:`、storage、clipboard、Bridge/Node 探测 |
| 协议攻击 | forged report、超长数组、NaN/Infinity、旧 generation、重复/未知 binding |
| 生命周期 | 快速打开/切换/关闭、连续 resize、快速源码 revision、休眠唤醒、窗口隐藏 |

### 9.4 临时探针的隔离要求

- 放在 `experiments/` 或等价明确非生产目录；
- 不接入 Workbench、preload 稳定 API、打包入口或现有 Review owner；
- 不提交真实 HTML；必要的现实结构必须重写成最小合成 fixture；
- 输出原始测量、失败案例和环境信息，不输出业务页面内容；
- Phase 0 结束后由 Go/No-go PR 明确删除探针或将其转成正式 hostile fixtures；
- 探针成功不能直接作为生产安全结论，正式 owner 仍需重新实现和测试。

### 9.5 暂定通过阈值

以下阈值用于防止“先做出来再说”，最终数值由 Phase 0 证据冻结：

| 指标 | 暂定门槛 |
| --- | --- |
| 同一文档运行页/显示 surface | 最多 1 |
| PageRoot 视觉结果缓存 | 0 |
| runtime -> Edit DOM/像素字节 | 0 |
| 首发槽位数 | 每文档最多 32，超限 fail closed |
| 正常 ready | 95% 在 3000ms 内；主 deadline 3000ms |
| 强制终止 | owner 发起后 1000ms 内完成 |
| 错误槽位、错误裁剪、mask 泄漏、stale 可见 | 0 |
| 重建速率 | 最多 6 次/分钟，超过后会话级 suspend |
| Edit 主交互 | 视觉运行挂起时仍可选择、输入、保存和关闭 |
| 清理 | 关闭/切换后 session、surface、partition、listener 全部为 0 |

CPU、峰值内存、DOM 节点、协议总字节、几何容差和稳定窗口必须通过探针测量后冻结，
不得凭经验留成实现常量。

### 9.6 Go 条件

只有以下结论全部有可复现测试证据才为 Go：

- 独立故障域和硬终止成立；
- 单页多矩形显示成立且未准入像素无泄漏；
- pointer pass-through 对点击、选择、wheel、IME 全部成立；
- pre-script 身份绑定不可由作者脚本伪造；
- 几何 admission 能在目标环境达到零误显示；
- 不使用截图、DOM 复制、视觉缓存或每图运行页；
- 生命周期清理和速率限制成立；
- 方案能被一个 owner 和两个窄 Port 表达。

### 9.7 No-go 条件与交付

任一硬条件失败即 No-go。Phase 0 仍需交付：

- 失败的最小复现；
- 被否定的宿主/裁剪/隔离方案和原因；
- 对 PRD 未决问题的结论；
- 只做 Profile/Validator/内容规范化的替代路线；
- 明确禁止后续绕过条件的 ADR。

## 10. PR-1：Profile v0.1 与静态 Validator

### 10.1 目标

先把“哪些页面有资格运行”变成纯函数、可解释、可版本化的内容合同。PR-1 不创建
运行页、不改变 Edit UI，也不执行 JavaScript。

### 10.2 范围

- 定义 `pageroot-report-profile` 版本协商；
- 定义 `data-report-key`、`data-report-visual-slot="fixed"` 和
  `data-report-visual-kind="chart"` 的语义；
- 基于精确 Source HTML 建立槽位 source binding；
- 静态验证唯一身份、宿主类型、源码几何、可访问名称和数量预算；
- 输出 `profile-fixed`、`legacy-candidate`、`preview-only` 和明确诊断码；
- 区分“内容兼容诊断”和现有 Candidate Assessment/Version 健康结论；
- 为后续内容生成器和模板提供最小示例与迁移建议。

### 10.3 Validator 必须机械回答

| 问题 | 结果 |
| --- | --- |
| Profile 版本是否受支持 | yes / unsupported-version |
| report key 是否唯一且稳定 | yes / missing / duplicate / invalid |
| 槽位是否真实存在于源码 | yes / missing-source-host |
| 源码是否给出固定高度或 aspect ratio | yes / dynamic-or-unknown-geometry |
| 宿主是否属于允许集合 | yes / unsupported-host |
| 槽位是否嵌套或重叠 | yes / nested-or-overlapping-slot |
| 槽位数是否在预算内 | yes / slot-budget-exceeded |
| 是否存在可访问名称 | yes / missing-accessible-name |
| 是否声明动态正文/表格为视觉槽位 | no / non-visual-runtime-content |

诊断不能包含完整 HTML、脚本、业务文本或本机路径。对用户显示的定位应复用源码中的
稳定 report key/行列范围，而不是运行时 selector。

### 10.4 明确禁止

- 正则扫描 `echarts.init`、库版本或脚本调用图；
- 运行脚本来判断是否兼容；
- 根据页面标题、文件名或真实样例特判；
- 静默补高度、改源码或自动插入 Profile；
- 将 `legacy-candidate` 当作已支持；
- 把 Validator 诊断写入 Version 或改变 AI Request 内容。

### 10.5 测试

- domain table tests：合法/缺失/重复/未知版本/数量超限；
- HTML parser hostile tests：畸形标签、重复属性、大小写、实体、脚本中的伪标签；
- source binding tests：行列范围、source Hash 和稳定 key；
- property tests：任意未知属性不扩大能力；
- privacy tests：诊断和 telemetry candidate 不含内容、URL、路径；
- golden fixtures：固定 Canvas/SVG、动态高度、动态 `tbody`、嵌套槽位；
- exact-byte proof：Validator 前后 supplied source SHA-256 完全一致。

### 10.6 验收与停止条件

验收：同一 HTML 在无 DOM、无 Electron 的测试中得到确定、可解释结果；所有新增诊断
有单一枚举和用户文案映射；PR 无运行能力和 UI 行为变化。

停止：如果固定槽位不能仅凭源码/Profile 建立候选，回到 Profile 设计，不允许 PR-2
从运行 DOM 猜候选。

## 11. PR-2：单运行页 Owner 与安全协议

### 11.1 目标

建立正式的 `InlineVisualSession`、typed capabilities、desktop owner 和私有报告协议，
但 feature flag 强制关闭，用户看不到任何新视觉。

### 11.2 范围

- 新增 runtime capability，和 project picker、edit、preview、Review capture 独立声明；
- `InlineVisualSession` 实现单 operation、generation fence、deadline、取消、suspend；
- desktop owner 创建至多一个临时 runtime page 和非持久 partition；
- 在作者脚本前完成 source binding 和私有端口挑战；
- 设置导航、窗口、下载、权限、网络、文件、Node、Bridge、storage 禁止策略；
- 验证协议版本、字段、长度、slot 数、几何数值和消息字节；
- owner 崩溃/挂起/超时后强制销毁，并向 Session 返回有界 outcome；
- 打包/asar 校验确保可信 bootstrap 与运行时代码完整、不可被路径漂移绕过。

### 11.3 建议 outcome 合同

```ts
type InlineVisualStartOutcome =
  | { kind: "ready"; report: ValidatedRuntimeReport }
  | { kind: "unsupported"; reason: InlineVisualDiagnosticCode }
  | { kind: "failed"; reason: InlineVisualFailureCode }
  | { kind: "timed-out" }
  | { kind: "cancelled" }
  | { kind: "stale" };
```

不允许返回 `unknown` 后等待用户决定，也不允许把未决状态持久化。视觉路径没有 durable
副作用，丢失响应时唯一正确动作是销毁该 generation 并保持静态 Edit。

### 11.4 安全要求

- 运行页使用不可持久 partition；
- `nodeIntegration=false`、`contextIsolation=true`，不暴露通用 IPC；
- 默认拒绝所有网络，首发只允许精确源码相对资源和已验证本地协议；
- 拒绝新窗口、导航、下载、权限请求、剪贴板、打印、媒体捕获和外部协议；
- CSP/响应头由可信协议 owner 注入，作者 meta 不得放宽；
- 作者脚本无法读取 challenge、binding map、应用状态或 Edit DOM；
- 错误只输出稳定 code，不把脚本 exception/URL/HTML 送入 renderer 日志；
- CPU/内存/DOM/计时器超限必须可终止，不依赖页面自愿响应；
- capability 缺失时 fail closed，不退回普通 Preview capability。

### 11.5 测试

- Session reducer/state tests：单 flight、stale、cancel、deadline、速率限制；
- owner unit/integration tests：one-page invariant、清理、crash、hang；
- protocol hostile tests：伪造、重放、超长、未知版本、旧 Hash/generation；
- security tests：网络、文件、Node、Bridge、popup、navigation、storage 全拒绝；
- packaging tests：生产包内可信脚本存在且 Hash/路径正确；
- leak tests：重复 100 次 start/stop 后 owner/window/session/listener 回到基线；
- browser fallback tests：能力缺失时不创建任何运行页。

### 11.6 验收与停止条件

验收：feature flag 关闭时产品行为和 bundle capability 表现不变；测试能证明恶意脚本
不会冻结 Edit，所有退出路径只有一个 owner 并完全回收。

停止：若硬终止依赖杀死主应用进程、需要复用 Review 截图 owner、或一个页面无法承载
多个槽位，终止路线。

## 12. PR-3：`profile-fixed` 自动原位显示

### 12.1 目标

在内部 flag 下，让 Profile 合规、初始源码 generation 的固定槽位进入 Edit 后自动
原位可见。此 PR 只解决“第一次打开时准确显示”，不同时接入全部源码刷新逻辑。

### 12.2 范围

- Canvas adapter 从脚本禁用 Edit DOM 报告当前 profile slot rect；
- runtime owner 报告同一 binding 的运行 rect 和可见 Canvas/SVG paint；
- admission 纯函数校验身份、几何、overflow、替换和预算；
- `HtmlInlineRuntimeVisuals` 建立单一 pointer-transparent 合成层；
- 仅准入矩形可见，运行页正文、背景、动态表格和非槽位内容不可见；
- 未 ready 时保留源码占位视觉，不显示全局 spinner；
- 诊断面板/开发日志能解释每个槽位显示或隐藏原因；
- overlay 的 stacking、border radius 和 clipping 规则形成明确合同。

### 12.3 裁剪准确性的收口规则

这里不做“看起来差不多”的裁剪：

1. Profile source binding 唯一；
2. Edit 和 runtime 在同一 viewport/DPR/PageViewContext 下独立测量；
3. 两侧 width/height/position 在冻结容差内；
4. runtime 宿主未被替换、未 overflow，内部确有可见 Canvas/SVG paint；
5. 槽位不嵌套、不重叠、不超页面/数量/面积预算；
6. 稳定窗口内 rect 不再变化；
7. 父级最终 mask 与 Edit rect 相交，绝不相信 runtime 独立扩大可见范围；
8. 任一条件失败立即隐藏该槽位，不自动扩大矩形或选择近邻节点。

这使有限白名单下的准确性问题变成“严格承认或不显示”，而不是一个要不断修复的
通用裁剪器。

### 12.4 输入与选择

- overlay 根和所有内部 surface 均不接受 hit testing；
- 点击槽位实际命中下方源码宿主；
- Selection 只能选中源码中存在的宿主“大框”，不能选柱、线、点或 runtime 文本；
- 评论锚定该源码宿主 TargetRef；
- tooltip、hover、图例切换和图内滚动仅在 Preview 提供；
- 可访问树继续由源码 `role`、`aria-label` 和 figcaption 提供，运行页不加入 Edit a11y 树。

### 12.5 测试

- visual geometry tests：0/1/多槽位、DPR、边框、圆角、scrollbar、zoom；
- screenshot tests 只作为测试断言证据，不建立产品截图数据流；
- pixel leak tests：槽位外运行页独特色块必须 0 可见；
- input E2E：点击、drag selection、wheel、contextmenu、Tab、IME 全命中 Edit；
- comment E2E：选择大框、创建评论、滚动后 marker 仍由 Edit 几何拥有；
- negative fixtures：重叠、动态高度、替换宿主、overflow、无 paint 全隐藏；
- exact-source proof：运行前后源码、保存结果、Version 输入 SHA 不变。

### 12.6 验收与停止条件

验收：flag 打开时合规 fixture 自动原位出现，无需点击；点击只得到一个源码宿主大框；
任何裁剪不确定性都产生静态回退，没有运行页其他区域泄漏。

停止：如果准确显示需要读取 Canvas 像素、复制 SVG、对每类 CSS 写特判或保留旧视觉，
回到 Phase 0/No-go。

## 13. PR-4：生命周期、源码变化与页面状态

### 13.1 目标

把“什么时候重建”收敛为少数权威事件，避免每次 DOM mutation、每次键入或每个槽位
各自刷新。所有事件都由 `InlineVisualSession` 串行化。

### 13.2 允许触发重建的事件

| 事件 | 行为 |
| --- | --- |
| 新 DocumentSession 身份/项目切换 | 立即隐藏并销毁旧页；新文档重新资格判断 |
| 已确认的新 Source Hash + Canvas generation | 立即隐藏旧视觉；编辑 settle 后最多创建一个新 generation |
| viewport 尺寸或 DPR 改变 | 隐藏；合并 resize burst 后重建 |
| 受支持的 PageViewContext generation 改变 | 隐藏；用完整有界 context 重建/应用一次 |
| capability/recovery 变化 | 关闭或按新 generation 重新资格判断 |
| owner crash/timeout/预算违规 | 静态回退；计入速率，可能 suspend |
| 普通滚动 | 不重建；只通过一个窄 scroll/geometry projection 更新合成位置 |
| 光标、Selection、评论输入、IME | 不重建 |
| 未确认的每次 keydown/MutationObserver 回调 | 不重建 |

“源码变化”特指 `DocumentSession` 已接纳、拥有新 Hash 和 Canvas authority generation
的完整源码事实，而不是每个浏览器 DOM mutation。连续输入应由现有 source adoption/
render acknowledgement 边界和一个有上限的 settle 策略合并；不得常驻轮询 HTML。

### 13.3 无缓存刷新序列

```text
authoritative source/context change
  -> current overlay hidden synchronously
  -> old runtime termination requested
  -> new Edit generation renders and acknowledges exact Hash
  -> eligibility revalidated
  -> one new runtime generation starts
  -> identity + geometry stable
  -> overlay becomes visible atomically
```

旧视觉不会等新视觉，也不会在后台被标成“可能仍有效”。这减少了视觉连续性，但消除
了缓存键、双会话、迟到结果和 stale 误显示四组复杂度。

### 13.4 PageViewContext

- 只支持现有合同已允许的 disclosure/tab/reveal 状态；
- context 必须带完整 generation，不发送任意作者 click/selector/event；
- runtime 不得把内部状态反向写回 Edit；
- 若某状态不能通过安全的有界 context 表达，该槽位在此状态下隐藏或要求 Preview；
- context 改变不得改变 Source Hash、TargetRef 或持久化内容。

### 13.5 测试

- rapid typing：多次 revision 合并为有界 generation 数，不逐键创建窗口；
- stale fencing：旧 owner/report/rect/timeout 永远不能重现；
- switch/close/history：立即回收且不注册 Drain blocker；
- resize/DPR/scroll：准确同步，无 mask 泄漏和重建风暴；
- PageViewContext：支持状态准确，不支持状态 fail closed；
- IME：compositionstart 到 compositionend 不因视觉刷新失焦、丢选区或重复 Patch；
- source reconciliation：保存未知结果、外部替换和 recovery 期间不显示不匹配视觉；
- long-session soak：反复修改、切换、隐藏窗口后资源回到预算。

### 13.6 验收与停止条件

验收：源码变化不会频繁无限刷新；每个权威 generation 最多创建一次，burst 有速率上限；
旧视觉同步隐藏；核心编辑和 drain 流程不感知视觉 owner。

停止：若必须监听任意 runtime DOM 变化持续同步、为无闪烁保留两页、或把运行视觉加入
DrainCoordinator，则停止扩大功能。

## 14. PR-5：窄 `legacy-fixed` 兼容

### 14.1 前置条件

只有 `profile-fixed` 在真实 Electron canary 中达到零错槽/零 mask 泄漏，并完成至少
一个冻结观测窗口后，才评估旧页面兼容。兼容层必须能一键关闭，不能影响 Profile 路径。

### 14.2 允许的机械候选

旧页面只有满足以下全部条件才进入运行验证：

- 候选可直接绑定到源码中的 Canvas/SVG 根；或源码为空、稳定、固定几何的宿主；
- 源码 CSS 在目标视口给出确定的 width/height/min-height/aspect-ratio；
- 身份在源码中唯一，不使用位置型 `nth-child` 猜测；
- 运行后宿主本身未替换，几何与 Edit 一致；
- 槽位内存在可见 Canvas/SVG paint；
- 槽位不含动态正文、表格、表单或可编辑内容；
- 不嵌套、不重叠、不 overflow，不超过更严格的 legacy 数量/面积预算。

### 14.3 明确拒绝

- 扫描 `echarts`、`Chart`、`d3`、script URL 或版本号；
- 从脚本字面量推断 selector/宿主；
- 接受任意空 `div`；
- 接受运行后才获得高度的宿主；
- 动态 `tbody`、卡片、列表、正文、地图弹层；
- 用相邻文本、文件名或页面标题猜身份；
- 对真实客户页面添加硬编码 selector；
- “最近的 Canvas/SVG”或模糊矩形匹配。

### 14.4 测试与验收

- corpus 只包含匿名最小 fixture 和经批准的合成变体；
- precision 优先：错误准入目标为 0，召回率不作为放宽条件；
- 每条 legacy 规则有正例、近似反例、恶意反例和诊断码；
- Profile 与 legacy 同时存在时 Profile 唯一优先；
- 一条规则若需三个以上页面特例或无法纯机械描述，删除该规则；
- canary 可分别统计 legacy 准入、运行拒绝和错误报告，不记录页面内容。

验收：兼容集合可以用一页规则表完整描述，关闭 legacy flag 后 Profile 行为完全相同。

## 15. PR-6：精确离线资源映射（条件项）

### 15.1 决策门槛

只有 canary 数据证明大量已准入固定槽位的唯一失败原因是少数明确远程资源，并获得
单独产品/安全授权时才实施。否则跳过本 PR，用户通过内嵌或源码相对资源获得支持。

### 15.2 允许模型

- 精确完整 URL + 精确内容 Hash + 随应用打包的只读资产；
- 一条映射对应一个经过审查的文件，不做 semver、别名或通配；
- 响应 MIME、大小、Hash、CSP 和缓存政策固定；
- 原 HTML 不重写，runtime 协议层仅在当前一次性会话中解析；
- 映射清单有 owner、许可证、来源、升级和删除记录；
- 不开放网络，不在运行时下载，不建立 CDN/HTTP 缓存。

### 15.3 明确禁止

- “允许某域名下所有脚本”；
- `echarts@5`、`latest` 或任意版本自动兼容；
- 依据文件名相近选择资产；
- 用户级永久缓存和后台更新；
- 自动把 5.4.3 升级为其他版本；
- 将资源失败转换为运行完整性的肯定结论。

### 15.4 测试与验收

- exact URL/Hash 正例；query、大小写、重定向、内容漂移反例；
- 许可证和打包清单校验；
- production artifact 资产闭包检查；
- 未命中时零网络请求、稳定诊断、静态回退；
- 删除清单项后没有隐式缓存继续命中。

验收：映射集合有限、可审计、可删除，不产生通用依赖解析器或缓存系统。

## 16. PR-7：默认启用、合同同步与发布门禁

### 16.1 目标

基于冻结证据决定首发范围：仅 Profile 默认开、Profile+legacy 灰度开，或保持 opt-in。
同步所有产品/架构/安全合同，使实现和规范只有一个事实版本。

### 16.2 必须更新的规范

- `MVP_PRD.md`：Edit 目标体验、非目标和 Preview 边界；
- `ARCHITECTURE.md`：数据流、宿主和依赖方向；
- `ARCHITECTURE_CONTRACT.md`：层级、Port、禁止导入和组合根规则；
- `STATE_OWNERSHIP.md`：`InlineVisualSession` 与 desktop owner 唯一事实；
- `SECURITY_MODEL.md`：自动脚本的更严格威胁模型和权限矩阵；
- `RUNTIME_VISUAL_CONTRACT.md`：Edit 新路径与 Review 截图路径明确分离；
- `COMPATIBILITY.md`：Profile/legacy/preview-only 能力等级；
- 新 ADR：接受的宿主方案、为何没有缓存/截图/事件/动态高度；
- 测试影响图和架构检查器：新增 owner、Port、IPC/capability 的硬断言。

### 16.3 启用顺序

1. 开发环境显式 flag；
2. 内部 synthetic corpus；
3. Profile opt-in canary；
4. Profile 默认开启、legacy 仍关闭；
5. 若证据充足，legacy 小比例 canary；
6. 默认策略评审；
7. Candidate/Release 仍遵循现有 exact-SHA 和独立授权流程。

每一步都要能够仅关闭运行视觉而不回滚源码编辑、Preview 或 Review。自动显示不得通过
隐藏 flag 绕过未完成的安全/打包门禁。

### 16.4 默认开启门槛

- Phase 0 和 PR-1 至 PR-4 的所有不变量持续成立；
- Profile canary 错槽、错裁、mask 泄漏和 stale 可见为 0；
- Selection、IME、评论、SourcePatch、save、switch、close 回归为 0；
- P95 ready、CPU、内存、重建和清理达到冻结预算；
- unsupported/failure 有清晰诊断，静态 Edit 可继续；
- telemetry schema 通过内容隐私检查；
- production package 在全新用户环境中通过；
- 安全审查确认自动执行面没有借用 Preview 的宽权限；
- exact head/base 上全量本地门禁、远程 CI 和审查已重新运行。

## 17. 全局测试矩阵

### 17.1 纯逻辑

- Profile schema、version negotiation、诊断枚举；
- source binding、identity、admission、geometry tolerance；
- generation、deadline、速率限制、suspend；
- capability 缺失和 PageViewContext 支持矩阵；
- telemetry 属性 allowlist 和内容拒绝。

### 17.2 Renderer / React

- Session snapshot 是唯一 loading/ready/failure 状态；
- overlay mount/unmount、pointer transparency、z-index；
- Canvas rect adapter 与 natural document height 无循环；
- source adoption、render acknowledgement 和 stale callback；
- Selection、IME、comment rail、undo/redo、zoom/scroll；
- Workbench 不增加直接 Bridge 调用或 shadow refs。

### 17.3 Desktop / Electron

- 一页上限、partition 隔离、pre-script binding、私有端口；
- CPU hang、crash、navigation、popup、download、permission；
- source-relative assets 和精确资源映射；
- resize、DPR、display move、窗口遮挡/隐藏、休眠唤醒；
- app close/project switch/history/preview transition 清理；
- packaged production artifact 与 dev 行为一致。

### 17.4 安全 hostile corpus

- 无限同步循环、无限 microtask、timer storm；
- DOM/memory 增长、递归 Canvas、超大 SVG；
- 原型污染、消息伪造、旧 generation replay；
- `window.open`、top navigation、custom protocol、file read、network beacon；
- storage/IndexedDB/service worker/shared worker/websocket；
- 重复 binding、宿主替换、rect NaN/Infinity/极值；
- overflow 到槽位外、透明超大 Canvas、fixed/sticky 覆盖。

### 17.5 回归权威证明

每个涉及生产路径的 PR 至少证明：

- supplied source before/after SHA-256 相同；
- 编辑 Patch 仍是最小 source-backed patch；
- comment TargetRef/marker 仍由 Edit 源码表面解析；
- Version/Review/AI Request 未接收运行 DOM/像素；
- Preview 交互不因 Edit 视觉能力改变；
- 关闭 flag 后行为与基线一致；
- owner/window/listener/resource 数量在 teardown 后归零。

## 18. 性能与资源预算登记

Phase 0 必须把 TBD 转为带证据的常量；PR 不得各自声明不同预算：

| 预算 | Owner | 暂定值 | 冻结证据 |
| --- | --- | --- | --- |
| runtime ready deadline | domain contract | 3000ms | Phase 0 timing corpus |
| hard terminate deadline | desktop owner | 1000ms | hang fixtures |
| slot count | domain contract | 32 | multi-slot profile |
| report byte limit | domain contract | TBD | hostile protocol tests |
| DOM node limit | desktop owner | TBD | normal/hostile corpus |
| CPU budget/window | desktop owner | TBD | animation + hang corpus |
| memory ceiling | desktop owner | TBD | packaged Electron soak |
| geometry tolerance | admission contract | TBD | DPR/zoom/display matrix |
| stability window | admission contract | TBD | font/image/layout matrix |
| rebuild rate | Session | 6/minute | typing/resize burst |
| visible aggregate area | admission contract | TBD | mask/performance probe |

预算必须在一个 frozen contract 中定义，consumer 只引用，不得重声明。命中任何硬预算
立即隐藏/终止；同一会话反复命中则 suspend，不进行指数重试或后台恢复。

## 19. 观测与隐私

允许的聚合事件属性仅包括：

- capability/profile/compatibility tier；
- slot 数量 bucket；
- ready/unsupported/failed/timed-out/suspended code；
- 时延、CPU、内存和重建次数 bucket；
- geometry mismatch、overflow、resource denied 等稳定枚举；
- app version、OS major、DPR bucket（遵循现有 opt-in）。

禁止采集：

- HTML、CSS、JavaScript、Canvas/SVG 内容或截图；
- 页面标题、文件名、路径、URL、report key、aria-label；
- 图表配置、数据、图例、坐标文本或 exception message；
- 项目 ID 的可逆值或跨安装追踪标识。

产品指标只用于决定支持边界和关闭策略，不能用低错误上报替代 hostile tests。

## 20. 风险登记与控制

| 风险 | 最早发现阶段 | 控制/退出 |
| --- | --- | --- |
| 作者脚本冻结应用 | Phase 0 | 独立故障域+硬终止；失败即 No-go |
| 单页无法做准确多矩形显示 | Phase 0 | 不转每图页/截图；失败即 No-go |
| runtime/Edit 字体布局漂移 | Phase 0/PR-3 | 固定策略+稳定窗口；不一致隐藏 |
| 生命周期重建风暴 | PR-4 | 权威事件表+速率上限+suspend |
| 为无闪烁引入旧视觉 | 所有 PR | 状态机硬禁 stale-visible |
| legacy 规则无限增长 | PR-5 | Profile 优先、机械规则、独立 flag |
| 外部资源驱动开放网络 | PR-6 | 仅 exact URL+Hash 离线映射；可跳过 |
| 点击体验让人误解可编辑图内元素 | PR-3 | 原子大框、只读说明、Preview 交互 |
| 运行高度推动正文 | PR-3 | 几何 admission 拒绝，永不投影高度 |
| 新 owner 侵入 Drain | PR-2/PR-4 | disposable outcome，无 durable state |
| 运行内容进入日志/遥测 | PR-1/PR-2 | 稳定 code、allowlist、privacy tests |
| 开发成功但打包失败 | PR-2/PR-7 | package closure + fresh-user Electron gate |

## 21. 全局停止条件

任何阶段出现以下事实，立即暂停后续 PR，形成产品/ADR 复审：

1. 需要在 Edit iframe 中启用作者脚本；
2. 需要每图表独立 iframe/window/webContents；
3. 需要截图、像素复制、DOM clone 或视频流；
4. 需要视觉缓存、双缓冲、旧 generation 保留；
5. 需要动态高度或持续正文布局同步；
6. 需要把作者 click/hover/keyboard 事件在两页之间转发；
7. 需要库版本适配、脚本静态分析或客户页面硬编码；
8. 需要运行时子元素的持久 TargetRef/评论身份；
9. 需要开放任意网络、文件、Bridge、Node 或持久 storage；
10. 需要把视觉状态加入 save/switch/submit/close drain；
11. 需要模糊裁剪、扩大容差或删除反例才能通过；
12. 不能在预算内终止或清理失控运行页；
13. 任一运行信息进入 Source、Version、Review、AI Request 或 durable project state；
14. 真实用户文件/路径/内容必须进入仓库才能保持测试通过。

停止并不等于项目失败：Profile/Validator 和内容迁移本身仍能减少空白页面，并把复杂度
放回 HTML 生产合同，而不是继续扩大编辑器运行时。

## 22. 每个 PR 的交付模板

每个实现 PR 描述必须包含：

1. **冻结范围**：本 PR 做什么、不做什么；
2. **事实 owner**：新增/修改的 mutable fact 和唯一 owner；
3. **协议**：输入、输出、大小、deadline、stale 和 failure outcome；
4. **安全能力**：新增 capability/IPC/资源权限及 fail-closed 路径；
5. **不变量证据**：I-01 至 I-14 的适用证明；
6. **测试影响图**：新增行为到 unit/integration/Electron/security/package gate；
7. **真实样例政策**：仅本机只读验证，绝不提交路径、名称或内容；
8. **性能结果**：与冻结预算逐项对照；
9. **清理证明**：owner/window/session/listener/partition 归零；
10. **差异与回滚**：flag/off switch 和独立回滚边界；
11. **文档同步**：合同、ADR、State ownership 是否需要同 PR 更新；
12. **授权边界**：Draft、Ready、merge、Candidate、Release 分别等待独立授权。

## 23. 完整验收场景

### 23.1 用户主路径

1. 打开含三个 Profile 固定图表的 HTML；
2. 静态 Edit 立即出现，图表在预算内自动原位显示；
3. 无点击“查看”动作，无侧栏/浮窗；
4. 点击图表选中源码宿主大框；
5. 在标题、图注和正文中选择、输入中文 IME、撤销和评论；
6. 保存后 source bytes 只包含用户明确编辑；
7. 进入 Preview 获得 tooltip/hover/交互；
8. 回到 Edit 仍只有只读原位视觉；
9. 关闭/切换项目无等待、无泄漏。

### 23.2 源码刷新

1. 用户编辑图表相关源码；
2. 当前视觉同步隐藏，而不是显示旧图；
3. 连续输入期间不逐键创建运行页；
4. 新 Source Hash 和 Canvas generation 接纳后只创建一次；
5. 新 identity/geometry 通过后原子显示；
6. 任何旧 report/timeout 到达都被丢弃。

### 23.3 不支持页面

1. 页面脚本生成动态表格并改变高度；
2. Validator 标记 `preview-only` 或只准入独立固定图表；
3. Edit 保持静态源码内容和空槽位，不尝试裁动态正文；
4. 用户仍可编辑、保存、评论，并可进入 Preview 看完整运行页面；
5. 诊断准确说明固定槽位要求，不声称页面损坏。

### 23.4 恶意/故障页面

1. 运行脚本死循环、导航或发送 forged report；
2. owner 在预算内拒绝/终止；
3. overlay 没有错误内容或旧 generation；
4. Edit 输入、Selection、保存、关闭仍可用；
5. 同文档重复失败达到上限后 suspend，不无限重启；
6. 日志/遥测只包含稳定失败码。

## 24. 规划完成定义

本文阶段的交付只在以下条件同时满足时完成：

- PRD 的每项核心决策都有实施阶段、测试或停止条件承接；
- 单运行页、固定槽位、自动原位、pointer-transparent 和无缓存有明确 owner；
- 裁剪准确、选择大框、源码刷新频率和生命周期问题都有机械边界；
- Phase 0 能在不碰生产路径的前提下给出 Go/No-go；
- 七个 PR 均可独立评审、回滚和停止；
- 真实用户文件不进入仓库；
- 当前生产合同没有被本规划文档提前改写；
- 后续实现、Ready、合并和发布仍分别等待明确授权。
