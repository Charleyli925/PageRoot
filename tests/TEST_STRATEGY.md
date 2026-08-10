# PageRoot 自动化测试策略

目标不是增加测试数量，而是在尽量短的反馈时间内发现真实缺陷。所有活动门禁都必须无人值守：不等待真人点击、输入、观察、判断或把任务转交给外部模型。测试物料可以由确定性生成器产生，但判断标准必须由源码字节、Hash、状态机、DOM/几何或明确协议字段自动给出。

## 本地反馈与三道交付边界

| 门禁 | 使用时机 | 覆盖 | 目标 |
|---|---|---|---|
| `npm run gate:edit` | 一次局部修改后 | 只运行影响映射命中的 Node 文件；必要时 typecheck | 快速发现局部逻辑错误，不启动浏览器或 Electron |
| `npm run gate:task` | 一个开发任务完成时 | 静态检查、受影响 Node 文件，以及相关 Browser/Electron/AI 冒烟 | 在较短时间内证明生产链路已经接通 |
| PR `pr-feedback` | `opened/synchronize/reopened` | 按影响映射选择 Node/编译检查 | 普通推送无论 Draft/Ready 都不重复消费完整矩阵；仅切回 Draft 不产生 Feedback |
| `review-policy` | 最终 Tree 从 Draft 转为 Ready，由 Ready 唯一触发最终审阅 | 实时 head/base、post-Ready exact-commit Codex review 或不可变 clean comment、30 秒 settle window、活动非 outdated P0/P1 线程和 P0/P1 `CHANGES_REQUESTED` | 旧 head/base、未结束 review、P0/P1 阻断时不能通过；P2/P3/unclassified 写为债务而不阻断 |
| `baseline-policy` | 分支策略通过，与 review-policy 并行 | 全局依赖 advisory policy 与 packaged-runtime closure | 基线红时不启动 Linux build、Browser 或 macOS Electron runner |
| 一次性晋升 `release-gate` | review、baseline、完整测试和相关 dry run 都完成的最终 PR Tree | 全量 Node、三分片完整 Browser、独立 Native Electron、独立确定性 AI 闭环、真实 HTML 发现式门禁、即时 review revalidation 与 Tree Hash 凭证 | 每个最终候选只跑一次；后续新 SHA 必须重新 Draft 后 Ready |
| `Release Dry Run` | `candidate-context` 判定 Ready 候选有打包、release metadata、Electron、Bridge、Schema 或资源风险 | clean job 组装/静态校验显式未签名（`identity=null`）App → 非发布 checkpoint → 第二 clean job 恢复 metadata、重建 renderer oracle、再次校验并启动核对名称/版本/Bundle ID | 不读取签名或 Apple 凭证、不生成 DMG/updater、不成为 Candidate、不创建 tag、不发布；PR 大小只作建议，不作为触发或阻断 |
| `Review Debt` | 每周 trusted default-branch schedule/manual run | 汇总最近 PR 的行内线程和 review-level P2/P3/unclassified `CHANGES_REQUESTED` finding 到滚动 Issue；超出活动窗口但尚未重新验证的项以 machine-readable state carry forward | 不 checkout PR head、不改代码、不合并、不成为必需检查 |
| `main-integrity` | 合并到 `main` | 校验合并 PR、Tree Hash、package/lockfile 版本和凭证时效 | 相等即复用完整源码证据，不重复 Node、Browser 或 Electron 测试；不相等直接失败 |
| 按需 `Developer Preview` | 仅在开发者明确要求时 | 干净 Tree、最新 renderer、ad-hoc DMG、包内容完整性、一次隔离启动和精确 PR/内容交付报告 | 在消耗签名/公证时间前发现“漏打包或根本跑不起来”；不成为正式门禁 |
| `Release Candidate` | 打标签之前，凭证新鲜且 Tree/版本完全一致 | 预签名 App 内容/完整运行校验 → Developer ID 签名后启动 → App 公证 checkpoint → 从同一 App 生成并公证 DMG → 最终字节校验 | 内容错误不消耗 Apple 队列；后段失败只重跑后段 |
| `Release` | 候选包通过且不超过 72 小时 | 重新校验候选凭证和每个文件 Hash，创建 tag 并发布原字节 | 发布阶段不重新构建、不悄悄替换文件 |

本地 `release` 和完整 `artifact` 不根据改动缩减范围。`Developer Preview` 是独立的可选入口，正式 `release`、`artifact` 和 `artifact-only` 都不会自动调用它；自动部分不等待人工安装结果，开发者的短验证仅是反馈，不签发正式凭证。`artifact-only` 不是开发者手工跳过源码测试的捷径：执行器会拒绝缺少 CI 信任决定、Tree Hash 或版本不一致的调用，只允许 `Release Candidate` 在七天内成功 PR 凭证与当前 Tree Hash、版本完全一致时进入。发布工作流只接受同一 Tree/版本、已验证且 72 小时内的候选包。`edit` 和 `task` 的选择由 `tests/test-impact-map.json` 决定，模型或开发者只选择门禁层级，不临时拼接测试命令。

