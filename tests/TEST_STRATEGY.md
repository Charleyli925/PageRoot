# PageRoot 自动化测试策略

目标不是增加测试数量，而是在尽量短的反馈时间内发现真实缺陷。所有活动门禁都必须无人值守：不等待真人点击、输入、观察、判断或把任务转交给外部模型。测试物料可以由确定性生成器产生，但判断标准必须由源码字节、Hash、状态机、DOM/几何或明确协议字段自动给出。

## 本地反馈与三道交付边界

| 门禁 | 使用时机 | 覆盖 | 目标 |
|---|---|---|---|
| `npm run gate:edit` | 一次局部修改后 | 只运行影响映射命中的 Node 文件；必要时 typecheck | 快速发现局部逻辑错误，不启动浏览器或 Electron |
| `npm run gate:task` | 一个开发任务完成时 | 静态检查、受影响 Node 文件，以及相关 Browser/Electron/AI 冒烟 | 在较短时间内证明生产链路已经接通 |
| PR `pr-feedback` | `opened/synchronize/reopened/converted_to_draft` | 按影响映射选择 Node/编译检查 | 普通推送无论 Draft/Ready 都不重复消费完整矩阵；新提交取消仍在运行的旧 SHA 完整门禁 |
| 一次性晋升 `release-gate` | 最终 PR Tree 从 Draft 显式转为 Ready | 全量 Node、三分片完整 Browser、独立 Native Electron、独立确定性 AI 闭环、真实 HTML 发现式门禁 | 每个最终候选只跑一次并签发 Tree Hash 凭证；后续新 SHA 必须重新 Draft→Ready 才能再晋升 |
| `main-integrity` | 合并到 `main` | 校验合并 PR、Tree Hash、package/lockfile 版本和凭证时效 | 相等即复用完整源码证据，不重复 Node、Browser 或 Electron 测试；不相等直接失败 |
| 按需 `Developer Preview` | 仅在开发者明确要求时 | 干净 Tree、最新 renderer、ad-hoc DMG、包内容完整性、一次隔离启动和精确 PR/内容交付报告 | 在消耗签名/公证时间前发现“漏打包或根本跑不起来”；不成为正式门禁 |
| `Release Candidate` | 打标签之前，凭证新鲜且 Tree/版本完全一致 | 预签名 App 内容/完整运行校验 → Developer ID 签名后启动 → App 公证 checkpoint → 从同一 App 生成并公证 DMG → 最终字节校验 | 内容错误不消耗 Apple 队列；后段失败只重跑后段 |
| `Release` | 候选包通过且不超过 72 小时 | 重新校验候选凭证和每个文件 Hash，创建 tag 并发布原字节 | 发布阶段不重新构建、不悄悄替换文件 |

本地 `release` 和完整 `artifact` 不根据改动缩减范围。`Developer Preview` 是独立的可选入口，正式 `release`、`artifact` 和 `artifact-only` 都不会自动调用它；自动部分不等待人工安装结果，开发者的短验证仅是反馈，不签发正式凭证。`artifact-only` 不是开发者手工跳过源码测试的捷径：执行器会拒绝缺少 CI 信任决定、Tree Hash 或版本不一致的调用，只允许 `Release Candidate` 在七天内成功 PR 凭证与当前 Tree Hash、版本完全一致时进入。发布工作流只接受同一 Tree/版本、已验证且 72 小时内的候选包。`edit` 和 `task` 的选择由 `tests/test-impact-map.json` 决定，模型或开发者只选择门禁层级，不临时拼接测试命令。

“最新安装包”的多 PR 源码组合是打包前的 Git 流程：门禁只验证当前干净
Tree，不在测试执行期间自动合并分支。组合 Tree 含任何未合并 PR 时，
只能进入 Developer Preview 门禁，不能进入正式候选或发布门禁。

工作区有未提交修改时，`edit/task` 自动读取 staged、unstaged 和 untracked 文件。任务已经提交后应运行 `npm run gate:task -- --base <基准分支或提交>`；干净工作区又没有 `--base` 时门禁会明确失败，不会把“零测试”伪装成通过。

