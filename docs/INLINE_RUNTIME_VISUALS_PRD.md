# PageRoot 固定视觉槽位与编辑态自动原位显示 PRD

- 状态：**产品方向已确认；生产实现尚未开始**
- 决策日期：2026-08-12
- 规划基线：`main@8fffb0529239b537f25fc0463921325babdf167f`
- 适用范围：桌面版当前 HTML 的 Edit 画布；浏览器弱能力模式保持静态
- 配套执行规划：[固定视觉槽位与自动原位显示执行规划](INLINE_RUNTIME_VISUALS_EXECUTION_PLAN.md)
- 相关现行合同：[MVP 产品需求](MVP_PRD.md)、[Architecture](ARCHITECTURE.md)、[Architecture contract](ARCHITECTURE_CONTRACT.md)、[State ownership](STATE_OWNERSHIP.md)、[Security model](SECURITY_MODEL.md)、[Runtime visual contract](RUNTIME_VISUAL_CONTRACT.md)

> 本文记录已经确认的产品方向、目标体验和复杂度边界。当前生产行为仍以现行
> 架构合同为准：Edit 脚本禁用，Preview 执行作者脚本，Review 独占有界运行态截图
> 补充。只有配套执行规划中的技术可行性门禁通过、后续实现获得独立授权并同步更新
> 现行合同后，本文的目标行为才成为生产事实。

## 1. 产品结论

PageRoot 将为符合固定视觉槽位合同的动态图表提供**自动、原位、真实运行的只读
显示**。用户进入 Edit 后无需点击“预览”或“实时查看”，图表就在源码预留的原始
位置自动出现；文字编辑、Selection、IME、评论、撤销、保存和 AI 修改仍只作用于
脚本禁用的源码画布。

目标方案不是在 Edit DOM 中执行脚本，也不是截图填充，而是：

1. 同一份精确 Source HTML 继续生成脚本禁用的 Edit 源码画布；
2. 桌面端同时创建至多一个隔离、可销毁的运行页；
3. 可信宿主只把运行页中通过固定槽位校验的矩形原位显示在 Edit 画布上方；
4. 运行层完全不接收指针事件，所有点击、文字选择和评论仍命中 Edit 源码节点；
5. 运行页不向 Edit 传递 DOM、HTML、表格、Canvas 像素、PNG、Blob 或脚本状态；
6. 任一身份、几何、来源、生命周期或安全校验失败，只隐藏该视觉槽位并保留静态
   Edit，不阻塞编辑、保存、Version、Review 或 AI Request。

V1 的关键产品边界是：**源码拥有槽位布局，运行时只拥有槽位内部的视觉绘制。**
运行脚本不得改变槽位的 border box、推动后续正文、生成可编辑正文或成为新的页面
权威。

## 2. 背景与问题

### 2.1 用户问题

企业报告 HTML 经常把 ECharts Canvas、自定义 SVG、DIV 图形或表格行留到脚本运行时
生成。PageRoot 为保护 SourceIndex、TargetRef、Selection、IME 和 SourcePatch，当前
Edit 有意禁用作者脚本，因此这些页面在编辑状态中会出现空白图表区域。用户实际需要
的是：

- 编辑正文时仍能看见报告完整视觉；
- 不必先进入 Preview，也不必打开侧栏或浮窗；
- 图表无需在 Edit 中响应 hover、tooltip、缩放或内部点击；
- 页面源码、评论定位、撤销和保存的可靠性不能因显示图表而下降。

### 2.2 已验证的页面形态

现有真实样例的结构事实归纳如下。仓库只记录匿名结构，不提交真实用户 HTML、路径、
业务数据或文件名。

| 匿名样例 | 运行方式 | 布局性质 | V1 结论 |
| --- | --- | --- | --- |
| A | 自定义 DOM + SVG，脚本生成多行内容 | 运行后宿主高度和正文流显著变化 | 不支持；应把行和高度改为源码事实 |
| B | 自定义 DIV + SVG | 主要绘图区在源码中有固定高度 | 支持候选 |
| C | 外部 ECharts + 自定义 SVG + 动态 `tbody` | 图表固定；表格运行时扩展 | 固定图表可支持；动态表格不支持 |
| D | HTML 内嵌 ECharts，多个 Canvas | 每个图表有固定高度 | 支持候选 |

样例中出现过 ECharts 5.4.3，但“图表库和版本”不是可靠的共同边界。前两个样例并不
依赖 ECharts；未来还会出现其他 ECharts 版本、Chart.js、D3、Highcharts 和自定义
绘图代码。PageRoot 因此不能以库名或版本作为主要白名单。

### 2.3 为什么不恢复截图方案

历史 Edit Runtime Snapshot 已经证明：一旦 Edit 开始拥有捕获时机、PNG 编码、IPC
字节、DPR、裁剪尺寸、缓存键、Blob 生命周期、迟到结果和投影节点，它就不再是一个
简单显示功能，而成为第二套运行态视觉系统。该系统后来已按 ADR 0017 从 Edit 删除。

新的方向只有在不重新引入以下责任时才成立：