## 影响映射所有权

`edit` 和 `task` 按生产所有权选择直接 Node oracle：一个文件只进入它实际实现或调用的 owner；一个文件确实跨两个 owner 时，选择器安全地取两者并集。精确规则必须从通用规则中排除，不能再用宽泛目录正则把整个 Session、Workbench 子模块或 Desktop 目录绑成一个桶。新增或移动测试时，同步更新其生产 owner 的精确 `nodeTests` 列表和 `tests/test-gate-selection.test.mjs` 的选择回归；顶层 Node 测试始终至少运行自身，且本所有权基线中的 owned test 不扩张到整组。无法建立精确 owner 的代码继续走既有 `node-core` fallback。无论 edit/task 如何收窄，`release` 的完整 suite 与 prerequisite 顺序都不变。

“最新安装包”的多 PR 源码组合是打包前的 Git 流程：门禁只验证当前干净
Tree，不在测试执行期间自动合并分支。组合 Tree 含任何未合并 PR 时，
只能进入 Developer Preview 门禁，不能进入正式候选或发布门禁。

工作区有未提交修改时，`edit/task` 自动读取 staged、unstaged 和 untracked 文件。任务已经提交后应运行 `npm run gate:task -- --base <基准分支或提交>`；干净工作区又没有 `--base` 时门禁会明确失败，不会把“零测试”伪装成通过。

`npm run task:finish` 是 `gate:task -- --base origin/main` 的安全任务包装，不引入新的门禁层。`tests/task-workflow.test.mjs` 在独立临时 Git 仓库中验证分支名、干净 primary `main`、远端同步、隔离 worktree 创建、现有分支 attach、脏工作区拒绝、GitHub PR/本地独有提交分类、retire 默认 dry-run、显式放弃围栏和最终差异报告，不会操作开发者的真实分支。

PR 必须从 Draft 开始。普通推送由独立的 `PR Feedback` workflow 处理，
不会创建名为 `release-gate` 的跳过 job；因此分支保护不会把轻量反馈误当
完整通过。只切回 Draft 不触发 Feedback。冻结 head 并更新到当前 base 后，
直接 Ready 一次；无需再用完整 head/base SHA marker 在 Draft 请求第二轮审阅。
`review-policy` 只接受 Ready 后携带当前完整 `commit_id` 和匹配
`Reviewed commit` marker 的 Codex review，或不可编辑的 exact-commit clean
Codex comment。它在每轮轮询中重验 live head/base，完成后等待 30 秒，再检查
未解决且未 outdated 的 P0/P1 线程。只有明确标为 P0/P1 的 `CHANGES_REQUESTED` 必须阻断；
P2/P3/unclassified finding 则写入 review debt，不应为了清理它们额外生成
候选 SHA。空 review、错误 commit、普通讨论文本和早于 Ready 的信号不参与判定。

`branch-policy`、`baseline-policy`、`review-policy` 与 `candidate-context` 按依赖
并行：baseline 不等待 review，完整 Linux/Browser/Electron job 只等待基线，
从而把审阅等待与耗时测试重叠。`release-gate` 汇合它们，针对打包风险要求
dry run 成功、针对 source-only 允许 dry run 跳过，随后即时重验 review policy 并
刷新基线后签发凭证。若晋升后又有提交，新 SHA 只获得反馈且缺少必需检查，必须
重新转 Draft、批量修复必要 P0/P1 后再 Ready；base 更新同样使已审组合失效。
PR 批量是建议而非固定限制：用 CI Health 的 Ready 次数、candidate churn 和
30–40 分钟候选时长判断是否需要协调，而非机械限制并行 PR 数量。

## 测试类型与去重

