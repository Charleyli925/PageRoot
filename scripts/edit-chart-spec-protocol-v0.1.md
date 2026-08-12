# PageRoot Chart Spec 生成协议 v0.1

本文件只在 `PROMPT.md` 的“编辑态图表兼容”条件成立时读取。它只负责让已有的、可精确表达的静态图表在 PageRoot 编辑态可见，不授权重设计页面或执行作者脚本。

## 1. 不可违反的原则

1. Preview 中的前端效果必须保持不变。不得为兼容编辑态而改动原文案、数字、数据、顺序、颜色、字体、尺寸、布局、CSS、脚本、ECharts option、动画、交互或展示方式。
2. Chart Spec 是附加的声明式投影，不是新的业务真相。数据只能逐项抄自现有 HTML/JavaScript，不得猜测、计算补全、四舍五入或改写。
3. 原图表宿主、原脚本和原 option 必须保留，Preview 仍由它们渲染。只可在合格宿主上增补本协议指定的属性，并增补一个 JSON `<template>`。
4. 不支持、不确定、数据无法精确对应，或增补后可能改变 Preview 时，跳过该图表。不降级、不近似、不用占位数据。
5. 本协议不授权修改任务无关的任何内容。未受影响的宿主和已有 Spec 保持原文，不重排属性、不重新格式化 JSON。

## 2. 什么时候处理

### 首次补齐

仅当 `PROMPT.md` 判定为首次补齐时，可扫描整份冻结 HTML，为其中所有可精确映射且符合本协议的图表增补声明。这是一次性的、仅限 Chart Spec 元数据的扩展范围；不授权其他全页修改。

### 日常维护

- 本轮与图表无关：不修改任何图表宿主或 Spec。
- 本轮新增或修改某个图表：只为该图表新增或同步 Spec。
- 本轮删除某个图表：同时删除该图表的配对 Spec。
- 修改后的图表不再符合白名单，或无法继续精确同步：只移除该图表的 `data-report-chart-*` 兼容属性和配对 `<template>`，保留原图表代码。

## 3. 支持范围

只支持静态、只读的笛卡尔图：

- 分类轴：纵向或横向柱状图、堆叠柱状图、折线图、面积图、堆叠面积图、柱线混合图。
- 数值轴：只含 `[x, y]` 两维点的静态散点图。
- 静态信息：标题、图例开关、横纵轴名、十六进制纯色、有限数值、`null` 空点、折线平滑、固定点符号、声明式 stack ID。

不支持：饼图、环图、雷达、地图、热力、树图、关系图、桑基、仪表、瀑布、自定义 series、双 Y 轴、dataset transform、回归线、气泡第三维、tooltip、markPoint、markLine、动画、图例交互、刷选、回调函数、formatter、HTML、图片、渐变、外部 URL、作者主题和原始 ECharts option。tooltip、动画或 markPoint 等只是附加能力时，可保留原 Preview 代码而不写入 Spec；若不支持能力改变了图表的核心类型、几何、数据维度或含义，整个图表必须跳过。

## 4. 宿主协议

宿主必须是源码中原本由 JavaScript/ECharts 填充的空 `<div>`。它必须有唯一 `id`，并增补以下属性：

```html
<div
  id="sales-chart"
  data-report-chart-slot="cartesian-v0.1"
  data-report-chart-spec-id="sales-chart-spec"
  data-report-chart-width="640"
  data-report-chart-height="320"
  role="img"
  aria-label="季度销售趋势图"
  style="width:100%;aspect-ratio:2 / 1"
></div>
```

硬性要求：

- `data-report-chart-slot` 只能是 `cartesian-v0.1`。
- `data-report-chart-spec-id` 引用本图表唯一的 Spec template ID；宿主 ID 与 template ID 不能相同。
- 宿主 ID 和 template ID 必须以字母开头，后续只能含字母、数字、`_`、`.`、`:` 或 `-`，最多 128 个字符。
- SSR 宽度为 320–1600 的整数，高度为 180–1200 的整数。它们必须描述原页面已有图表槽位的设计比例，不得改变槽位尺寸。
- 宿主 inline `style` 中必须有与 `width / height` 等价的 `aspect-ratio`，误差不超过 0.1%。保留原 style 的所有其他声明和顺序；若无法在不改变 Preview 布局的前提下补入，跳过。
- `role="img"` 与准确的、非空 `aria-label` 必须存在。
- 宿主源码内只允许空白文本，不能包含 fallback、canvas、SVG 或其他元素。
- 只给本来就是图表槽位的元素加属性；不新建可见包装层。

