# 完整 HTML 持久化性能决策

- 测量时间：2026-08-10T10:30:42.191Z
- Frozen main：`31e3bea58a5124cd56c87119e459877968de5109`（tree `71f443a8542edf67317c104082a69fbaa23e8f99`）
- Harness commit：`a583b33b07a6876bf76b02972f0d851e849a8a5a`
- Renderer artifact：`sha256:86c5eb6e74dfc95e190e194057d6d13ce2f6681c3c29bb723cad93a81817816b`
- Node / Electron：v25.7.0 / 43.2.0
- 机器：darwin 25.5.0 · arm64 · Apple M5 Pro
- 样本：每个尺寸 7 个有效样本，1 个 warmup；所有操作串行执行。

## 结论

**authorize-12-pr1** — 完整 HTML 未达到预先固定的体验预算；第 12-PR1（最小 full-HTML copy-path 优化）需要执行，12-PR2 仍未授权。

## 端到端结果（毫秒，p50 / p95 / max）

| HTML | Bridge transaction | Electron autosave（含 700ms debounce） | dirty switch | dirty close | clean close |
| --- | ---: | ---: | ---: | ---: | ---: |
| 0.5MiB | 162 / 164.2 / 164.2 | 1369.4 / 1382.6 / 1382.6 | 788.6 / 807.2 / 807.2 | 558.1 / 596 / 596 | 44.3 / 48.6 / 48.6 |
| 1.25MiB | 248 / 271.7 / 271.7 | 1830.4 / 1848.5 / 1848.5 | 1116.8 / 1160 / 1160 | 869.5 / 947.9 / 947.9 | 50.1 / 66.7 / 66.7 |
| 2.5MiB | 481 / 510 / 510 | 7894.5 / 7912.9 / 7912.9 | 1735.8 / 1772.4 / 1772.4 | 1366 / 1590.5 / 1590.5 | 69.2 / 84.1 / 84.1 |

## 传输、内存与事件循环（p95）

| HTML | request / response bytes | Bridge RSS delta MiB | renderer RSS delta MiB | renderer rAF gap ms | Bridge health-probe gap ms |
| --- | ---: | ---: | ---: | ---: | ---: |
| 0.5MiB | 525242 / 526511 | 5.8 | 122.9 | 106.9 | 15.8 |
| 1.25MiB | 1312508 / 1313777 | 18.1 | 178.4 | 226 | 29.1 |
| 2.5MiB | 2624614 / 2625883 | 259.4 | 443.8 | 2361.4 | 92.1 |

Bridge health-probe gap 是对独立 Bridge 进程可服务性的外部观测，不把它伪称为内部 event-loop profiler。renderer rAF gap 来自真实隐藏 Electron 窗口，并显式关闭 background throttling。

## 固定预算

| 指标 | 实测 p95 | 预算 | 结果 |
| --- | ---: | ---: | --- |
| Bridge transaction p95 | 510 ms | ≤500 ms | fail |
| Electron autosave p95 | 7912.9 ms | ≤1250 ms | fail |
| Dirty switch p95 | 1772.4 ms | ≤750 ms | fail |
| Dirty close p95 | 1590.5 ms | ≤750 ms | fail |
| Clean close p95 | 84.1 ms | ≤50 ms | fail |
| Renderer event-loop gap p95 | 2361.4 ms | ≤50 ms | fail |
| Bridge operation RSS delta p95 | 259.4 MiB | ≤32 MiB | fail |
| Renderer operation RSS delta p95 | 443.8 MiB | ≤32 MiB | fail |

- Bridge warm RSS 严格单调增长：0.5MiB=yes；1.25MiB=yes；2.5MiB=yes。

## 安全 oracle

| HTML | external-write conflict | restart recovery | exact source bytes |
| --- | --- | --- | --- |
| 0.5MiB | passed | passed | passed |
| 1.25MiB | passed | passed | passed |
| 2.5MiB | passed | passed | passed |

每个尺寸均用独立 synthetic HTML：正常 autosave 同时校验 request/response 字节、返回 Hash 与磁盘精确字节；额外运行外部写冲突和 `after-autosave-prepared` 重启恢复。未关闭 Hash/CAS、同目录原子替换、source-history、recovery 或 exact-byte oracle。

## 复现

从干净、已安装依赖的 checkout 运行：

```bash
npm run benchmark:persistence -- --samples 7 --warmups 1 --report docs/PERSISTENCE_PERFORMANCE_DECISION.md
```

命令只构建一次 Electron renderer，并在该固定 artifact 上依次运行 0.5MiB → 1.25MiB → 2.5MiB。它不改生产代码、不生成真实用户 HTML；完整原始结构化数据写入忽略的 `output/persistence-performance/`。