- 核心 Node：算法、状态机、序列化、事务、错误关闭和 forward/inverse 不变量。
- 通知合同：TypeScript 判别联合拥有 `disposition × action` 合法矩阵；`direct-action` 和 `user-choice` 必须携带受限恢复 action，`silent-recover` 与 `defer-and-resume` 明确禁止 action。Node policy 测试拥有 priority、dedupe、sticky 与 timeout；Browser 测试拥有 `aria-live`、键盘、按钮和 hover/focus pause。不得再扫描 Workbench AST 或内部 helper 名称来证明某个 `setToast` 调用是否合法。
- 源码字符串合同：只在其拥有的组件或控制器变化时运行；不把实现文本匹配当作主要正确性证据。
- Browser 冒烟：固定覆盖脚本隔离、源码字节、可编辑岛、源码权威围栏和能力降级五类关键风险；完整 Browser 包含全部活动 V2 回归。V1 的 per-keystroke tracker、FormatSkeleton 和 IME tail 状态机实现及测试已从仓库删除；V2 岛内字节 oracle、输入矩阵和 composition 快照用例是唯一产品合同。
- Electron 冒烟：固定覆盖真实 authored DOM 输入和一次带磁盘持久化的 composition；完整 Electron 保留保存、关闭重开和逐字节 forward 结果等全部路径。
- Electron 产品套件默认使用隐藏、禁止后台节流的 BrowserWindow，不激活应用、不抢键盘焦点；只有显式设置 `PAGEROOT_E2E_FOREGROUND=1` 才显示测试窗口。CI 环境预检保留可见但不聚焦的 accessory 窗口，用于证明 WindowServer 绘制能力。
- 交互预览与 Review Runtime Snapshot：Node 证明单一 source-host resolver 只接受
  direct Canvas/SVG 与唯一稳定的 source-empty 宿主，删除/歧义/类型冲突、任意
  HTML/`tbody`、computed selector 和脚本依赖猜测都 fail-closed。owner 测试拥有
  Review-only 窄请求、source SHA/绑定、isolated world、一次 rect/PNG、PNG
  SHA/像素/字节预算、deadline 和 cleanup。Electron 用一份合成报告证明 Edit
  不执行作者脚本、不请求或挂载运行态位图，Preview 中同一 Canvas/SVG 正常运行，
  authored inline SVG 仍在 Edit 原生可见且源文件字节不变。
  桌面编辑画布还必须
  证明同目录图片通过同一条受控资源根加载成功，而 `script-src` 没有因此
  获得自定义协议权限。Browser 的确定性
  Tab 评论用例同时证明 `评N` 标记悬浮于标签控制右上角、顶部栏不重复
  显示当前标签、其他标签评论以中性评论卡片在顶部栏内部展开，并可从
  具体卡片切换标签并定位对应评论。未保存评论在当前标签页保留持久入口，
  切换标签后只作为对应分组中带“未保存”状态的卡片出现；点击恢复不会移除
  入口，保存或明确删除才会移除，且草稿不增加主评论数或 `评N`。
  高密度短页面用例还必须证明 Canvas 自然底边保持不变，评论队列不会撑长
  共享页面；页面到底后可继续向下把底部卡片拉入，反向滚动可恢复自然位置。
- 编辑模式安全内容切换：Node 证明语义 Tab/details/disclosure 与显式
  `data-p` / `data-tab` → panel-ID、固定数字处理器 → 唯一索引面板这两类
  旧式页签适配器的严格白名单，以及链接、弹窗、分组 details、重复/跳号
  索引、动态或多语句处理器、多候选面板和歧义标记的失败关闭；Browser 证明
  单击选择、双击编辑、工具条和 `Option + 单击` 不冲突，切换前后共享滚动
  位置不变、作者处理器未运行且导出字节不变；Electron
  独立重读真实源文件，证明作者事件未运行且磁盘字节不变。
- AI 闭环：Node 集成必须分别证明普通/跨标签相关改动可建版、不相关但可用
  HTML 进入 `attention` 并强制审阅、脚本/inline handler 等作者内容变化
  照常建版且不生成检测字段或提示，以及身份/Hash/路径/协议失败与
  no-change 可从 workspace 恢复。
  `ReviewAnalysisSession` 的 Node oracle 另证明确切 key 合并、异步让步、运行中
  取消和按字节 LRU。修改审阅配对/分段实现时，还要在真实 Chromium DOM 中用
  大型多 section/深层卡片 HTML 记录总耗时及各 `pageroot:review-analysis:*`
  phase，确认 fuzzy pairing 只在兼容 bucket 内运行，并以正式 Electron 闭环
  证明变化数量和类型没有因性能优化改变；可复现实测入口是
  `npm run benchmark:review-analysis`，该诊断不增加产品内提示。
