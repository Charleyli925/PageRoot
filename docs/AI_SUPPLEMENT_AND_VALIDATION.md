# 源页：内部 AI 对话补充与候选校验（已实现）

- 实现版本：PageRoot 0.9.6
- 日期：2026-08-02
- 状态：已进入代码、Schema、历史记录与打包验证

## 1. 内部 AI 对话里的增量要求

本轮有效要求由两部分组成：

1. 源页发送时冻结的原始评论与本地编辑；
2. 用户随后在 QoderWork 对话里新增、修订或撤回的要求。

第二部分不能直接改写冻结 Request。Prompt 要求内部 AI 先调用受控 helper，把用户原话写入当前 Attempt 的 `USER_SUPPLEMENT.json`，成功后才能执行。记录失败时必须停止执行该条补充。

记录采用追加式 `add / amend / retract`，旧记录不能覆盖。`add` 可通过 `refersTo` 指明它补充的原始 instruction；修订会替代被引用的旧 supplement，撤回会从最终有效要求中移除被引用记录。能够取得的原始文件会复制到 `supplement-attachments/` 并记录 SHA-256；只能看见、无法取得原件时记录 `description-only`，历史中明确显示“原件未归档”。finalizer 会先封存补充记录和附件 Hash，再生成完成记录。Attempt 结束后新增要求必须建立新 Request。

这套机制是项目协议，不是聊天平台同步：源页只确认受控记录成功，不能证明剪贴板内容已经被 AI 平台接收，也不能证明平台内每条对话都被遵守。

## 2. 候选校验分级

不可忽略的硬校验包括：

- 项目、文档、Request、Attempt、Version 身份；
- 冻结输入、输出、completion、manifest、commit marker 的 Hash；
- 完整 HTML、受管路径、普通文件与无路径逃逸；
- supplement 封存、引用、附件与 Hash；
- 管理元信息；
- 事务、工作副本与版本完整性。

完成记录和规范化比较通过后，Bridge 生成 `candidate-assessment.json`。它只回答两个
产品问题：返回的是不是完整、可显示的 HTML；它是否大体继承了上一版。脚本、inline
handler、可执行 URL 和 refresh 指令都属于候选内容，不参与检测、分级或用户提示。
连续性证据来自可见文字、稳定 id/data 属性、class、资源引用和 title，属于
粗粒度启发式，不宣称逐节点证明。

评论 TargetRef 和有效 supplement 继续指导 AI、审阅与历史解释，但不再授权或禁止某个
DOM 子树之外的普通正文、属性、结构或样式变化。这样可以避免 AI 把 `<p>` 改为 `<div>`、
重组卡片或同步调整相关样式时被误判为失败。连续性证据充分为 `ready`；证据不足但 HTML
可用为 `attention`，保留同一不可变候选并要求先审阅；不完整或空 body 为 `blocked`，
不创建 Version。

## 3. 结果审阅与打开方式

AI 结果通过校验后先创建不可变 Version 和独立 working HTML，运行态进入 `ready-to-open`：