- 不捕获或复制运行结果；
- 不建立视觉结果缓存；
- 不把运行态 DOM 或像素挂进 Edit DOM；
- 不分析脚本因果；
- 不让运行结果进入持久化、Review 源码分析或 AI 输入。

## 3. 用户与核心任务

### 3.1 主要用户

- 编辑企业报告、研究报告和信息图 HTML 的内容作者；
- 对图表视觉完整性敏感，但主要修改标题、正文、数字说明、图注和样式的用户；
- 导入历史 HTML，希望尽量直接查看，但接受不符合合同的页面回退到 Preview 的用户。

### 3.2 核心任务

1. 打开报告后立即看见符合合同的图表，而不是空白框；
2. 在图表周围继续精确编辑和评论源码文字；
3. 点击运行时生成的图表时，明确选中整个图表宿主；
4. 源码、视口或页面状态变化后，只显示与当前事实一致的视觉；
5. 图表运行失败时仍能继续完成所有源码工作；
6. 需要真实交互时进入现有 Preview，且 Preview 仍是唯一的完整交互表面。

## 4. 目标与非目标

### 4.1 V1 目标

- 对符合 Report HTML Profile 的固定视觉槽位自动原位显示真实 Canvas/SVG；
- 对一小类可机械证明的历史固定宿主提供兼容识别；
- 保持 Source HTML 字节、SourcePatch、TargetRef、Selection、IME 和评论合同不变；
- 只运行一个隔离页面，不按图表创建多个运行环境；
- 对任何失败提供无阻塞、无陈旧视觉的静态降级；
- 用机器可检查的合同和诊断码解释“为什么该槽位显示或没有显示”；
- 为运行时资源、安全、性能、生命周期和进程终止设置明确预算。

### 4.2 V1 非目标

- 不在 Edit DOM 中启用作者脚本；
- 不支持任意历史 HTML 的完整兼容；
- 不支持运行时生成的表格、卡片、正文、列表或页面结构；
- 不支持运行时改变槽位高度、宽度或后续正文位置；
- 不支持图表内部柱、点、线、图例或坐标轴的选择与评论；
- 不转发 hover、click、wheel、keyboard、touch、tooltip 或缩放事件；
- 不复制运行时 DOM、Canvas、SVG、HTML、PNG 或视频流；
- 不创建每图表 iframe，不创建截图或视觉结果缓存；
- 不按 ECharts、Chart.js 或其他库维护版本适配器；
- 不自动升级、替换或重写用户 HTML 中的图表库版本；
- 不开放任意互联网访问，不建设通用 CDN 下载缓存；
- 不把兼容诊断混入 Candidate Assessment、Version 接受或 AI 输出健康结论；
- 不让运行态生命周期成为 save、switch、submit、close 或 history 的 Drain 义务。

## 5. 核心决策记录

以下决策是后续设计和实现的硬边界。改变任一项必须先修改本文并重新获得产品确认，
不能在实现 PR 中以“兼容一个页面”为由静默扩大。

| ID | 决策 | 原因 |
| --- | --- | --- |
| D-01 | Source HTML 始终是唯一持久化权威 | 保护最小字节 Patch、Version 和 AI 输入 |
| D-02 | Edit 继续脚本禁用 | 保护 SourceIndex、Selection、IME 和评论命中 |
| D-03 | 支持的视觉进入 Edit 后自动出现 | 完整体验不能依赖用户先点击 Preview |
| D-04 | 只支持源码拥有几何的固定视觉槽位 | 把布局权威留在源码，避免双页面持续布局同步 |
| D-05 | 同一文档最多一个隔离运行页 | 避免每图表运行环境、重复脚本和资源膨胀 |
| D-06 | PageRoot 不管理视觉结果缓存 | 避免 stale 规则、LRU、双 generation 和回收复杂度 |
| D-07 | 运行页不向 Edit 传递 DOM 或像素 | 防止恢复截图/复制 DOM 的第二权威 |
| D-08 | 运行层指针透明 | 所有用户输入仍由源码画布处理 |
| D-09 | 运行时生成的图表是原子选择目标 | 运行时子元素没有源码身份，不能伪造细粒度 TargetRef |
| D-10 | V1 不接受动态高度 | 高度投影会重新引入布局状态、评论重测和同步循环 |
| D-11 | 白名单描述能力与宿主，不描述图表库版本 | 覆盖自定义 Canvas/SVG，并避免版本适配器 |
| D-12 | 精确身份或几何不一致时 fail closed | 宁可少显示，也不能错裁或显示错误 generation |
| D-13 | Preview 继续拥有完整交互 | Edit 视觉层只解决“看见”，不复制第二套交互系统 |
| D-14 | 支持页面状态只通过现有有界 PageViewContext | 不执行或转发任意作者事件 |
| D-15 | 自动运行使用比手动 Preview 更严格的安全预算 | 打开文件即执行改变了用户授权和威胁模型 |
| D-16 | Profile 合规优先于旧页面猜测 | 让未来内容变简单，而不是让编辑器无限兼容 |
| D-17 | 运行态失败不产生持久状态和用户修复义务 | 静态 Edit 始终可继续使用 |
| D-18 | 只有技术可行性门禁通过后才修改现行架构合同 | 防止先承诺无法安全落地的生产行为 |

