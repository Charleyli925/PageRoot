# 编辑态白名单图表：PRD 与执行计划

- 决策状态：已接受，分两次 PR 实施。
- 当前产品状态：PR-1 仅提供纯合同、校验器和 SVG SSR 内核，尚未接入
  `HtmlCanvasEditor`，用户行为保持不变。
- 目标状态：PR-2 通过真实 Electron 门禁后，合格图表在原源码槽位中自动显示。
- 对应决策：`docs/decisions/0020-same-slot-edit-chart-svg.md`。

## 1. 问题与目标

PageRoot 的 Edit iframe 必须禁用作者脚本，才能维持源码定位、原生选择、
中文输入、评论和精确 SourcePatch 的单一权威。因此，依赖 ECharts 或自定义
脚本运行后才出现的图表目前在 Edit 中是空的。

本功能只解决一个有界问题：让生成端明确声明的一小类只读图表，在 Edit 中
无需作者脚本即可看见。它不追求兼容任意 HTML 脚本，也不把 Edit 变成第二个
Preview。

成功标准如下：

- 图表自动出现在原槽位，不需要点击、弹窗、侧栏或提示；
- 用户仍在同一个 Edit iframe 中选择、编辑、评论和滚动；
- 页面内部 Tab 切换不重新运行 ECharts、不重建 SVG、不闪屏；
- 源 HTML、TargetRef、保存、历史、Review、Version 和 AI 输入仍是唯一权威；
- 无效或不支持的图表与当前行为相同，静默保持为空或只显示源码静态内容。

## 2. 核心产品决策

采用“固定视觉槽位 + PageRoot 生成的同槽位 SVG”，不执行作者脚本：

```text
源 HTML 中的空图表宿主 + 惰性 JSON Chart Spec
  -> 严格白名单校验
  -> PageRoot 固定的 ECharts option 映射
  -> 可信 Workbench 中的 ECharts SVG SSR
  -> 输出 SVG 再校验
  -> 原宿主 Shadow DOM 中一次性挂载
```

生成 SVG 只是一份可丢弃的视觉投影。它不进入宿主 light DOM，不加入
SourceIndex，也不能成为 SourcePatch、保存、历史、Review、Version 或 AI
输入。Shadow DOM 只用于隔离作者 CSS，不被当作安全边界。

以下责任明确不存在：第二运行页、透明原生窗口、跨窗口坐标、裁剪蒙版、
鼠标穿透协议、截图、Blob URL、ResizeObserver、图表缓存、独立 Session、
后台重试或用户提示。

## 3. 源码协议 v0.1

一个图表由一个空的源码宿主和一个独立的 `<template>` 组成：

```html
<div
  id="sales-chart"
  data-report-chart-slot="cartesian-v0.1"
  data-report-chart-spec-id="sales-chart-spec"
  data-report-chart-width="640"
  data-report-chart-height="320"
  role="img"
  aria-label="季度销售趋势图"
  style="display:block;width:100%;aspect-ratio:2 / 1;overflow:hidden"
></div>

<template id="sales-chart-spec" data-report-chart-spec="0.1">
  {
    "version": "0.1",
    "mode": "category",
    "categories": ["Q1", "Q2", "Q3"],
    "series": [
      {"id":"sales","name":"销售额","type":"bar","values":[10,18,25]},
      {"id":"profit","name":"利润","type":"line","values":[2,5,8]}
    ]
  }
</template>
```

硬约束如下：

- 宿主只能是源码中的空 `<div>`，必须有唯一 `id`；
- Spec 模板必须有唯一 `id`，一个宿主只引用一个模板；
- 模板只包含 JSON 文本，不包含元素、脚本或表达式；
- 宿主和模板是一对一关系，不能共享或循环引用；
- 宿主必须声明固定 SSR 宽高和等价的 `aspect-ratio`；
- 宽高来自源码属性，渲染器不得读取 `getBoundingClientRect()` 的结果；
- iframe 加载后只核对 CSS 的 `aspect-ratio` 属性值，不能用可见宽高作为
  是否渲染或如何渲染的输入；
- `data-report-chart-*` 是作者源码合同，`data-pageroot-*` 继续只保留给
  PageRoot 的可丢弃运行时标记；
- 宿主负责可访问名称，生成 SVG 标为 `aria-hidden`，避免屏幕阅读器重复朗读。

Spec 与宿主分离是评论稳定性的必要条件。图表数据变化只改变模板文本，
不会改变空宿主的文本指纹；评论仍定位到同一个源码宿主，而不是运行时 SVG。

## 4. 支持范围

v0.1 只支持只读笛卡尔图：

