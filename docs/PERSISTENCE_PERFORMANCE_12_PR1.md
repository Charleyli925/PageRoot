# 12-PR1 Full-HTML copy-path checkpoint

- 测量时间：2026-08-10T09:46:44.565Z
- Frozen main：`31e3bea58a5124cd56c87119e459877968de5109`（tree `71f443a8542edf67317c104082a69fbaa23e8f99`）
- Candidate：`3b3a2bc0dc34156700311ff7f80182635fd7ea33`（tree `2b0563c44d6e0712e37a347c41ba8ca9fc605670`）
- Candidate production diff：app/workbench.tsx、app/workbench/browser-io.ts、bridge/workspace-bridge.mjs
- Harness commit：`3b3a2bc0dc34156700311ff7f80182635fd7ea33`
- Baseline evidence：`docs/PERSISTENCE_PERFORMANCE_DECISION.md`
- Final outcome：无收益的生产、测试和 benchmark 实验已在最终重基前撤回；最终分支只保留此 checkpoint 报告。
- Renderer artifact：`sha256:4aefd1813a7c2871ec4cc207ef0ad261e2312dc96cdaf8b23c62c4b48a4c1816`
- Node / Electron：v22.23.2 / 43.2.0
- 机器：darwin 25.5.0 · arm64 · Apple M5 Pro
- 样本：每个尺寸 7 个有效样本，1 个 warmup；所有操作串行执行。

## 结论

**close-12-pr1** — 该最小 full-HTML copy-path checkpoint 未达到预先固定的体验预算，生产实验已从最终候选撤回。12-PR2 仍未授权，只有新的只读 Patch 审计和用户授权才能重新开启它。

## 与 11 冻结基线的比较（2.5MiB p95）

| 指标 | 11 baseline | 12-PR1 checkpoint | 变化 | 判断 |
| --- | ---: | ---: | ---: | --- |
| Bridge response bytes | 2,625,883 B | 1,669 B | -99.94% | 成功删除 response 的完整 HTML 副本 |
| Bridge transaction | 530.9 ms | 616.1 ms | +16.0% | 变慢，且仍超 500 ms 预算 |
| Electron autosave | 20,602.7 ms | 18,082.0 ms | -12.2% | 改善不足约 30% 的 checkpoint 阈值 |
| dirty switch | 1,872.9 ms | 1,869.9 ms | -0.2% | 无显著收益 |
| dirty close | 1,392.0 ms | 1,364.1 ms | -2.0% | 无显著收益 |
| renderer rAF gap | 2,486.4 ms | 2,327.6 ms | -6.4% | 仍远超 50 ms 预算 |
| renderer RSS delta | 438.0 MiB | 429.9 MiB | -1.8% | 仍远超 32 MiB 预算 |

基线和 checkpoint 都在 Apple M5 Pro、Node 22.23.2、Electron 43.2.0、同一 fixture 和 1 warmup + 7 effective samples 下串行采集。曾以 Node 25.7.0 运行的试测因运行时漂移未纳入本结论。

## 端到端结果（毫秒，p50 / p95 / max）

| HTML | Bridge transaction | Electron autosave（含 700ms debounce） | dirty switch | dirty close | clean close |
| --- | ---: | ---: | ---: | ---: | ---: |
| 0.5MiB | 187 / 199.2 / 199.2 | 2369.4 / 2415.7 / 2415.7 | 807.9 / 837.5 / 837.5 | 517.7 / 525.1 / 525.1 | 41.9 / 48.8 / 48.8 |
| 1.25MiB | 337.2 / 348.4 / 348.4 | 3304.3 / 3382.4 / 3382.4 | 1146.8 / 1186 / 1186 | 889.4 / 930.5 / 930.5 | 48.3 / 48.9 / 48.9 |
| 2.5MiB | 585.5 / 616.1 / 616.1 | 17940.5 / 18082 / 18082 | 1845.9 / 1869.9 / 1869.9 | 1339.8 / 1364.1 / 1364.1 | 70.1 / 73.8 / 73.8 |

## 传输、内存与事件循环（p95）

| HTML | request / response bytes | Bridge RSS delta MiB | renderer RSS delta MiB | renderer rAF gap ms | Bridge health-probe gap ms |
| --- | ---: | ---: | ---: | ---: | ---: |
| 0.5MiB | 525242 / 1668 | 16.6 | 128.2 | 100.7 | 26.4 |
| 1.25MiB | 1312508 / 1671 | 74.1 | 202.2 | 226.9 | 60.5 |
| 2.5MiB | 2624614 / 1669 | 101.8 | 429.9 | 2327.6 | 179.9 |

Bridge health-probe gap 是对独立 Bridge 进程可服务性的外部观测，不把它伪称为内部 event-loop profiler。renderer rAF gap 来自真实隐藏 Electron 窗口，并显式关闭 background throttling。

## 固定预算

| 指标 | 实测 p95 | 预算 | 结果 |
| --- | ---: | ---: | --- |
| Bridge transaction p95 | 616.1 ms | ≤500 ms | fail |
| Electron autosave p95 | 18082 ms | ≤1250 ms | fail |
| Dirty switch p95 | 1869.9 ms | ≤750 ms | fail |
| Dirty close p95 | 1364.1 ms | ≤750 ms | fail |
| Clean close p95 | 73.8 ms | ≤50 ms | fail |
| Renderer event-loop gap p95 | 2327.6 ms | ≤50 ms | fail |
| Bridge operation RSS delta p95 | 101.8 MiB | ≤32 MiB | fail |
| Renderer operation RSS delta p95 | 429.9 MiB | ≤32 MiB | fail |

- Bridge warm RSS 严格单调增长：0.5MiB=no；1.25MiB=no；2.5MiB=no。

## 安全 oracle

| HTML | external-write conflict | restart recovery | exact source bytes |
| --- | --- | --- | --- |
| 0.5MiB | passed | passed | passed |
| 1.25MiB | passed | passed | passed |
| 2.5MiB | passed | passed | passed |

每个尺寸均用独立 synthetic HTML：正常 autosave 同时校验 request/response 字节、返回 Hash 与磁盘精确字节；额外运行外部写冲突和 `after-autosave-prepared` 重启恢复。未关闭 Hash/CAS、同目录原子替换、source-history、recovery 或 exact-byte oracle。

## 复现

从已安装依赖、检出 candidate `3b3a2bc0dc34156700311ff7f80182635fd7ea33` 的 checkout 运行：

```bash
PAGEROOT_NODE22=/opt/homebrew/Cellar/node@22/22.23.2/bin/node
"$PAGEROOT_NODE22" node_modules/vite/bin/vite.js build --config desktop/vite.config.ts
"$PAGEROOT_NODE22" scripts/benchmark-persistence.mjs --samples 7 --warmups 1 --allow-production-changes --report docs/PERSISTENCE_PERFORMANCE_12_PR1.md
```

命令只构建一次 Electron renderer，并在该固定 artifact 上依次运行 0.5MiB → 1.25MiB → 2.5MiB。它不改生产代码、不生成真实用户 HTML；完整原始结构化数据写入忽略的 `output/persistence-performance/`。