`npm run task:finish` 是 `gate:task -- --base origin/main` 的安全任务包装，不引入新的门禁层。`tests/task-workflow.test.mjs` 在独立临时 Git 仓库中验证分支名、干净 primary `main`、远端同步、隔离 worktree 创建、现有分支 attach、脏工作区拒绝、GitHub PR/本地独有提交分类、retire 默认 dry-run、显式放弃围栏和最终差异报告，不会操作开发者的真实分支。

PR 必须从 Draft 开始。普通推送由独立的 `PR Feedback` workflow 处理，
不会创建名为 `release-gate` 的跳过 job；因此分支保护不会把轻量反馈误当
完整通过。只有 `ready_for_review` 事件存在完整 workflow。若晋升后又有提交，
新 SHA 只获得反馈且缺少必需检查，必须重新转 Draft、冻结后再转 Ready。
同一时间只晋升一个 PR；其他并行修改继续留在 Draft，等前一个合并并更新
到新 `main` 后再晋升，避免严格最新基线制造三角形重测。

## 测试类型与去重

- 核心 Node：算法、状态机、序列化、事务、错误关闭和 forward/inverse 不变量。
- 源码字符串合同：只在其拥有的组件或控制器变化时运行；不把实现文本匹配当作主要正确性证据。
- Browser 冒烟：固定覆盖脚本隔离、源码字节、可编辑岛、源码权威围栏和能力降级五类关键风险；完整 Browser 包含全部活动 V2 回归。V1 的 per-keystroke tracker、FormatSkeleton 和 IME tail 状态机实现及测试已从仓库删除；V2 岛内字节 oracle、输入矩阵和 composition 快照用例是唯一产品合同。
- Electron 冒烟：固定覆盖真实 authored DOM 输入和一次带磁盘持久化的 composition；完整 Electron 保留保存、关闭重开和逐字节 forward 结果等全部路径。
- 交互预览与编辑视觉投影：Node 分别证明短期自定义协议的资源边界、
  PageViewContext 的 source-backed allowlist、投影精确源 Hash/空宿主校验、主进程
  截图边界和迟到结果丢弃；Electron 用一份合成报告证明用户未进入预览时，
  运行时 SVG/HTML、Canvas 和动态 `tbody` 已以只读 PNG 显示且可对原宿主留评论，
  源文件字节不变；同一用例再证明宿主 CSP 下的相对脚本和真实运行时 DOM、
  Tab 切换，以及返回编辑后只保留当前 Tab 且仍能进入原有文字编辑岛。
  可选真实 HTML 用例直接覆盖 `np1a`/`np1b` 等脚本生成图和动态表格，不将真实
  文件复制进测试仓库。桌面编辑画布还必须
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
  no-change 可从 workspace 恢复。任务级跑正常闭环和一个硬失败代表场景；
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
  同一正式 Electron 用例还要覆盖脚本填充的 HTML、SVG、Canvas 空宿主：
  真实视觉差异补入同一 canonical footprint；仅由上方新增内容造成的整体
  下移、未绘制空宿主的纯尺寸变化、相同最终输出和动画宿主不得
  产生 marker；宿主自身的背景、边框及脚本直接改写的尺寸变化必须命中。
  已有静态框的宿主不得
  再进入运行态候选或增加第二个变化项；原页脚本伪造普通 `ready`、空快照
  或假 `MessageChannel` 也不得抢先完成任一侧；同一 section 内由未修改
  脚本独立生成随机值或时间戳的空宿主不得仅因旁边脚本变化进入候选；慢资源导致 iframe
  `load` 迟于快照时，缓存批次仍必须在注册后提交；极快
  `srcDoc` 先注册、后建立协调器时，owner 必须主动排空已注册 frame。
  Node 由纯协调器 oracle
  验证消息上限、完整双侧提交、静态 `changeId` 复用、500ms 全量回退
  和迟到拒绝。
  Browser 另外证明点击页面 padding 与 App 空白会一起结束编辑、选区和
  工具栏。测试自动生成受控 AI 输出并执行正式 finalizer，不等待外部模型
  或真人接力。