### 5.1 明确拒绝的替代方案

| 替代方案 | 结论 | 拒绝原因 |
| --- | --- | --- |
| Edit iframe 直接增加 `allow-scripts` | 拒绝 | 作者脚本与编辑器同时修改同一 DOM，且同源能力扩大 |
| 只白名单 ECharts 5.4.3 | 拒绝 | 不能覆盖自定义绘图，且初始化脚本仍是任意 JavaScript |
| 每张图一个 iframe | 拒绝 | 重复执行整页脚本，CPU、内存和生命周期与图表数线性增长 |
| 截取 PNG 回填 | 拒绝 | 恢复捕获、IPC、缓存、Blob 和 DPR 复杂度 |
| 复制/清洗运行时 DOM | 拒绝 | 运行节点无源码身份，会形成第二文档权威 |
| 自动测量并投影任意高度 | V1 拒绝 | 会推动正文、改变评论坐标并要求持续双页面布局同步 |
| 透传点击和 hover | V1 拒绝 | 会要求状态、事件、焦点和可访问性双向同步 |
| 图表数据点级评论 | V1 拒绝 | 需要库适配、运行身份和新的持久评论定位合同 |
| 保留旧图等待新图 | V1 拒绝 | 需要 stale 可见性、双会话和缓存失效规则 |

## 6. 术语

### 6.1 固定视觉槽位（Fixed Visual Slot）

源码中真实存在、具有唯一稳定身份、在给定视口和 PageViewContext 下由源码 CSS
确定 border box 的元素。脚本可以在其内部绘制，但不得替换该元素、改变其几何、
溢出到外部或推动页面布局。

“固定”不等于所有屏幕上使用同一个像素宽度。槽位可以使用 `width: 100%`、媒体查询
或 `aspect-ratio` 响应式变化；它要求的是同一视口下，脚本前后的槽位几何一致，并且
几何来源于源码而不是运行结果。

### 6.2 Edit 源码表面（Edit Source Surface）

现有 `HtmlCanvasEditor` 的脚本禁用 iframe。它拥有 SourceIndex、TargetRef、编辑、
Selection、IME、评论测量和 SourcePatch，不接受运行时 DOM 或像素。

### 6.3 隔离视觉运行页（Isolated Visual Runtime）

从同一精确 Source HTML 创建的短生命周期运行页面。它只获得显示图表所需的受限
脚本和声明资源能力，不获得 Node、Bridge、文件、应用窗口、任意网络、持久存储或
源码写入权限。

### 6.4 原位视觉层（Inline Runtime Overlay）

位于 Edit 源码表面上方、完全 pointer-transparent 的运行页合成层。可信父级只显示
通过槽位身份和几何门禁的矩形，其余运行页像素不可见。

### 6.5 视觉 generation

由完整 `DocumentSession` 身份、Canvas generation、Source SHA-256、视口、DPR 和
有界 PageViewContext generation 共同确定的一次性显示身份。上一 generation 的迟到
结果不能进入当前画布。

## 7. Report HTML Profile：固定视觉槽位合同

### 7.1 推荐源码结构

Profile v0.1 推荐使用源码可读的业务属性，不使用 PageRoot 内部保留属性：

```html
<meta name="pageroot-report-profile" content="0.1">

<figure data-report-key="search-volume-trend">
  <div
    id="search-volume-chart"
    data-report-visual-slot="fixed"
    data-report-visual-kind="chart"
    role="img"
    aria-label="2024 至 2026 年搜索量趋势图"
    style="width: 100%; aspect-ratio: 5 / 2; overflow: hidden"
  ></div>
  <figcaption>
    2026 年搜索量同比增长 18%，增长主要来自移动端。
  </figcaption>
</figure>
```

外部样式可以继续决定视觉样式；但 PR-1 的纯静态 Validator 只接受槽位自身
`style` 中可机械读取的固定高度或 `width + aspect-ratio`。它不猜测任意 CSS
级联、utility class 或计算样式，避免把 v0.1 变成无限 CSS 兼容器。

### 7.2 必须满足

- 文档声明一个受支持的 Profile 版本；
- 每个槽位有唯一 `id` 和稳定 `data-report-key` 所属语义组件；
- `data-report-visual-slot="fixed"` 只标记真实图表 mount 元素；
- 槽位在脚本前已经有非零、有限、可见的源码几何；
- 槽位在源码中明确声明固定高度、相等的 `min-height + max-height`，或
  `width + aspect-ratio`；PR-1 不从外部 CSS 级联推断该事实；
- 作者脚本只能增加、删除或更新槽位后代，不替换槽位自身；
- 脚本前后槽位的 border box 必须保持一致；
- 所有视觉绘制被槽位裁住，不依赖 `overflow: visible` 显示关键标签；
- 槽位不能嵌套、重叠，也不能使用 `position: fixed/sticky` 作为页面级视觉；
- 图表标题、图注、关键数字和文字结论存在于 source-backed HTML；
- 重要业务数据不能只存在于 Canvas 像素中；至少有源码摘要或可访问描述；
- 运行库和数据应内嵌或使用 Profile 声明的相对资源；
- Tab、折叠区只使用 Profile 允许的声明式 PageViewContext 状态。