## 5. Spec template

每个宿主对应一个独立 template：

```html
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

- template ID 在整份 HTML 中唯一，`data-report-chart-spec` 只能是 `0.1`。
- template 内只能有一个 JSON 文本节点；不能包含元素、注释、表达式或脚本。
- template 不能放在空宿主内。一个 template 只能被一个宿主引用。
- 优先将新 template 放在 `</head>` 前，以降低对正文结构和 TargetRef 的影响。若页面的选择器或脚本依赖该位置的元素顺序，选择一个不会改变 Preview 行为的惰性位置；无法确定时跳过。

## 6. JSON 字段

根对象是封闭字段集，只允许：

- 必填：`version`、`mode`、`series`。
- 可选：`title`、`legend`、`orientation`、`xAxisName`、`yAxisName`、`categories`。
- `version` 只能是字符串 `0.1`；`mode` 只能是 `category` 或 `numeric`；`legend` 只能是布尔；`title`、`xAxisName` 和 `yAxisName` 只能是非空文本。
- 未知字段会使整份 Spec 失效，不要附加原 option 或其他元数据。

### 分类轴 `mode: "category"`

- 必填 `categories`：1–120 个非空字符串。
- `orientation` 只能是 `vertical` 或 `horizontal`，默认 `vertical`。
- 每个 series 必填 `id`、`name`、`type`、`values`，只可另外使用 `color`、`stack`、`area`、`smooth`、`symbol`。
- `type` 只能是 `bar` 或 `line`。`values` 长度必须与 categories 完全一致，元素只能是有限数值或 `null`。
- `area`、`smooth` 只能用于 line，值为布尔。`symbol` 只能是 `none` 或 `circle`。
- `stack` 是声明式 ID；只有 stack ID 相同的 series 堆叠。

### 数值散点 `mode: "numeric"`

```json
{
  "version": "0.1",
  "mode": "numeric",
  "xAxisName": "规模",
  "yAxisName": "增速",
  "series": [
    {"id":"market","name":"市场","type":"scatter","points":[[10,2.5],[18,4.1]],"color":"#5070DD","symbolSize":10}
  ]
}
```

- numeric 模式不得出现 `categories` 或 `orientation`。
- 每个 series 必填 `id`、`name`、`type`、`points`，只可另外使用 `color`、`symbolSize`。
- `type` 只能是 `scatter`；每个 point 必须恰好是 `[x, y]`。
- `symbolSize` 只能是 2–40 的整数。不得将第三维气泡大小强行压成一个值。

### 通用约束

- 每图 1–12 个 series，series ID 在本 Spec 内唯一。ID 由字母或数字开头，后续只能含字母、数字、`_` 或 `-`，最多 64 个字符。
- 一般文本最多 120 个 Unicode 字符，category 和 series name 最多 80 个；不得包含控制字符、`<` 或 `>`、URL 协议或 `//`。
- 数值必须有限，绝对值不超过 `1e12`。
- 颜色只能是 `#RRGGBB` 或 `#RRGGBBAA`；不接受颜色名、CSS 变量、rgb()、渐变或图片。
- 每图最多 2,048 个数据点，JSON UTF-8 最多 128 KiB。
- 每份文档最多 24 个图表、Spec 合计最多 1 MiB、数据点合计最多 12,000。超限时不要通过丢数据来凑合，跳过超限图表。

## 7. 完成前检查

- 原 Preview 的文案、数据、颜色、尺寸、CSS、脚本、option、交互和布局均未因兼容而改变。
- 只处理了 `PROMPT.md` 授权的首次补齐或本轮受影响图表。
- 宿主仍是源码空 `<div>`，ID 唯一，宽高比与原槽位一致。
- 每个宿主与 template 一对一，JSON 字段封闭，数据与原图逐项一致。
- 不支持或不确定的图表已被静默跳过，没有被近似改写。