- Electron E2E 夹具与场景归属：`tests/e2e/electron/helpers/pageroot-app-fixture.mjs`
  只拥有独立 userData/workspace/source、隐藏窗口启动、Bridge 路径、close-first
  cleanup、诊断输出和已加载 frame；它不包含产品断言、整条用户流程或自动重试。
  fixture 的 Node contract 必须证明 close event 或已确认的 Electron process exit 先于
  cleanup、close listener 覆盖 exit request 与 SIGTERM/SIGKILL 的完整有界 shutdown budget、stop 幂等、
  SIGTERM/SIGKILL 有界 fallback，以及两者均未确认时不删除
  Bridge-owned 文件。AI 闭环保留 verified
  review/accept、pre-load navigation、顺序 Version/relaunch、internal supplement、
  no-change、return、clipboard failure、A/B 隔离、double-click、cancel/restart、
  unknown reconcile、missing finalizer、malformed HTML、broad related、activation
  failure；legacy global comment 的跨重启恢复仍处在兼容窗口，继续保留为独立
  Electron 场景。Native Electron 拥有 rapid switch/close 的真实 DOM 与磁盘 oracle；
  project rules/drain 与 update/About 均由其更窄的 Node/Preload/UI owner 覆盖。首个
  review/accept 场景的 geometry helper
  必须把每个表驱动 case 的 fixture、filter/page/context、change type、element/Range
  owner、frame/mask count、tolerance 与负例写全；表只能消除样板，不能合并不同
  故障模型。

  基线的 21 个 AI Electron 场景中，15 个核心 AI 场景与 legacy restart 场景仍在
  `ai-handoff-closed-loop.spec.mjs`；其余 5 个非 AI/重复排列按下表有明确 owner。

  | 已收敛场景 | 唯一 owner |
  | --- | --- |
  | first project registration 的 global comment | `comment-rail-layout`: `global comments stay before local comments regardless of canvas position`；Browser `native-dom-comment-stress`: `comments virtualize immediately above the threshold and remain navigable`（首个保存等待 lazy registration committed） |
  | multiple orphan relink | Native Electron: `multiple orphaned comments relink in sequence and resume the original send`（两个 orphan target 依次选择后只恢复一次 send） |
  | project resources/drain | Native Electron: `project resources drain edited rules before leaving`（从 Rules UI 离开时通过 Bridge 保存精确字节）；Node owners 仍覆盖 DraftSession 与 read-only inspector |
  | update/About | Native Electron: `automatic update actions keep the header geometry and About lifecycle`（update badge、About/restart dialog 与 header placement）；Node/Preload owners 继续覆盖 update protocol |
  | rapid switch/close | `tests/e2e/electron/native-dom-electron.spec.mjs` |
- 完整 HTML 持久化性能决策：`npm run benchmark:persistence` 只构建一次
  renderer，并在同一机器、同一 frozen main 与固定的 0.5/1.25/2.5MiB
  synthetic HTML 上串行运行。它必须同时保留 external-write conflict、
  restart recovery 与 exact-byte oracle；restart recovery 不仅验证磁盘
  字节，也必须重新打开已注册 workspace 并验证项目/文档身份、Hash 和
  persisted revision；并报告样本数、p50/p95/max、
  request/response bytes、renderer/Bridge RSS、renderer rAF gap 和明确的
  `skip-12` 或 `authorize-12-pr1` 决策；不同 SHA、并行负载或旧诊断样本
  不得混合。
  除其明确的 harness、报告与命令元数据外，任何受版本控制的运行时输入
  相对 `origin/main` 的变化都会在测量前拒绝；Electron autosave、dirty
  switch 与 dirty close 都必须按完整预期 HTML 字节比较，不能只验证 token
  存在。每个操作的 elapsed 必须在自身的持久化、目标 frame 或关闭事件完成时
  立即截取，不能混入后续 switch、close、监控停止或 byte oracle 的耗时。
  任务级跑正常闭环和一个硬失败代表场景；
  发布级覆盖复制失败、缺失 finalizer、非法 HTML、版本激活失败与终态
  返回/重开。正式 Electron 审阅用例还必须证明默认“双页 + 全部变化 +
  18%”、页面/筛选/可见度/导航彼此独立、左右单页和双页均铺满可用
  Canvas、完全相同文字不被标记、叶子级精确文字差异、重复短文案和中间
  插入结构不会错配、未修改指标卡不产生文案/结构/视觉假阳性、文本新增
  绿框且无下划线/删除红框和红色虚线删除线/结构蓝框/视觉紫框、每个语义
  变化组只有一个简短标注且整块新增统一为“新增内容”、单字框具有受行边界
  限制的最小可读宽度、局部跨行修改生成独立普通行框而非锯齿多边形、密集
  多行改写只生成一个“段落改写”文本块框、整卡背景/
  边框/前景色同时变化时每张卡只生成一个贴合完整 border box 的普通矩形
  且相邻卡片不融合、`block-size` 仍归属完整盒子、仅继承文字颜色变化时
  直接测量文字 Range 而不框容器、每个最终框与遮罩透明孔几何一致、
  页面自身的 `svg` / `div` 规则不能改写投影几何或遮罩外观、
  导航区域不画框、内容型连通 marker 融合且自身未变化的祖先嵌套框删除、
  盒子级视觉 owner 支配内部视觉子框、全部变化同处多类型只显示一个融合框、具体结构/
  视觉说明、内容地图、上下导航与左右页点击共用显式/索引式 Tab 识别并
  双向揭示隐藏 Tab、切换期间旧框不残留且虚化无空档、安全按钮和表单在
  同步或独立滚动下均能左右双向同步、0/50/100 上下文可见度、横向联动、
  不同高度下按区域进度对齐、单帧只消费最新位置、快速上下反向后不追赶
  旧目标、左右换侧后旧代次失效、短页顶/底边界不强拉长页且顶端无反向
  回跳、修改前页“评”字悬停气泡只读且修改后页不重复、分段控件键盘移动、
  工具栏不遮挡页面标题、确认弹窗文案/焦点/按钮层级、返回修改前直接恢复
  编辑且保留评论与候选文件，以及确认打开全程不显示等待 AI 页面。
  同一正式 Electron 用例覆盖支持范围内的 source-empty host、直接 Canvas/SVG、静态审阅优先呈现，以及 owner 失败或迟到时不改变静态数量、文本、TargetRef 或 UI。Node 覆盖 SourceHostResolver 的唯一配对、删除/歧义/类型冲突的静默省略，owner 的窄请求、原始 source SHA/绑定验证、isolated world、一次 rect/PNG、PNG/像素/字节预算、deadline 和 cleanup。Browser 另外证明点击页面 padding 与 App 空白会一起结束编辑、选区和工具栏。测试自动生成受控 AI 输出并执行正式 finalizer，不等待外部模型或真人接力。
