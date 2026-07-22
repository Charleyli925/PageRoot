# PageRoot 输入法事件与发布矩阵

本文件是输入法问题的长期回归合同。真实 HTML 的 authored DOM 与源码是
唯一事实源；输入法候选期产生的 marked text 或临时 inline wrapper 只属于
一次 composition epoch，不能进入源码、历史或下一轮 DOM baseline。

## 已确认的真实故障模式

1. Apple 简体拼音在完整选中 `<em>Word</em>` 后组词。输入到 `ni h` 时，
   Chromium 会把 authored `<em>` 临时替换为无属性 `<i>ni h</i>`；确认后为
   `<i>你好</i>`。旧结构守卫把这当作网页篡改并回滚，因此用户看到光标、
   候选和最终输入全部消失。
2. `compositionend` 与最终 `beforeinput/input` 的顺序不是固定的；空
   `compositionend.data` 也可能只是最终 delivery 尚未到达，不能只靠一个
   空字符串永久判定取消。
3. Escape、工具栏 pointer gesture、focusout 和 window blur 会产生不同的
   结束顺序；迟到的旧 input 不能继承到下一次 composition。
4. Chromium 会把脚本构造的 `InputEvent(inputType="insertFromComposition")`
   归一化为空 `inputType`。自动化用浏览器可构造的 `insertText` 覆盖同一终态，
   真实事件兼容仍保留 `insertFromComposition`。
5. SourcePatch 已提交但 canonical DOM/runtime map 重绑失败时，旧实现可能再次
   rebase，把临时 `<i>` 当作 authored baseline。现在该路径必须结束会话并从
   已提交源码重载，不能做第二次 rebase。

真实 Apple 拼音轨迹保存在
`tests/fixtures/native-dom/apple-pinyin-em-wrapper-trace.json`。

## 系统解法

- `compositionstart` 冻结 authored DOM、logical text、Selection 方向、源码映射
  和本次 intent 起点，并建立唯一 epoch id。
- composition 候选可以更新真实 DOM，但不产生 SourcePatch。
- 最终文字必须严格等于“冻结选区之前 + terminal data + 冻结选区之后”；共有
  前后缀不能缩窄真实授权范围。
- 只临时允许输出覆盖区内、HTML namespace、无属性、非空的透明 inline
  wrapper；覆盖区外的 authored 节点身份、父子关系、顺序、属性和文字所有权
  必须完全不变。
- Escape/失焦恢复 composition-start 快照；cancelled-drain 只吸收该 epoch 的
  迟到空 delivery。
- 临时结构一经确认，立即走一次且仅一次：

  `logical replacement → SourceTextMap → SourcePatch → 新 SourceIndex → canonical authored DOM → RuntimeDomSourceMap → baseline rebase`

- SourcePatch 前失败：恢复快照，源码和历史为零变化。SourcePatch 后 reconcile
  失败：从已提交源码重载，绝不保留临时 DOM。
- canonical reconcile 完成前阻止第二次输入或外层命令，避免两个 epoch 共用
  临时树或映射。

## 自动化矩阵

| 类别 | 必须证明的结果 | 自动化层 |
|---|---|---|
| 标准 composition | 候选不进源码，确认只形成一个 undo 单元 | Browser CDP + Electron CDP |
| Apple wrapper trace | `<em>Word</em> → <i>ni hao</i> → <em>你好</em>`，只改 `Word` 字节 | Browser replay + Electron disk |
| 终端顺序 | final input 在 end 前/后、空 end 后 non-empty tail，均不重复或漏交 | Browser |
| 取消与 stale tail | Escape/空 end 恢复 DOM、Selection、源码和历史；旧 tail 不污染新 epoch | Browser |
| Selection | forward、reverse、collapsed caret、共有前缀替换 | Browser |
| 焦点边界 | 工具栏、focusout、window blur 不提交中间拼音，prior dirty edit 不丢 | Browser |
| 临时结构安全 | 越界、属性、atom、foreign/未知结构、所有权漂移全部整笔拒绝 | Browser |
| canonical 故障 | 已提交 Patch 只记一次，iframe 从源码重载，临时树不成为 baseline | Browser fault injection |
| Unicode | emoji、组合音标、ZWJ 序列按用户可见字符删除，无孤立 surrogate | Browser + Electron |
| 磁盘闭环 | 保存、关闭重开、undo 原 SHA、redo 同一 forward Patch | Electron disk |
| 复杂 HTML | 准入前后布局稳定；不可证明区域降级评论；未命中字节不变 | Real HTML gate |

输入录制器必须保留单调序号、keydown/keyup、composition、beforeinput/input、
`inputType/data/isComposing/isTrusted`、Selection anchor/focus/direction、活动宿主、
每一步 innerHTML/textContent 和 MutationObserver 摘要。今后发现输入法差异时，
先录制真实事件，再把轨迹加入此矩阵，不用延时猜测事件顺序。

## 无人值守发布顺序

1. `gate:release:auto` 完成全部 Node、Browser、Electron、复杂 HTML、持久化和故障注入门禁。
2. `gate:artifact:auto` 复用同一次构建，生成候选 DMG，启动真实 packaged `.app`，再完成 app.asar、Bridge、Schema、签名、DMG 与只读挂载校验。
3. 每一步由源码字节、SHA、状态字段、DOM/Selection/几何或包清单自动判断，并写入 `output/test-runs/`；不等待人员接力。
4. 第三方 macOS 输入法候选窗在出现稳定的 OS 级自动驱动前不进入发布门禁。新增真实轨迹时先固化为可回放 fixture，再补独立机器 oracle，不能用人工清单填补自动化空白。
