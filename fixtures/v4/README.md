# v4 项目文件 fixtures

这些是独立于 Repository 生成逻辑的最小 v4 持久化记录。它们用于证明
Registry、身份、manifest、runtime、Working Copy、Candidate 与 Promotion
transaction 的 Schema 合同；运行时不得把它们当成真实项目目录直接写入。

- `*.valid.json` 是每个 v4 Schema 的最小正例。
- `project-manifest.unknown-field.json` 是旧 `fileNaming` 字段的拒绝样本，
  用于确保 v4 不会静默读取旧协议字段。