- Review Runtime Snapshot：Review 通过其唯一 owner、请求 envelope 和 PNG parser 完成一个 before/after pair。Electron 回归验证静态审阅先呈现，owner 失败或迟到不改变静态审阅；作者页不能读取 candidate binding、TargetRef、截图或 owner 结果。新 owner 文件必须在 package allowlist、packaged artifact gate 和启动 smoke 中出现。
- 运行态视觉合同只有一个 Review-only 生产声明：Node 直接验证 contract、32 个 Snapshot 上限、1500ms owner deadline、完整 source SHA 与 contractVersion + sessionId + side 封包；Review 的生产者、消费者不得各自重复边界。测试覆盖 direct Canvas/SVG、source-empty 稳定宿主、删除/歧义/类型冲突、超大 PNG、无限脚本与 navigation/popup/download/permission 拒绝。任意脚本因果、computed selector、评论范围分组、第二轮确认和 hostile 组合矩阵不再是候选 oracle。
- 评论标记必须覆盖无 `id`、`data-*`、`name`、`aria-label` 的 class-only 普通目标：即使作者插入或重排同标签兄弟，before bootstrap 也必须仅凭首个私有响应中的冻结源 `sourceNodeId` 路径/指纹绑定解析器创建的原元素并保留 marker。测试还必须证明 HTML、后续 bootstrap 读取和作者可枚举 DOM 均不含该绑定、评论正文、评论 key 或定位映射；恶意作者脚本读取当前页面或 bootstrap 地址后仍不得产生伪造 marker。恶意的作者 capture listener 即使尝试读取 challenge、以同一 challenge 伪造评论端口，也既看不到评论 channel 请求，也收不到 `comment-targets`。
- Review 只比较一个冻结的 before/after owner pair。任一侧 unavailable、无效、超时、取消或迟到时静默省略该 marker，不影响静态审阅或其他已验证候选；不为动画、随机或任意 hostile 行为启动第二轮取证。
- 审阅滚动回归必须直接证明页面概览会递增手势代次、取消待执行跟随帧并保留语义映射；评论布局契约还必须接受超出 100,000px 的有限长文档坐标，同时继续拒绝非有限值和超过安全上限的坐标。
- 文案 footprint 算法由 Node 直接用字符范围 oracle 验证：覆盖有意义标点前后的独立替换、纯插入、纯删除、稳定句首词、短中文块的字符级辅助配对、超长无标点文本中的多处远距离精确修改、短间隔归组、稳定句拆分和密集成对改写提升，以及“品均基本持平”替换为“单品效率整体稳定，增幅仅+0.10%”时不能用偶然相同的“品”抵消增删。纯插入/纯删除必须严格镜像，并分别断言 operation、两侧 evidence ranges、无证据侧的不可见 anchor 与空 footprint groups；整句单侧变化只能得到 sentence scope，存在稳定外句或缺少任一侧 evidence 时不得提升为 block。仅换行变化使用 layout operation，且两侧均无红绿文字 evidence。语义对齐另以独立 Node oracle 覆盖头/中/尾新增、重复编号与表格类目、多解不猜、显式 ID 移动、普通插入不误判移动、稳定前后边界中的长插入、前后镜像，以及超过 60,000 DP 单元后的有限前瞻回退；结果必须保持父级边界和单调顺序。Electron 正式闭环必须按最终 geometry 验证：编号行修改前零 marker/框/孔/标签、修改后只有第四行；纯删除修改后零框零孔，但内容地图导航落到 collapsed Range 上下文而不是 section 顶；同一元素上的 box-style 与 layout 必须作为两个独立投影事实，分别产生自己的 canonical frame 和 mask hole，且互不覆盖；直接同父级的图片、SVG、Canvas 和输入控件必须作为原子语义单元保留，新增/删除生成自身结构事实，唯一稳定身份的样式变化进入视觉配对而稳定文字邻居零误报；新增表格行在全部模式只有一个 `tr` 框、结构模式只有父行框、文案模式只显示 cell 内 Range 行框，旧重复行零误报。窄 cell 跨行、四行文字、嵌套 inline/列表、authored marker/`div`/`svg` 样式、适应与 100% 缩放、单双页和主窗口 resize 后都必须重新测量；文字框数量与 Range 行盒一致、同组一个标签且无 shaped，overlay 与 mask hole 的数量、坐标和 path 逐项相同。
- 应用更新：Node 用伪 updater 证明 stable-only、点击后单次下载、差分开启、普通退出不安装、仅 downloaded 状态可安装和错误降级；Preload/Workbench 合同证明状态快照、下载/安装意图、无 Canvas 完成横幅与重启确认保持窄边界。
- 本地外部动作：五类 Finder/默认浏览器/项目记录入口由 Node 以真实调用计数证明一次用户意图只执行一次副作用，失败会保留可见错误和可用项目，等待超过旧 retry delay 也不会重放；第二次调用只能来自新的用户意图。Bridge 的只读 GET/HEAD 重试保留在 transport 层，`openFolder` 等命令不复用它。默认浏览器打开还直接执行主进程操作与 sender 权限门，证明 malformed、非 HTML、未知项目、非普通文件和非可信 frame 均不会调用 shell；Workbench 合同只补充证明精确 edit revision 的围栏、写回和 IPC 顺序。
- 使用数据：Node 使用伪网络端点证明安装 ID 持久、会话 ID 轮换、
  项目 ID 只以 HMAC 假名出现、编辑聚合、队列上限和失败重试。负向样本
  必须同时注入 HTML、评论、Prompt、附件名、文件路径和原始异常，最终
  批次及本地队列都不得出现这些值；测试永不访问真实 PostHog。