### 7.3 明确不合规

- 运行后给槽位设置新高度或依赖内容撑高；
- 在空容器中生成整张表、正文、卡片列表或报告章节；
- 用脚本替换带有 Profile 身份的宿主；
- 图表内容跨越槽位边界、覆盖正文或依赖全局浮层；
- 多个槽位共享一个无法独立确定几何的画布；
- 通过网络接口取得关键数据后才决定布局；
- 需要执行任意页面点击才能完成首次绘制；
- 只有运行态选择器、脚本变量或库实例能够定位图表，源码没有稳定宿主。

### 7.4 旧页面兼容入口

V1 可以在没有 Profile 标记的页面中识别以下候选，但其等级低于 Profile：

1. 源码直接 Canvas/SVG 根，且源码与运行几何一致；
2. 源码为空、有唯一稳定身份和非零固定尺寸，运行后包含可见 Canvas/SVG 的宿主；
3. 宿主在脚本前完成绑定，运行后仍是同一个 `Element`；
4. 不使用脚本因果、库名、computed selector 猜测或运行时向上寻找任意祖先；
5. 任意歧义、替换、嵌套、尺寸变化或溢出都取消该候选。

兼容入口不得通过修改用户源码自动添加 Profile 标记。显式迁移属于未来独立功能，
必须由用户选择并作为完整候选审阅。

### 7.5 PR-1 当前边界

PR-1 已将 Profile v0.1 冻结为 source-only Validator，但 Phase 0 对原生 overlay
的 pointer/IME 穿透和可见 WindowServer 合成结论为 No-go。因此 `profile-fixed`
目前只是静态候选等级：它不改变 Edit、不会执行作者脚本，也不会自动显示运行视觉。
完整证据见 [Phase 0 evidence](INLINE_RUNTIME_VISUALS_PHASE0_EVIDENCE.md)。

## 8. 用户体验

### 8.1 打开页面

1. Edit 源码表面先按当前路径正常显示，不等待运行页；
2. 桌面端在后台校验固定槽位并启动一个隔离视觉 generation；
3. 每个槽位独立通过身份、绘制和几何门禁后自动原位出现；
4. 不显示要求用户点击的遮罩、侧栏或“启用图表”按钮；
5. 不支持或失败的槽位保持源码原状，不阻塞整页。

### 8.2 加载与失败状态

| 状态 | 页面表现 | 用户操作 |
| --- | --- | --- |
| `not-applicable` | 普通静态 Edit，无额外状态 | 无需操作 |
| `starting` | 保留源码背景/空宿主，不显示旧图或截图 | 可立即编辑 |
| `visible` | 真实 Canvas/SVG 在原位显示 | 可点击整个槽位、编辑周围文字 |
| `invalidated` | 立即隐藏不再精确的运行视觉 | 完成当前编辑后自动重新评估 |
| `failed` | 静态 Edit；槽位被选中时可见简短诊断 | 可继续编辑或进入 Preview |
| `suspended` | 本次 Edit 会话超过失败或重建预算，保持静态 | 下一个明确文档/Edit 边界重新资格判断 |

普通成功不增加全局状态条。失败不弹阻塞 Toast；只有用户选中空槽位或打开兼容性
诊断时，才显示“动态图表未在编辑状态显示”的原因码和“在预览中查看”入口。

### 8.3 点击、选择与评论

- 运行层 `pointer-events: none`；
- Profile 槽位在 Edit 命中模型中是原子目标；
- 点击运行时柱、线、点、图例或空白处都选择整个源码槽位；
- 选中工具条说明“动态图表 · 只读视觉”；
- 评论锚定槽位的源码 TargetRef，不保存运行坐标或库对象 ID；
- 图表外 source-backed 标题、图注和正文继续精确选择；
- 源码原生 SVG 子元素可沿用现有源码身份，运行时生成的 SVG 子元素不能获得身份。

### 8.4 编辑与刷新

源码变化包括文字检查点、样式修改、移动、撤销/重做、AI 候选应用、外部重载和版本
切换。自动保存只是相同 HTML 的持久化，不构成新视觉 generation。

V1 规则：

1. Edit DOM 中任一已显示槽位的几何开始漂移，立即隐藏该槽位；
2. 接受新的 SourcePatch 后，旧 Source SHA 的所有运行视觉失效；
3. IME composition 或原位文字编辑会话仍活跃时，不连续重建运行页；
4. 原位文字编辑结束、当前 HTML 已被 Canvas acknowledgement 证明后，只启动一次
   新 generation；
5. 样式连续输入或拖动按一个稳定操作 burst 合并；
6. 不保留旧视觉等待新视觉，不显示跨 SHA 的 stale 结果；
7. 超过重建频率或失败预算时，本次编辑会话保持静态，直到下一个明确边界。

这意味着：导致页面换行或重排的编辑过程中，相关图表可能暂时隐藏；编辑结束后自动
恢复。V1 不以持续双页面同步换取“输入每一个字时图表也永不消失”。

### 8.5 Preview

