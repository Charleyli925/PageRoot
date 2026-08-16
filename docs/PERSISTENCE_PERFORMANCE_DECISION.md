# 完整 HTML 持久化性能决策

- 测量时间：2026-08-10T10:45:29.777Z
- Frozen main：`31e3bea58a5124cd56c87119e459877968de5109`（tree `71f443a8542edf67317c104082a69fbaa23e8f99`）
- Harness commit：`cae2aead537f443565234a8d84249e426c0b0caf`
- Renderer artifact：`sha256:86c5eb6e74dfc95e190e194057d6d13ce2f6681c3c29bb723cad93a81817816b`
- Node / Electron：v25.7.0 / 43.2.0
- 机器：darwin 25.5.0 · arm64 · Apple M5 Pro
- 样本：每个尺寸 7 个有效样本，1 个 warmup；所有操作串行执行。

## 结论

**authorize-12-pr1** — 完整 HTML 未达到预先固定的体验预算；第 12-PR1（最小 full-HTML copy-path 优化）需要执行，12-PR2 仍未授权。

## 端到端结果（毫秒，p50 / p95 / max）

| HTML | Bridge transaction | Electron autosave（含 700ms debounce） | dirty switch | dirty close | clean close |
| --- | ---: | ---: | ---: | ---: | ---: |
| 0.5MiB | 162 / 165.3 / 165.3 | 1367.7 / 1377 / 1377 | 800.4 / 810.6 / 810.6 | 534.1 / 548.8 / 548.8 | 40.3 / 44.7 / 44.7 |
| 1.25MiB | 252.1 / 275.6 / 275.6 | 1766.8 / 1820 / 1820 | 1113.1 / 1129.8 / 1129.8 | 901.3 / 933.5 / 933.5 | 44.1 / 49.2 / 49.2 |
| 2.5MiB | 473.6 / 484.4 / 484.4 | 7671 / 7717 / 7717 | 1649.2 / 1736.3 / 1736.3 | 1318.4 / 1586.6 / 1586.6 | 68.2 / 75.4 / 75.4 |

## 传输、内存与事件循环（p95）

| HTML | request / response bytes | Bridge RSS delta MiB | renderer RSS delta MiB | renderer rAF gap ms | Bridge health-probe gap ms |
| --- | ---: | ---: | ---: | ---: | ---: |
| 0.5MiB | 525242 / 526511 | 5.9 | 129.3 | 104.8 | 17.7 |
| 1.25MiB | 1312508 / 1313777 | 7 | 178.4 | 223.5 | 34.5 |
| 2.5MiB | 2624614 / 2625883 | 5.3 | 443.1 | 2321 | 86.5 |

Bridge health-probe gap 是对独立 Bridge 进程可服务性的外部观测，不把它伪称为内部 event-loop profiler。renderer rAF gap 来自真实隐藏 Electron 窗口，并显式关闭 background throttling。

## 固定预算

| 指标 | 实测 p95 | 预算 | 结果 |
| --- | ---: | ---: | --- |
| Bridge transaction p95 | 484.4 ms | ≤500 ms | pass |
| Electron autosave p95 | 7717 ms | ≤1250 ms | fail |
| Dirty switch p95 | 1736.3 ms | ≤750 ms | fail |
| Dirty close p95 | 1586.6 ms | ≤750 ms | fail |
| Clean close p95 | 75.4 ms | ≤50 ms | fail |
| Renderer event-loop gap p95 | 2321 ms | ≤50 ms | fail |
| Bridge operation RSS delta p95 | 5.3 MiB | ≤32 MiB | pass |
| Renderer operation RSS delta p95 | 443.1 MiB | ≤32 MiB | fail |

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

## P1-B save-pipeline CAS（本分支）

P1-B 不改写上方冻结的 `main` 表。它合并 native-edit checkpoint 之后的第二段 700ms autosave 等待，并把 Working Copy 保存从八态 park journal 收成同目录两态 CAS（`prepared` → 原子 rename → `committed`），目标是把 keypress → disk 的 0.5MiB p50 从约 1.4s 降到 ≤0.9s。

**为什么合并第二段 700ms。** 岛内编辑已经按 `NATIVE_EDIT_CHECKPOINT_DELAY_MS = 700` 合并成一次 source patch。`DocumentWorkflow` 再等 700ms 才 flush，keypress → disk 就会叠到约 1.4s。Checkpoint 写入现在立即 flush（与 Cmd+S 相同）；非 checkpoint 只保留约 100ms debounce。`PROJECT.md` 仍是 700ms。岛 undo 粒度仍由 checkpoint 定时器决定。

**为什么 8 态收成 2 态。** 旧 park journal 在一次 atomic write 上重复 expected-hash 与 realpath。新保存只在边界与 kernel 各核一次：写 recovery 字节（`prepared`），同目录 tmp + 单次 expected-hash CAS rename，post-write hash 重读，然后 `committed`。Crash recovery 仍能读旧 journal，完成完整旧字节或完整新字节，绝不混写。干净 Working Copy 静默采纳磁盘外部修改；编辑器脏字节与磁盘同时变化则 `WORKING_COPY_CONFLICT`。每个 `#serial()` 回合缓存已验根（lstat、非 symlink、realpath），同一次保存不再对同一根重复走目录；缓存不跨回合，根被换成 symlink 后下一次保存仍失败。

### 2026-08-15 本分支测量

- 测量时间：`2026-08-15T10:28:37.544Z`
- 基线 HEAD：`4650cc6f4b657c2c2de1f687eaae6baf2c348af5`（P0-B / `origin/refactor/remove-legacy-bridge-stack`），加上本 P1-B 工作区改动
- Renderer artifact：`sha256:c59706ee4dbb18e2e0a82620cfcec82acd4acebda0553c6b4f9696e733438fac`
- Node / Electron：v25.7.0 / 43.2.0
- 机器：darwin 25.5.0 · arm64 · Apple M5 Pro
- 命令：`npm run benchmark:persistence -- --samples 3 --warmups 1 --sizes 0.5`（未跑 7 样本 × 三尺寸，也未 `--report` 覆盖冻结表）
- 0.5MiB Bridge transaction p50 / p95 / max：174.6 / 184.6 / 184.6 ms
- 0.5MiB Electron autosave（harness 的 keypress → `persistedRevision`）p50 / p95 / max：**442.7 / 462.2 / 462.2 ms**
- 目标 keypress → disk ≤0.9s：**达到**（冻结表同尺寸 Electron autosave p50 为 1367.7 ms）
- 安全 oracle：external-write conflict、`save-source-written` 重启恢复、exact source bytes 均为 passed
- 同一次 0.5MiB 跑次里 dirty switch p50 为 626.1 ms、dirty close p50 为 204.6 ms；clean close p50 为 2054.7 ms（冻结表为 40.3 ms）。clean close 不是 P1-B 接受指标，此处只记录，不编造解释。