| 模式 | 支持 | 不支持的同类能力 |
| --- | --- | --- |
| 分类轴 | 纵向或横向柱状图、堆叠柱状图 | 自定义 bar shape、瀑布图协议 |
| 分类轴 | 折线图、面积图、堆叠面积图 | 动态标签、markPoint、markLine |
| 分类轴 | 柱线混合图 | 双 Y 轴、运行时 formatter |
| 数值轴 | 静态散点图 | 气泡第三维、回归线、刷选 |

允许标题、静态图例、轴名称、十六进制纯色、有限数字、空数据点、折线平滑、
固定点符号和声明式 stack ID。

明确拒绝：饼图、环图、雷达、地图、热力、树图、关系图、桑基、仪表、
自定义系列、dataset transform、tooltip、动画、图例交互、回调函数、正则、
HTML formatter、图片、渐变输入、外部 URL、作者主题和原始 ECharts option。

PageRoot 固定并打包 ECharts 6.1.0。作者页面引用 5.x、6.x、CDN 版或内联版
都不会在 Edit 中运行，也不会改变本功能的渲染结果。升级 PageRoot 所有的
版本必须单独评审 SVG 输出、视觉差异、许可、包体和完整门禁。

已有的任意脚本页面不会自动兼容：

- 能表达为上述类型的图表，需要生成端同时输出 Chart Spec；
- 脚本临时拼出的自定义 DOM/SVG 信息图，应由生成端直接输出静态 HTML/SVG；
- 需要交互、动画或完整作者逻辑的页面继续在 Preview 中使用。

## 5. 页面内部 Tab 的用户体验

同一代 Edit iframe 创建时处理全部合格图表：

1. 从该代权威源 HTML 发现并校验所有宿主和 Spec；
2. 使用源码中的固定宽高生成全部 SVG 字符串；
3. iframe 加载完成后，在同一个 pre-ready 提交中先应用当前
   `PageViewContext`，再把全部合格 SVG 挂到各自宿主；
4. 只有完成本次提交后，才确认该代 Edit Canvas ready。

未激活 Tab 仍由现有 `PageViewContext` 使用 `hidden` 或 `display:none` 隐藏。
它的宿主和 Shadow SVG 都保留在同一个 iframe 中。切换 Tab 只改变现有的
可见状态，因此：

- 图表切回来立即出现；
- 不重新执行 ECharts；
- 不重新请求、重新加载或重新挂载 SVG；
- 不读取隐藏元素的零宽高；
- 不增加图表自己的 generation、缓存或生命周期。

源 HTML 真正变化、打开另一文档、切换 Version 或权威 Canvas 重建时，现有
`DocumentSession` Canvas generation 会销毁旧 iframe。新一代 iframe 再按同一
流程渲染一次。这是已有 Canvas 生命周期，不是图表刷新循环。

## 6. 评论、选择和编辑

评论的语义目标是整个源码图表宿主，所以用户能够选中的是一个完整图表框，
不能直接评论某根柱、某个点或 SVG 内部文字。这个粒度与源码事实一致，也避免
运行时节点伪装成可持久化 TargetRef。

生成视觉及其全部子节点必须 `pointer-events:none`、不可选择、不可聚焦；
点击、拖选、IME、评论和编辑事件仍由原宿主及周围源码内容处理。

隐藏 Tab 中的评论继续使用当前规则：评论仍存在，但标记和页面坐标暂时隐藏。
切回该 Tab 后，现有 page-view generation 使评论系统重新解析相同 TargetRef，
按当前布局重测坐标。它不读取旧图表坐标，也不把 SVG 节点写进评论定位信息。

## 7. 静默失败与用户感知

不新增 toast、弹窗、占位图、失败徽标、重试按钮或“点击查看”。

| 情况 | 用户看到的结果 |
| --- | --- |
| 合格 Spec | Edit 初次可用时，图表已在原位显示 |
| 未声明 Chart Spec 的旧脚本图表 | 与现在一样，Edit 中可能为空；Preview 正常 |
| Spec 无效、超限或使用禁用能力 | 该图表静默保持源码静态状态 |
| 宿主不唯一、非空、已有 Shadow root 或宽高比不符 | 该图表静默不挂载 |
| Tab 隐藏 | 图表和评论标记一起不可见，但 SVG 保留 |
| Tab 再显示 | 原 SVG 立即显示，评论坐标重新测量 |
| 权威源变化 | 整个 Canvas 按现有机制换代；图表不单独闪烁刷新 |

正向收益是部分常用图表从“空白”变为“原位可见”。仍可能有以下负向感知：