- Preview 继续执行完整作者交互；
- hover、tooltip、缩放、图表内部点击、作者 Tab handler、下载和媒体行为不进入 Edit；
- 从 Edit 进入 Preview 时销毁或暂停 Edit 视觉运行页，避免同一文档重复运行；
- 从 Preview 返回 Edit 只恢复现有有界 PageViewContext，再创建新的精确视觉
  generation；
- Preview DOM 和 Edit 视觉 generation 都不得进入 SourcePatch 或持久化。

## 9. 兼容等级与诊断

### 9.1 等级

| 等级 | 定义 | 默认行为 |
| --- | --- | --- |
| `profile-fixed` | 显式 Profile 固定槽位且全部静态条件通过 | 当前保持静态；未来实现仍需独立复审 |
| `legacy-fixed` | 无 Profile，但通过窄历史宿主规则和运行几何门禁 | 当前不启用 |
| `static-only` | 没有运行视觉，或运行能力不可用 | 保持当前 Edit |
| `preview-only` | 动态布局、运行正文、交互依赖或不安全资源 | Edit 静态；Preview 中查看 |

### 9.2 诊断与 Candidate Assessment 分离

固定槽位诊断属于显示兼容性，不参与 AI Candidate 接受、Version 激活或历史结果。V1
只输出独立的内存报告；若未来允许用户手动导出，必须另立产品与持久化合同。报告至少
包含：

- Profile 合同版本；
- 完整 Source SHA-256；
- 文档级兼容等级；
- 每个源码槽位的稳定业务键和诊断码；
- 是否满足源码身份、固定几何、非嵌套、非溢出、资源和可访问性条件；
- 不包含运行 DOM、像素、业务文字、文件路径、评论内容或库运行状态。

建议诊断码：

- `VISUAL_SLOT_READY_PROFILE`
- `VISUAL_SLOT_READY_LEGACY`
- `VISUAL_SLOT_IDENTITY_AMBIGUOUS`
- `VISUAL_SLOT_SOURCE_GEOMETRY_EMPTY`
- `VISUAL_SLOT_RUNTIME_GEOMETRY_CHANGED`
- `VISUAL_SLOT_REPLACED`
- `VISUAL_SLOT_NESTED_OR_OVERLAPPING`
- `VISUAL_SLOT_PAINT_OVERFLOW`
- `VISUAL_SLOT_NO_CANVAS_OR_SVG_PAINT`
- `VISUAL_SLOT_DYNAMIC_DOCUMENT_FLOW`
- `VISUAL_SLOT_RESOURCE_UNAVAILABLE`
- `VISUAL_SLOT_RUNTIME_TIMEOUT`
- `VISUAL_SLOT_RUNTIME_TERMINATED`
- `VISUAL_SLOT_UNSUPPORTED_VIEW_STATE`

## 10. 目标架构

### 10.1 数据流

```text
Authoritative Source HTML
  -> SourceIndex / fixed-slot profile validation
    -> script-disabled Edit Source Surface
       -> SourcePatch / Selection / IME / comments / save

Authoritative Source HTML + exact declared assets
  -> isolated disposable visual runtime
    -> trusted pre-script slot bindings
    -> bounded readiness + slot geometry/paint facts only

Edit slot geometry + runtime slot geometry + exact generation identity
  -> fail-closed geometry admission
    -> parent-owned multi-rectangle mask
      -> pointer-transparent Inline Runtime Overlay
```

禁止的数据流：

```text
runtime DOM / runtime HTML / table rows / Canvas bytes / PNG / Blob
  -X-> Edit DOM / SourcePatch / save / Version / Review analysis / AI Request
```

### 10.2 单向所有权

| 事实 | 唯一 owner | 生命周期 | 消费者 |
| --- | --- | --- | --- |
| Source HTML、revision、Canvas generation | 现有 `DocumentSession` | 当前文档 | Edit、视觉会话输入 |
| Profile 槽位静态资格 | 纯解析器/Validator | Source SHA | Edit 视觉会话、诊断 |
| 当前视觉 generation、状态、预算和取消 | 新的 `InlineVisualSession` | 当前 Edit 文档 | Workbench 只读投影 |
| 隔离运行页、权限、终止和声明资源 | 桌面运行 owner | 单 generation | 原位视觉层 |
| Edit 槽位 DOM 和 TargetRef | `HtmlCanvasEditor` | Canvas generation | 选择、评论、几何 Port |
| 最终可见槽位矩形 | 可信父级几何 admission | 单 presentation epoch | 原位 mask |
| Preview 完整交互 | 现有 Preview session | Preview mode | Preview iframe |

`workbench.tsx` 仍是 composition root，不成为视觉生命周期 owner。新状态必须由可独立
测试的 Session/owner 管理；React effect 只连接 DOM、订阅和 Port。

### 10.3 最小运行报告

运行页只能通过受挑战的私有通道向可信宿主报告固定 schema：

