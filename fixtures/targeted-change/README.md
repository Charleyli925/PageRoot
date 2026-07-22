# Targeted Change 固定样本

这组文件是源码局部修改引擎与 AI ScopeValidator 的发布门禁输入。

- `expected-targets.json` 的 `schemaVersion=1.0.0` 只标识这份测试清单自身的格式，不是工作区主记录 Schema。
- 源码 offset 一律按 JavaScript UTF-16 code unit 计算。
- `source-index-crlf.html` 必须保持 CRLF。
- 预览注入的 nodeId、编辑器样式和安全标记不得写入这些源文件。
- 每次 Patch 都必须证明允许范围外字符串不变。
- `structure-and-reorder.html` 的重复 id、相同文字、注释、空白与同级文字节点用于验证失败关闭和排序片段归属。
- 排序目标不能把 `nth-*` 位置当作持久身份；位置变化后必须结合文本和指纹唯一 rebound，否则返回 ambiguous/orphaned。
- `styles-and-scope.html` 用于验证 inline style 精确写入，以及目标外 CSS、JavaScript 和正文变更检测。