- 左侧仍显示原来的当前 HTML；
- 原始评论和本地编辑继续锁定并保留；
- 重启应用后仍恢复“可打开”状态；
- `ready` 候选显示“审阅对比”和“直接打开”，默认突出“审阅对比”；`attention` 候选只显示“审阅对比”；
- “审阅对比”只读取冻结 HTML 与不可变 AI 候选，不激活候选；正式审阅页把 `页面预览`、`变化审阅`、`上下文可见度`、`内容地图定位`、`页面运行态`、`滚动方式` 和 `画布缩放` 保存为正交状态。默认是“双页 + 全部变化 + 18% + 同步滚动 + 适应”，各入口只修改自己的状态（筛选切换后当前定位已不匹配时可一并移到首处匹配变化），单页与双页都尽量铺满 Canvas；
- 内容地图导航区域与 canonical change footprint 分离。分析器先建立高置信度节点配对，再按混合行内节点的语义文本流生成字符级文案增删证据；纯增删在无证据侧只保留不可见定位锚点。字符证据与可读范围解耦：删除字符使用红色横虚线穿过被删的字，新增字符在每个字下显示绿色实点；标记不得改变作者颜色、字号、字重或行距，绿点禁止用 `text-emphasis` 实现。范围框在真实布局中按短语、完整行和最小段落逐级判断。短语框的可读最小宽度按文字自身字号（1.5em，下限 16px）而不是行盒高度计算，以免宽行距下两字的修改被撑成三字宽、切进两侧未改动的字。同一行至少三个变化短语或首尾证据跨度达到可见文字宽度 60% 时使用完整行矩形；同一 owner 至少三行且至少 75% 的行满足该条件时使用最小段落矩形。所有文字范围框均为低强调紫色实线、干净轴对齐长方形，必须包含全部字符证据，并与遮罩孔使用完全相同的坐标和尺寸；不使用密度/稳定句的另一套提升规则，也不把细碎 rect 描成锯齿轮廓。仅排版的行内标签与 `br` 不算结构事实。其余结构事实只来自未配对/移动结构，视觉事实只来自已配对节点的呈现差异，禁止用同标签/位置兜底制造变化。静态 footprint 未覆盖的受支持源码宿主可走有界 Runtime Snapshot 补充：SourceHostResolver 仅从 SourceIndex/TargetRef 配对直接 Canvas/SVG 或 source-empty 稳定宿主，不分析脚本因果、computed selector、评论范围或运行时猜测节点；只有同一精确 source host 在两侧都有同 geometry owner 且同 scope 的 canonical `box` style fact 才抑制候选，同 outline 的其他事实不算覆盖。静态页就绪后，可信父级向唯一 owner 提交冻结 HTML、完整 source SHA、侧别、视口和绑定；owner 先重验源码绑定，再在 isolated world 确认同一宿主及可见 Canvas/SVG paint，并只采用已稳定的一帧 PNG：固定延时后的单帧不构成证据，因为图表库在那个时刻前后完成绘制会让同一张未变图表的两侧得到不同完成度的栅格；只有连续两帧的 PNG SHA 与布局尺寸完全一致才接受，尝试次数有界且仍从属于 owner deadline，始终不稳定则该候选静默保留静态结果。单个 before/after pair 的 PNG 尺寸差异直接成立；字节差异则必须是结构性的，即强差异像素（单通道 ≥ 28/255）占比达到 2%，才按 `{candidateKey, changeId}` 补充精确宿主 fact，outline 仍只负责导航；同一张未变图表在不同页面位置会因 crop 相位不同而处处小差、处处不大差，这种弥散差异既不证明变化也不证明未变，归入 unverified（疑似有改动）而不得宣布为视觉调整；crop 矩形按最近整像素取得，不得 floor 原点而 ceil 尺寸。任何 unavailable、超时、迟到、预算或验证失败都静默保留静态结果，没有第二轮 fresh-pair confirmation 或用户状态。每侧首个 bootstrap 私有绑定 key 到原始 `Element`，父级再经与评论分离、受随机 challenge 和 `sessionId + side + sourceSha256` 约束的端口交付结果；运行态 `Map<Element, facts[]>` 与静态 facts 加法合并，empty/cleanup 不删除静态事实，目标替换、断连或 fingerprint 漂移也不回退 outline。评论定位仍是 before-only 的独立私有能力，不能参与 Runtime Snapshot 候选发现。每个语义变化组只显示一个标签；文字范围不与结构或视觉事实融合为 shaped 框，其他类型仍只融合同事实、同 owner 的强重叠框；内容地图包含未修改区域并按页面 Tab 分组；
- 评论标记定位补充（取代上项中“仅接受稳定 selector”的限制）：每个可由冻结源投影解析的非全局 TargetRef 都只在会话私有的首个 bootstrap 响应中携带 `sourceNodeId` 绑定：元素 child-index 路径加窄静态指纹，绝不写成目标临时属性或 HTML 配置。桌面受管预览只把该响应交给解析器阻塞式的第一次 bootstrap 请求，随即切换为无绑定回退源码；父级随后仅经私有端口发送评论 key→`sourceNodeId` 的映射。这样即使目标只是 class-only 普通元素、作者又插入或重排同标签兄弟，只要路径失效后仍唯一匹配私有指纹，标记仍锚定原元素。唯一 `id`、`data-*`、`name` 或 `aria-label` 只在私有绑定不可用时作为安全回退，绝不使用位置路径；缺失、歧义、替换、脱离文档或私有端口不可用均不显示标记。评论正文、评论 key、`sourceNodeId` 与完整映射不会留在作者可读取的 HTML 或后续抓取的 bootstrap 源码中。评论 challenge 由首个受管 capture listener 先校验并 `stopImmediatePropagation`，作者 capture listener 看不到 challenge，也无法抢先伪造端口。
- 运行态 Snapshot 身份补充：源码宿主 TargetRef 与 PNG 只存在可信 renderer/owner 窄请求，不进入审阅页。候选 key、路径和完整窄 fingerprint 只进入首个 parser-blocking bootstrap 的闭包与受挑战的私有 runtime-projection port；它们不写入 authored HTML、DOM 属性、普通窗口消息、后续 bootstrap、overlay 属性或截图。bootstrap 在作者脚本前捕获精确 `Element`，之后只接受该引用仍连接且 fingerprint 未漂移的 geometry；缺失、歧义、替换或断连时仅该候选静默保留静态审阅。可信 renderer 验证 PNG bytes、尺寸、SHA-256 和预算后，只比较一次 before/after pair；没有确认 session、状态 UI 或 Retry。
- 内容地图和上一处/下一处只揭示 Tab、定位并更新活动说明，不改变页面、筛选、可见度或缩放。两份冻结文档的安全 action 成对映射，Tab、折叠、业务按钮和表单状态始终双向同步，独立滚动只关闭滚动联动；同步失败静默降级，不增加提示。同步滚动使用单一输入主控、稳定语义映射与每帧最新目标，快速反向或换侧会撤销旧代次，短页触底不强拉长页；锚点、框选和评论测量不进入滚动热路径。框选在动作、DOM/尺寸变化和字体完成后自动刷新，不依赖内容地图触发；
- 审阅画布允许原页面 Tab、折叠区等纯页内交互在隔离沙箱中运行，但禁止导航、提交、弹窗、下载和宿主 IPC，运行态变化不会保存；
- 审阅页不显示 Demo 标记；“返回 AI 修改前”逐行说明不采用本次返回、继续以修改前版本为基线，以及 AI HTML 保留，并允许直接打开本轮文件夹；确认后直接恢复原 HTML 编辑，评论和编辑记录不变，候选文件与记录不删除；
- “打开 AI 修改后”说明修改前版本与本轮记录仍保留，最终按钮为“确认并打开”；确认后不显示等待 AI 页面，先挂载编辑画布再调用既有激活事务；
- 只有 `ready` 用户点击“直接打开”，或任一可审阅候选在审阅页确认“打开 AI 修改后”，项目当前路径和左侧画布才切换；
- 点击前如果当前源文件被外部改动，系统拒绝切换并保留新 Version。