- 开发者测试包：先证明正式 tag 后的提交序号被确定性映射为独立测试版本（例如 `0.9.5` 后依次为 `0.9.69991`、`0.9.69992`），再对独立名称/Bundle ID 的 ad-hoc `.app` 做 app.asar、Bridge、Schema、资源、版本和 DMG 静态校验，并从真实可执行文件做一次应用名/版本/首窗/Bridge/Workbench/正常退出冒烟；最后把 DMG Hash、tag-to-commit 范围、全部关联 PR 的实时状态/一句话摘要及无 PR 直接提交写入 JSON/Markdown 交付报告。GitHub 元数据缺失时交付失败，但不把可变 PR 状态嵌入 App 或正式字节凭证。
- 发布 dry-run：只在相关 PR 路径变化时运行。第一台 macOS runner 用固定合成 PostHog 项目 token 生成启用态 telemetry metadata，与 build metadata 一起装入显式未签名（`identity=null`）App，复用正式 verifier 检查 app.asar、Bridge、Schema、资源和身份字段，并创建 `releaseEligible: false` 的独立 checkpoint。第二台 clean runner 验证 archive/payload Hash、恢复原 metadata、重建 `dist-desktop` renderer oracle、再次复用正式 verifier，再从真实可执行文件核对 `app.getName()`、版本和 `CFBundleIdentifier`。workflow 不引用 `secrets.*`，dry-run kind/目录/文件名均不能被正式 signed-App restore 接受。
- 候选包：先对 ad-hoc 预签名 `.app` 校验 app.asar、Bridge、Schema、资源闭包并从真实可执行文件运行完整源码字节 oracle；通过后才做 Developer ID 签名，并在 Apple 请求前做一次 Hardened Runtime 启动。App 公证后冻结 archive/payload/Tree Hash checkpoint，下一 job 只把同一 App 作为 `--prepackaged` 输入生成 DMG、ZIP、blockmap 和 `latest-mac.yml`，再校验 Team、App/DMG 公证票据、Gatekeeper、只读挂载与 ZIP 解包内容。
  新 job 会先从 checkpoint App 原样恢复 build-info 与遥测配置作为比较输入，
  再从同一源码 Tree 重建确定性的 Electron renderer 作为 payload oracle；
  不得重新生成遥测配置，也不得重新组装、签名、公证或替换 checkpoint App。
  最终 DMG 通过后另生成实时安装包内容报告；发布阶段对下载的同一 DMG
  刷新 PR 状态，报告不参与冻结字节 Hash，避免可变协作状态污染不可变候选。