```ts
type InlineVisualRuntimeReport = {
  contractVersion: 1;
  visualGeneration: string;
  sourceSha256: string;
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

`bindingId` 由可信 pre-script bootstrap 生成，不以作者可写的 key 作为最终权威。报告
不携带 DOM 路径、selector、computed styles、图表配置、数据、文字、截图或脚本异常
堆栈。最终生产字段以安全审查后的 schema 为准，但权限不得扩大。

### 10.4 几何 admission

只有同时满足以下条件才显示一个槽位：

- 文档、Source SHA、Canvas generation、视口和 PageViewContext generation 当前；
- 源码 TargetRef 唯一，Edit 槽位仍连接到当前 instrumented source node；
- 运行页在作者脚本前绑定同一源码宿主，作者脚本后仍为同一 `Element`；
- Edit 与 runtime 的 x/y/width/height 在冻结容差内一致；
- 两次稳定测量之间没有 resize/mutation 造成的宿主几何变化；
- 槽位非零、有限、在文档范围内，不嵌套、不重叠；
- 可见 Canvas/SVG paint 完全包含于槽位裁剪范围；
- 最终 mask 使用可信 Edit content box，不接受作者页提供的任意裁剪 path；
- scroll、resize、字体或 PageViewContext 变化后重新校验，校验前隐藏。

容差、稳定窗口和测量次数必须在技术可行性阶段用浏览器/Electron 证据冻结，不能通过
扩大容差来适配失败样例。

## 11. 生命周期

### 11.1 状态机

```text
off
  -> eligible
    -> starting(generation)
      -> visible(generation)
      -> failed(generation)

visible(generation)
  -> invalidated(source/layout/view/viewport)
    -> starting(next generation)
    -> suspended

starting/visible/failed
  -> stopped(project switch / Preview / History / close / owner termination)