- 初次建立 Edit iframe 需要同步生成一批 SVG，Canvas ready 可能比纯静态页稍晚；
- Edit 是静态、无 tooltip 和动画的视觉，可能与 Preview 的交互态存在细节差异；
- 窗口缩窄时 SVG 只按 viewBox 等比缩放，不重新排版，标签可能变小；
- 超出白名单的图表继续不可见，而且产品不会主动解释原因；
- 一个图表只有一个评论锚点，无法精确指向内部数据点；
- 作者 CSS 若覆盖声明的宽高比，图表会被静默拒绝，而不是猜测尺寸。

这些代价是有意边界。任何为了消除它们而引入重测、重渲染、缓存、提示系统
或脚本执行的需求，都必须重新做架构决策。

## 8. 安全与预算

校验器使用封闭字段集合，未知字段直接失败。它不做“删掉危险 option 后继续
渲染”，也不接受由作者提供的 ECharts option。

固定预算如下：

- 每份 Spec 最多 128 KiB；
- 每个文档最多 24 个图表；
- 单文档 Spec 总量最多 1 MiB、数据点总量最多 12,000；
- 每图最多 12 个 series、120 个 category、2,048 个数据点；
- SSR 宽 320–1,600、高 180–1,200；
- 每份 SVG 最多 512 KiB，单文档 SVG 总量最多 4 MiB；
- 数值必须有限且绝对值不超过 `1e12`；
- 文本长度、颜色和 ID 均有固定语法与长度上限。

输出 SVG 还必须通过独立校验：固定且匹配的 `width`、`height`、`viewBox`，
封闭元素集合，无脚本、foreignObject、image、事件属性、外部引用、危险 CSS、
DOCTYPE 或 ENTITY。PR-2 导入 iframe 时还要使用 XML parser 逐节点复验，不能
直接把未经复验的字符串写入 light DOM。

## 9. 生命周期和复杂度预算

本功能不创建新的事实 owner。合同和 option 映射是纯函数，ECharts 只在可信
renderer 中进行同步 SSR。生成字符串只活到当前 Canvas generation；Shadow
节点由现有 iframe realm 持有，iframe 销毁即全部释放。

浏览器不允许从一个仍存活的宿主上移除 Shadow root。因此，若同一源码宿主从
图表槽位变成普通内容，不尝试原地复用；权威源变化必须走已有 iframe 换代。

出现以下任一要求时停止扩展当前方案并重新评审：

- 需要执行或分析任意作者脚本；
- 需要接受 raw option、函数、HTML formatter、图片或网络资源；
- 需要按 ResizeObserver、隐藏元素宽高或动画帧持续重渲染；
- 需要第二页面、原生覆盖层、跨窗口坐标或截图；
- 需要图表缓存、后台重试、独立 Session 或新的 drain obligation；
- 需要把 SVG 内部节点变成可编辑或可持久化评论目标；
- 需要为失败状态增加一套用户提示和恢复流程。

## 10. 两次 PR 的执行规划

### PR-1：合同与安全内核

范围：

- 冻结源码槽位协议和 Chart Spec v0.1；
- 实现纯校验器、固定 ECharts mapper、SVG SSR 和输出校验；
- 固定 ECharts 6.1.0，补许可和依赖审计；
- Node 测试覆盖白名单、预算、恶意输入、固定 viewBox 和 TargetRef 稳定；
- 记录 ADR、架构边界、状态所有权和测试影响映射。

明确不做：导入 `HtmlCanvasEditor`、创建 Shadow root、改变 Edit ready、修改
Tab 或评论代码、启用默认行为。

### PR-2：一次接入与产品门禁

范围：

- 在同一 Canvas generation 内发现、预渲染和一次性挂载全部合格图表；
- Shadow DOM 导入端逐节点复验，保持 pointer/selection/ARIA 隔离；
- 接入现有 iframe teardown，不增加新的 Session、缓存或 observer；
- 覆盖初始激活 Tab、初始隐藏 Tab、往返切换、源换代和静默失败；
- 覆盖评论宿主、隐藏状态、切回重测、点击选框、跨槽位拖选和中文 IME；
- 使用真实 Electron 验证无作者脚本、无闪屏式重载、源和磁盘字节不变；
- 使用合成等价 fixture 覆盖柱、线、面积、堆叠、混合和散点；真实用户 HTML
  只作本地只读核对，不进入仓库。

PR-2 的 Go 条件：全部门禁证明上面的产品体验，且实现没有新增页面、窗口、
IPC、缓存、独立 generation、ResizeObserver 或生命周期 owner。否则停止，
不通过补丁式特例继续扩张。