持久状态只保留四个跨层不变量：过期 revision 自动读取权威草稿并 rebase、结果未知时按 operation ID 查询、已确认的相同聚合 drain 为 no-op、草稿文件领先 runtime pointer 最多只允许一个已校验的崩溃窗口。纯函数和 Session 是主证明，Bridge 只证明持久边界；候选包把四者压缩为一个真实 App 冒烟，不在 Browser、Electron 和打包层各复制整套排列。

评论虚拟化的数量算法由 Node 使用 100 条确定性记录验证；Browser 只创建 `threshold + 1` 条跨过真实渲染边界，再新增一条证明交互仍接通。不得用上百次重复 UI 创建来充当测试数据生成器，也不得为了注入测试数据给产品增加测试专用接口。

评论栏纵向布局由 Node 对全局优先级、页面位置、同目标顺序、实测高度、
固定间距、原位文字编辑期间的坐标冻结和顶部栏安全起点做确定性验证；
Browser 验证真实 DOM 中保存卡片、草稿卡片和输入框在当前/其他标签页
切换、聚焦和展开后的相对顺序、无重叠结果，以及输入框自动聚焦、
`Enter` 保存、`Shift + Enter` 换行。

顶层 Node 测试在一次执行中只出现一次。精确影响映射优先；只有找不到任何精确用例时才启用 `node-core` 兜底。PR CI 在 Linux 构建一次 Web renderer，供 Node 和 Browser 共享；共享产物名称绑定唯一 `run_id` 而不绑定 `run_attempt`，并保留 30 天，因此同一 workflow run 只重跑失败 job 时可以复用已通过的构建。若 `source-build` 本身重跑，则以相同名称覆盖同一 run 的旧产物。每个 macOS Electron job 在目标系统本地构建 renderer，并先用独立 preflight 证明窗口可见、计时器和 animation frame 正常推进。Native Electron 与 AI 闭环分成两个 job，Browser 保持每个分片单 worker、零重试，但跨三个独立分片并发。测试直接提交隐藏文件 input 时不会经过真实“打开”动作的 pre-picker switch fence；共享 fixture driver 只允许在旧画布仍为 render-verified、input 仍 attached 时有限重提，不能重跑整条用例或掩盖加载后的产品断言失败。

关键 CI 命令通过 `scripts/ci-evidence.mjs` 记录 commit、Tree、job、耗时、退出状态、标准化失败摘要与稳定签名。环境 preflight 失败可直接归类为 `ci_environment`；源码测试失败先标 `needs_triage`，再依据独立 oracle 归为 `product`、`test_script` 或 `ci_environment`。同一 SHA 的环境嫌疑只重跑失败 job；正式流程第二 job 失败时保留并复用第一 job 的签名 App checkpoint，不重新做已通过的构建、运行、签名和 App 公证。相同签名连续两次失败且本地不复现时冻结候选并登记 CI incident。完整规则见 `docs/RELEASE_PIPELINE_GOVERNANCE.md`。
`tests/ci-evidence.test.mjs` 会枚举源码、开发预览、候选与发布工作流实际使用的
每个 evidence stage；任何未同步到允许列表的名称必须在源码门禁中失败，不能等到
正式候选打包才暴露。

CI Health 每日先跑依赖健康基线，并同时读取 `ci.yml`、`pr-feedback.yml`、
`release-dry-run.yml`、`release-candidate.yml` 与 `release.yml`，以及 Pull
Request 的 Ready event、review、review comment 和 issue comment。除了同一 run
的绿色 job 重跑，它还按 PR number（旧数据缺失时按 head branch）聚合不同 SHA 的
完整门禁，记录 Ready 次数、P0/P1/P2/P3/unclassified finding、Ready-to-review、
Ready-to-gate、gate-to-merge 和 candidate-to-merge。review 延迟只接受与
`review-policy` 相同的最终 head、Ready 后 Codex completion；测试完成取该 final
SHA 上最后一个成功 source/dry-run lane，而不是等待 review 的 `release-gate`。
流量指标只采纳窗口内的 Ready/merge 区间，超过分页上限会显式失败。目标是正常候选
P50 在 40 分钟内完成，其中 review 小于 15 分钟、测试小于 20 分钟、
gate-to-merge 小于 10 分钟。PR 大小只以 advisory scope 观察，不加入目标或阻断。
报告同时保留总量、完整门禁、Feedback、候选 churn runner minutes 及 PR/候选取消率。
只有 `status=completed` 且存在 conclusion 的 workflow run 可进入完整门禁次数、
延迟、尝试、churn 和取消率分母；活动 run 的数量与已结束 job 所消耗的 runner
minutes 另行展示，不使用可变的 `updated_at` 伪造已完成延迟。Actions Summary
对每个可机器计算的报告目标明确显示 `MET`、`MISSED` 或 `NO DATA`，而
review/baseline 阻断和正在执行的候选不会被误计成完整门禁。