```

### 11.2 不变量

- 一个当前 Edit 文档最多一个 active generation；
- V1 不保留可见旧 generation，不双缓冲；
- 迟到、重复、未知、超时或不同 SHA 的报告直接丢弃；
- `failed` 不自动无限重试；只有新的精确稳定边界可以产生下一 generation；
- 运行会话不是持久化事实，不进入恢复记录；
- 运行会话不阻塞 save、switch、submit、close、history 或 Version；
- owner dispose、renderer reload 和应用退出都必须清理会话；
- 仅协议 Session TTL 作为泄漏兜底，不作为正常生命周期管理；
- 不建立 PageRoot 视觉缓存。浏览器内部普通资源缓存不成为产品状态或复用承诺。

## 12. 安全与资源政策

自动运行发生在用户进入 Edit 时，比主动进入 Preview 更敏感。生产启用前必须证明：

- 作者页与应用 renderer、preload、Node 和 Bridge 完全隔离；
- 作者页不能读取源路径、TargetRef、评论、项目身份或应用状态；
- 无任意网络、文件、导航、弹窗、下载、权限、webview 和持久存储；
- 只提供内嵌内容和显式声明、路径包含验证通过的相对资源；
- 顶层导航或 frame 替换立即使视觉 generation 失效；
- 无限循环、内存膨胀、长期微任务或崩溃可以终止对应运行环境，不冻结 Edit；
- 运行超时和预算由可信 owner 的时钟控制，作者 promise/timer 不能延长；
- 几何绑定和报告通道不能被作者脚本伪造或接管；
- 运行页没有截图、读取屏幕或把像素返回应用的能力；
- 任何资源或权限新增都需要独立 Security Model、依赖和打包审查。

### 12.1 图表库版本和远程资源

- HTML 内嵌哪个库版本，就运行哪个版本；
- PageRoot 不把 ECharts 5.x 替换为 6.x，也不维护 API 适配器；
- 声明的安全相对资源通过现有受限预览资源机制解析；
- V1 核心不访问远程 CDN；
- 如需支持历史精确 CDN URL，必须由独立资产注册表把“规范 URL + 精确内容 Hash”
  映射到应用内同字节资产；
- 每个新增映射都是独立依赖、许可证、包体和供应链决策，不是通配符；
- 未映射版本只影响对应槽位，不能迫使 PageRoot联网或升级用户源码。

## 13. 功能需求

### 13.1 P0 必须满足

| ID | 需求 |
| --- | --- |
| FR-01 | 支持的固定槽位在进入桌面 Edit 后自动启动，不要求用户点击 |
| FR-02 | 静态 Edit 首先可用，运行视觉不得阻塞首屏、编辑或评论 |
| FR-03 | 每个可见槽位必须通过精确身份、Source SHA 和几何 admission |
| FR-04 | 运行层完全 pointer-transparent，源码槽位是原子选择目标 |
| FR-05 | 运行视觉不进入 SourcePatch、save、Version、Review 源码分析或 AI Request |
| FR-06 | 当前源码、视口或 PageViewContext 失配时立即隐藏相关视觉 |
| FR-07 | 原位文字编辑和 IME 活跃时不形成连续重建循环 |
| FR-08 | 不支持、失败、超时和崩溃均降级为可继续使用的静态 Edit |
| FR-09 | 同一文档最多一个运行页，不按槽位复制页面 |
| FR-10 | 不管理视觉结果缓存，不保留跨 SHA 的可见旧结果 |
| FR-11 | Preview 继续是唯一完整交互表面 |
| FR-12 | Profile 和兼容诊断使用固定原因码，不通过猜测扩大范围 |

### 13.2 P1 应满足

| ID | 需求 |
| --- | --- |
| FR-13 | 支持安全 Tab/折叠 PageViewContext 后的可见槽位重建 |
| FR-14 | 提供不含内容的槽位兼容性诊断视图 |
| FR-15 | 支持一小类 `legacy-fixed` 空宿主和直接 Canvas/SVG |
| FR-16 | 对 resize、DPR 和字体稳定过程提供可重复的隐藏/恢复行为 |
| FR-17 | 支持无障碍名称、图注和源码摘要的 Profile 诊断 |
| FR-18 | 提供受限、无内容的成功率、耗时和失败码遥测（若用户已允许遥测） |

### 13.3 未来但不属于 V1

- 显式用户迁移旧 HTML 到 Report HTML Profile；
- PageRoot 可信 declarative ChartSpec renderer；
- 动态高度槽位的独立产品与架构评估；
- 图表数据点级语义评论；
- 离线资产包扩充和用户管理；
- History 只读视觉和 Review 视觉的一致显示策略。

## 14. 非功能要求与预算

最终数值预算必须在执行规划 Phase 0 用参考设备和合成 fixture 冻结。V1 至少满足：

| 维度 | 硬要求 |
| --- | --- |
| 源码保真 | 所有支持/失败路径的源 HTML 字节完全不变 |
| 正确性 | 已显示槽位的错误宿主、错误 generation 和错误裁剪数量为 0 |
| 会话 | 每文档最多 1 个 active 运行页；无后台遗留会话 |
| 缓存 | PageRoot 管理的视觉结果缓存条目数为 0 |
| 输入 | Selection、IME、撤销、评论命中和 SourcePatch oracle 与基线一致 |
| 安全 | 运行页无网络、文件、Bridge、Node、导航和持久存储能力 |
| 故障隔离 | 无限循环、崩溃和超时不冻结或终止 Edit 源码表面 |
| 性能 | 支持样例在预算内首绘；连续编辑不产生无上限重建或内存增长 |
| 可观察性 | 只有状态、计数、时长和原因码；无内容、路径、文件名和异常堆栈 |
| 降级 | 任何能力不可用时，现有 Edit/Preview/Review/Version 流程仍可完成 |

建议 Phase 0 冻结以下上限：单页 HTML/脚本字节、槽位数量、首次 ready 时间、几何
稳定时间、运行 DOM 节点数、重建速率、每分钟失败数、CPU 预算、内存预算和 owner
终止时间。未经测量不得用宽松默认值进入生产。

## 15. 验收场景

### 15.1 正向

1. Profile 固定 Canvas 槽位打开后自动原位显示；
2. Profile 固定 SVG 槽位自动显示；
3. 同页多个固定槽位只执行一份页面；
4. 点击任意图形只选择对应源码槽位的大框；
5. 图表标题和图注仍可精确选择、编辑和评论；
6. 文字编辑不改变布局时，视觉生命周期符合冻结策略；
7. 文字换行导致槽位移动时，旧视觉先隐藏，稳定后恢复；
8. resize 后只在两页几何重新一致时显示；
9. 进入 Preview 后获得完整图表交互，返回 Edit 后重新建立精确 generation；
10. 源码相对资源在显式清单内时离线显示。

### 15.2 负向与故障

1. 重复 ID、歧义 TargetRef、宿主被替换：不显示；
2. 运行后高度变化、动态表格扩展、正文重排：不显示；
3. 嵌套或重叠槽位：不显示冲突槽位；
4. 图形溢出槽位：裁住或判失败，不扩大 mask；
5. late font/image 导致几何变化：稳定前不显示；
6. 作者导航、弹窗、下载、网络和存储请求：拒绝且不影响 Edit；
7. 无限循环、崩溃、超时：owner 终止，Edit 继续；
8. 迟到旧 SHA/旧 generation 报告：丢弃；
9. 快速项目切换和关闭：没有遗留运行页或迟到投影；
10. 连续 IME 输入、撤销/重做和样式拖动：不产生刷新风暴；
11. 未解析的远程库版本：对应槽位静态，不访问网络；
12. 浏览器弱能力模式：维持当前静态行为，不伪装支持。

## 16. 发布与兼容策略

1. 技术可行性阶段只用合成 fixture 和本地实验开关；
2. 第一生产阶段仅对 `profile-fixed` 开启；
3. `legacy-fixed` 必须单独灰度，并按原因码观察误判率；
4. 未通过 Profile 的现有页面不会被自动重写；
5. 新建/AI 生成报告逐步采用 Profile 固定槽位；
6. 任何默认启用都必须建立在打包后的 Electron、安全和性能证据上；
7. 该功能不改变文件格式和持久 Schema，回滚应恢复为当前静态 Edit；
8. 正式发布前同步更新现行 MVP、Architecture、State Ownership、Security、
   Interaction Flow、Runtime Visual Contract、测试策略和兼容登记。

## 17. 成功指标

在不收集页面内容、文件名或路径的前提下，评估：

- `profile-fixed` 槽位自动可见率；
- `legacy-fixed` 准入率和运行后拒绝率；
- 几何不一致、资源不可用、超时和终止原因分布；
- 首次可见耗时分位数；
- 每个编辑会话的 generation 创建次数；
- 运行页峰值内存/CPU 预算违规率；
- 因运行视觉导致的 Selection、IME、评论或 SourcePatch 回归数，目标为 0；
- 错误裁剪、错误宿主和 stale generation 可见事件数，目标为 0；
- 进入 Preview 仅为“看见图表”的比例是否下降。

遥测仍遵循现有 opt-in 和属性 allowlist；不允许记录 HTML、业务数据、标题、图表库
配置、URL、路径、文件名、异常文本或截图。

## 18. 主要风险

| 风险 | 后果 | 控制 |
| --- | --- | --- |
| 自动脚本与应用共享故障域 | 死循环冻结编辑器 | Phase 0 必须证明进程/任务可终止，否则 No-go |
| 双页面字体或布局漂移 | 图表错位或露出错误区域 | 固定槽位、精确几何、稳定窗口、失配隐藏 |
| 为无闪烁引入双会话 | 生命周期和缓存膨胀 | V1 明确允许静态间隙，禁止双缓冲 |
| 为旧页面增加特殊规则 | 兼容分支失控 | Profile 优先、机械 legacy 规则、独立诊断码 |
| 图表内部看似可编辑 | 用户预期错误 | 原子大框选择和“只读视觉”说明 |
| 动态高度诱发正文同步 | 第二布局权威 | V1 明确拒绝，推动源码 Profile 化 |
| 远程依赖不可用 | 支持率下降 | 内嵌/相对资源优先，精确资产映射独立决策 |
| 运行页持续动画耗能 | CPU/电量上升 | 单页预算、可见性策略、owner 终止和速率上限 |
| 作者脚本伪造几何报告 | 错误投影 | 可信预绑定、私有通道、父级 Edit rect 最终裁剪 |
| 功能侵入保存/关闭 Drain | 核心流程变脆 | 运行视觉明确无持久状态、无 Drain 义务 |

## 19. 全局止损条件

出现任一情况，停止扩大原位视觉并回到 Profile/源码规范化方向：

1. 无法证明作者脚本可独立终止且不会冻结 Edit；
2. 必须打开任意网络、文件、Bridge、Node 或持久存储能力；
3. 必须复制运行时 DOM、Canvas 像素、PNG、Blob 或视频流；
4. 必须建立旧视觉缓存、LRU、双 generation 可见性或 stale-while-revalidate；
5. 必须按图表创建多个完整运行页；
6. 必须分析任意 JavaScript 因果或维护库版本 API 适配器；
7. 必须支持动态高度、运行正文、动态表格或任意页面重排才能达到首发目标；
8. 必须转发作者事件或建立 Edit/Runtime 双向状态同步；
9. 必须为运行时子元素创建新的持久 TargetRef/评论定位模型；
10. 支持样例只能靠扩大几何容差、页面特判、删除断言或放松 fail-closed；
11. 任何路径可能改变源 HTML 字节或进入 save/Version/Review/AI 输入；
12. 性能、会话泄漏、IME、Selection 或评论回归不能被稳定复现和消除。

## 20. 未决问题

以下问题由配套执行规划的技术可行性阶段冻结，不得在 PRD 中假装已经解决：

- Electron 当前架构下，哪种显示宿主能同时满足多矩形裁剪、pointer pass-through 和
  独立可终止；
- 可信 pre-script Element 绑定和私有几何通道是否能在可见运行页中成立；
- 多矩形 SVG/CSS mask 在滚动、缩放、DPR 和圆角边框下的准确性；
- 当前外层滚动模型能否让两页自然共享坐标，还是需要一个窄 scroll Port；
- 几何容差、稳定窗口、首次 ready、CPU、内存和重建速率的具体预算；
- Profile v0.1 的最终属性名、Schema 和 Validator 报告格式；
- `legacy-fixed` 是否默认开启，还是只在开发者/灰度通道启用；
- 第一批精确离线资产是否需要包含某个 ECharts 版本；
- 安全 PageViewContext 切换是重建 runtime，还是由可信 bootstrap 应用同一有界状态；
- History 是否永远静态，或在 V1 稳定后增加单独只读视觉能力。

## 21. 产品完成定义

固定视觉槽位 V1 只有在以下事实同时成立时才算完成：

- 支持槽位进入 Edit 后自动原位可见，无需用户点击；
- Source HTML、SourcePatch、Selection、IME、评论、撤销、保存和 Version oracle 全部
  保持；
- 每文档一个运行页、PageRoot 视觉缓存为零、运行 DOM/像素传输为零；
- 固定 Profile、机械 legacy 兼容和 preview-only 边界可以被 Validator 解释；
- 错误裁剪、错误宿主和 stale generation 可见数为零；
- 不支持、超时、崩溃和权限拒绝均静态降级且不阻塞核心流程；
- 安全、性能、生命周期、打包和真实 Electron 门禁通过；
- 所有现行规范和状态所有权文档与实现一致；
- 不存在临时双写、兼容特判、未回收会话或“以后再删”的缓存路径。