- 审阅滚动回归必须直接证明页面概览会递增手势代次、取消待执行跟随帧并保留语义映射；评论布局契约还必须接受超出 100,000px 的有限长文档坐标，同时继续拒绝非有限值和超过安全上限的坐标。
- 文案 footprint 算法由 Node 直接用字符范围 oracle 验证：覆盖有意义标点前后的独立替换、纯插入、稳定句首词、短中文块的字符级辅助配对、超长无标点文本中的多处远距离精确修改、短间隔归组、稳定句拆分和密集改写提升，以及“品均基本持平”替换为“单品效率整体稳定，增幅仅+0.10%”时不能用偶然相同的“品”抵消增删。Electron 在既有正式审阅闭环证明红色虚线删除样式、绿色无下划线样式、普通短语/行矩形、最小可读宽度、单组单标签和段落块 geometry，不重复纯算法排列。
- 应用更新：Node 用伪 updater 证明 stable-only、点击后单次下载、差分开启、普通退出不安装、仅 downloaded 状态可安装和错误降级；Preload/Workbench 合同证明状态快照、下载/安装意图、无 Canvas 完成横幅与重启确认保持窄边界。
- 默认浏览器打开：Node 直接执行主进程操作与 sender 权限门，证明 malformed、非 HTML、未知项目、非普通文件和非可信 frame 均不会调用 shell；Workbench 合同只补充证明精确 edit revision 的围栏、写回和 IPC 顺序。
- 使用数据：Node 使用伪网络端点证明安装 ID 持久、会话 ID 轮换、
  项目 ID 只以 HMAC 假名出现、编辑聚合、队列上限和失败重试。负向样本
  必须同时注入 HTML、评论、Prompt、附件名、文件路径和原始异常，最终
  批次及本地队列都不得出现这些值；测试永不访问真实 PostHog。
- 开发者测试包：先证明正式 tag 后的提交序号被确定性映射为独立测试版本（例如 `0.9.5` 后依次为 `0.9.69991`、`0.9.69992`），再对独立名称/Bundle ID 的 ad-hoc `.app` 做 app.asar、Bridge、Schema、资源、版本和 DMG 静态校验，并从真实可执行文件做一次应用名/版本/首窗/Bridge/Workbench/正常退出冒烟；最后把 DMG Hash、tag-to-commit 范围、全部关联 PR 的实时状态/一句话摘要及无 PR 直接提交写入 JSON/Markdown 交付报告。GitHub 元数据缺失时交付失败，但不把可变 PR 状态嵌入 App 或正式字节凭证。
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

顶层 Node 测试在一次执行中只出现一次。精确影响映射优先；只有找不到任何精确用例时才启用 `node-core` 兜底。PR CI 在 Linux 构建一次 Web renderer，供 Node 和 Browser 共享；每个 macOS Electron job 在目标系统本地构建 renderer，并先用独立 preflight 证明窗口可见、计时器和 animation frame 正常推进。Native Electron 与 AI 闭环分成两个 job，Browser 保持每个分片单 worker、零重试，但跨三个独立分片并发。测试直接提交隐藏文件 input 时不会经过真实“打开”动作的 pre-picker switch fence；共享 fixture driver 只允许在旧画布仍为 render-verified、input 仍 attached 时有限重提，不能重跑整条用例或掩盖加载后的产品断言失败。

关键 CI 命令通过 `scripts/ci-evidence.mjs` 记录 commit、Tree、job、耗时、退出状态、标准化失败摘要与稳定签名。环境 preflight 失败可直接归类为 `ci_environment`；源码测试失败先标 `needs_triage`，再依据独立 oracle 归为 `product`、`test_script` 或 `ci_environment`。同一 SHA 的环境嫌疑只重跑失败 job；正式流程第二 job 失败时保留并复用第一 job 的签名 App checkpoint，不重新做已通过的构建、运行、签名和 App 公证。相同签名连续两次失败且本地不复现时冻结候选并登记 CI incident。完整规则见 `docs/RELEASE_PIPELINE_GOVERNANCE.md`。
`tests/ci-evidence.test.mjs` 会枚举源码、开发预览、候选与发布工作流实际使用的
每个 evidence stage；任何未同步到允许列表的名称必须在源码门禁中失败，不能等到
正式候选打包才暴露。

CI Health 同时读取 `pr-feedback.yml` 与 `ci.yml`。除了同一 run 的绿色 job
重跑，它还按 PR number（旧数据缺失时按 head branch）聚合不同 SHA 的完整
门禁：`runsPerPullRequestAverage` 目标不超过 `1.25`，后续候选 SHA 消耗的
runner minutes 占全部 PR CI 时间应低于 `20%`。这部分不能再被“每个 Tree
只跑一次”的旧指标隐藏。

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