## 判断标准优先级

1. 原始 Buffer、SHA-256、forward/inverse Patch、磁盘重读结果。
2. 明确状态机字段、revision、协议 Schema、失败码和文件清单。
3. DOM 身份、Selection、caret、几何、scroll 和布局指纹。
4. 截图、trace 和视频只作为失败诊断物，不要求真人看图后决定通过。

`tests/generated-source-invariants.test.mjs` 用固定种子生成 BOM、LF/CRLF、单双引号、多语言 Unicode、entity、注释和脚本文本组合。每个失败都带 seed；测试用独立字节替换 oracle 验证未命中范围、inverse 原子恢复和同一计划重放，而不是复用被测实现计算期望值。

画布撤销/重做不得使用 Chromium DOM history，也不得维护整页 HTML
快照栈。每次被接受的 SourcePatch 把实际 forward Patch、exact inverse
Patch、前后 Hash 和目标写入有界持久日志；Node 证明文字、样式、结构和
排序共享一个严格 cursor，新修改截断 redo，篡改或不连续 Hash
fail-closed。Bridge 故障注入分别覆盖 source commit point 前后的
HTML/历史联合恢复，以及稳定 action ID 的结果未知重放。

Native Electron 是最终交互 oracle：真实 Edit 菜单和快捷键依次执行文字、
工具栏样式、岛内换行结构和同级下移，关闭重开后仍能撤销，并以原始
Buffer 验证每次 undo/redo。焦点在评论正文或 `PROJECT.md` 时，同一个
Edit 菜单必须只触发原生控件文字撤销，源 HTML、评论卡片与附件保持
不变。文字撤销还必须证明 canonical 采用后焦点、逻辑 Selection 和评论
TargetRef 仍落在原源码宿主；可证明的岛内快速路径逐帧保持同一个 iframe、
`render-verified`、可见性和共享滚动位置，评论位置不消失、不掉底且不产生
伪 orphan。`PROJECT.md` 覆盖 composition 中的局部撤销，以及显式还原后从
已废弃输入节点迟到的 input/compositionend；两者都不得留下中间拼音。
Browser 测试继续证明 SourcePatch forward/inverse 和各编辑入口，但不把
无持久权限的浏览器预览伪装成跨重启历史证明。

## 真实 HTML 与输入法边界

`npm run test:real-html` 默认使用仓库内复杂 HTML 物料，自动发现一个可编辑岛和一个明确降级根，并验证几何、岛外字节与磁盘不变量。用 `PAGEROOT_REAL_HTML_PATH` 覆盖真实文件时，还会自动发现所有当前可见且通过 V2 capability 的唯一编辑宿主，对每个宿主执行段首、段中、段尾输入/删除、换行/删除换行及已有末尾 grapheme 删除/恢复，并单独复测页头品牌、Hero 长段落末尾、按钮式链接边界和模块说明末尾。门禁附加机器可读的宿主数、成功/失败操作数和逐宿主结果。

原文件不会被写入。真实页只要求 DOM 已进入可交互状态，不等待可能被外部字体或媒体永久拖住的整页 `load`；进入编辑前必须连续取得稳定的目标、文字、可见源码节点和文档尺寸几何快照。

合成 V2 矩阵必须覆盖段首/段中/段尾、非空行内样式交界、注释和文字两侧的不可变原子；代表宿主至少包括标题、段落、列表项、链接、按钮、表格单元格、`pre/code` 和竖排文字。独立 oracle 检查岛外字节完全不变、岛内结果等于受约束的最小规范化、既有语义/注释/原子未改变。IME 用例冻结输入前 Selection，并证明最终候选只在该锚点插入一次。

当前自动化能证明 Chromium/Electron composition 事件序列、Apple 拼音临时 wrapper 轨迹、取消/迟到事件、持久化和 canonical reconcile。它不能诚实证明第三方 macOS 输入法候选窗本身。该能力在出现可无人值守、可复现并有机器 oracle 的 OS 级驱动前只登记为覆盖边界，不设人工门禁，也不伪装成已自动验证。

## 证据与新增测试准入

每次门禁写入 `output/test-runs/<run-id>/selection.json` 和 `results.json`，记录 HEAD、工作区内容 Hash、改动文件、选择原因、命令、耗时和首个失败。Playwright 的失败截图、trace、视频和 HTML report 继续位于 `output/playwright/`。

新增测试至少要回答四件事：对应哪个真实故障；使用哪个独立 oracle；属于哪个门禁层；是否已经被更低成本测试覆盖。不能给出明确答案的重复排列或纯“代码里存在某个字符串”测试，不应加入常规门禁。
