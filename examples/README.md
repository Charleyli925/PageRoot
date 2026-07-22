# v3 examples

这些示例只展示活动 v3 主记录：

- `annotation-records.history.example.json`：冻结评论和直接编辑审计，目标使用 v3 TargetRef。
- `change-request.insert-section.example.json`：使用零宽 `sourceAnchor` 的 insertion-point Request，并强制 `preserveOutsideTargets=true`。
- `version-manifest.history.example.json`：一次成功内部 AI Version 的不可变 manifest。

示例不包含 `moduleSelector`、旧 `anchor`、`focusTargets`、`local-editor`、`restore`、migration 字段或兼容 fallback。辅助工件名称中的 v1 是其自身当前合同版本，不表示可读取旧主记录。
