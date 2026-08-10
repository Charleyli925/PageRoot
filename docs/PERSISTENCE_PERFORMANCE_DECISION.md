# 完整 HTML 持久化性能决策

- 测量时间：2026-08-10T10:16:50.676Z
- Frozen main：`31e3bea58a5124cd56c87119e459877968de5109`（tree `71f443a8542edf67317c104082a69fbaa23e8f99`）
- Harness commit：`435c8876a99b9c396bf3dfccbaf4d808a8ef4e0d`
- Renderer artifact：`sha256:86c5eb6e74dfc95e190e194057d6d13ce2f6681c3c29bb723cad93a81817816b`
- Node / Electron：v25.7.0 / 43.2.0
- 机器：darwin 25.5.0 · arm64 · Apple M5 Pro
- 样本：每个尺寸 7 个有效样本，1 个 warmup；所有操作串行执行。

## 结论

**authorize-12-pr1** — 完整 HTML 未达到预先固定的体验预算；第 12-PR1（最小 full-HTML copy-path 优化）需要执行，12-PR2 仍未授权。

## 端到端结果（毫秒，p50 / p95 / max）

| HTML | Bridge transaction | Electron autosave（含 700ms debounce） | dirty switch | dirty close | clean close |
| --- | ---: | ---: | ---: | ---: | ---: |
| 0.5MiB | 157.4 / 162.9 / 162.9 | 2447.5 / 2484.2 / 2484.2 | 851 / 869 / 869 | 565.4 / 575.8 / 575.8 | 49.3 / 65.8 / 65.8 |
| 1.25MiB | 244.9 / 269 / 269 | 3404.1 / 3480.2 / 3480.2 | 1182.6 / 1209.7 / 1209.7 | 868.2 / 971.3 / 971.3 | 50.7 / 70.1 / 70.1 |
| 2.5MiB | 484.8 / 492 / 492 | 18616.3 / 18948.1 / 18948.1 | 1812.8 / 1884.9 / 1884.9 | 1386.7 / 3689.4 / 3689.4 | 84.9 / 150 / 150 |

## 传输、内存与事件循环（p95）

| HTML | request / response bytes | Bridge RSS delta MiB | renderer RSS delta MiB | renderer rAF gap ms | Bridge health-probe gap ms |
| --- | ---: | ---: | ---: | ---: | ---: |
| 0.5MiB | 525242 / 526511 | 5.9 | 133.1 | 113.4 | 15 |
| 1.25MiB | 1312508 / 1313777 | 7 | 177.3 | 232.3 | 32.9 |
| 2.5MiB | 2624614 / 2625883 | 9.6 | 425.6 | 2485.1 | 97.4 |

Bridge health-probe gap 是对独立 Bridge 进程可服务性的外部观测，不把它伪称为内部 event-loop profiler。renderer rAF gap 来自真实隐藏 Electron 窗口，并显式关闭 background throttling。

## 固定预算

| 指标 | 实测 p95 | 预算 | 结果 |
| --- | ---: | ---: | --- |
| Bridge transaction p95 | 492 ms | ≤500 ms | pass |
| Electron autosave p95 | 18948.1 ms | ≤1250 ms | fail |
| Dirty switch p95 | 1884.9 ms | ≤750 ms | fail |
| Dirty close p95 | 3689.4 ms | ≤750 ms | fail |
| Clean close p95 | 150 ms | ≤50 ms | fail |
| Renderer event-loop gap p95 | 2485.1 ms | ≤50 ms | fail |
| Bridge operation RSS delta p95 | 9.6 MiB | ≤32 MiB | pass |
| Renderer operation RSS delta p95 | 425.6 MiB | ≤32 MiB | fail |

- Bridge warm RSS 严格单调增长：0.5MiB=yes；1.25MiB=no；2.5MiB=no。

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