审阅投影中，框与上下文遮罩消费同一组最终 canonical footprint records。每一页的遮罩使用以 session、side 和 projection epoch 唯一命名的 SVG luminance mask：整页白色背景保留虚化，每个 canonical path 作为黑色透明孔；因此相交的独立事实始终取几何并集，不能再用 `evenodd` 让交集重新变暗。受管 mask 背景、孔和 dim rect 会隔离作者 `svg path`、`mask rect` 与通用 `path/rect` 的 fill、stroke、opacity、filter、transform 污染，但仍保留用户选择的上下文可见度。

## 4. 历史展示

每个 AI Version 按四组展示：

- 源页原始评论；
- 内部 AI 对话补充；
- 本地编辑；
- AI 结果与校验（包括 candidate assessment；旧版可含 validation review）。

Version manifest 仍保持不可变；历史通过其 `requestId + attemptId` 定位同一 Attempt 下的 supplement 和 candidate assessment。旧 `validation-review.json` 只读兼容，不再由新 Attempt 写入。

2026 年 8 月的短期 Developer Preview assessment 曾省略或写入现已退役的可执行表面
字段。历史 Version 查询或已归档终态查询会先核对冻结 base、不可变候选证据和四个 Hash，
再按当前文档健康与连续性规则重算，并把移除退役字段和脚本结论的结果作为内存投影；旧
Attempt 不改写，归档 outcome 不复活。

失败或 no-change 后，本轮处理页只有“返回编辑”。退出不会自动打开某条评论，也不会清除
outcome；workspace 返回最近终态，标题栏“上轮处理”可在退出后或重启后重新打开。开始
冻结下一轮 Request 时，才把这个入口更新为新一轮。
