# PR6：收敛桌面包、候选和 provenance 重复合同

> 建议分支：`test/delivery-contract-consolidation`
> 批次：第二批，可与 PR2、PR4、PR5 并行开发
> 严格前置：PR1 已合并，分支基于其后的最新 `origin/main`
> 单一结果：package test 只拥有文件闭包和信任边界，行为由其生产 owner，交付证据 fixture 只保留一份
> 预估净减少：1,500–2,000 行测试代码；估算不是删除授权

## 背景和目标

当前 `tests/desktop-package.test.mjs` 是一个 633 行单测试：读取约 28 个生产/配置文件，并用约 250 条 regex 同时证明 package allowlist、preload API、update controller、Preview、Bridge、telemetry、entitlements 和 retired code。

这些边界中只有“包里必须有什么/绝不能有什么、CSP/entitlements、Bridge/Schema/resource 闭包”属于 package owner。Update、preload IPC、Preview URL、安全 sender、窗口策略等已有独立行为测试。另一方面，release app、developer preview、candidate/source provenance 测试反复构造 identity、build-info、telemetry 和临时 bundle fixture。

本 PR 将 delivery 测试按 owner 收敛：

- package 文件只证明 manifest/allowlist/resource/trust boundary；
- `verifyAppBundle`/`verifyPackagedArtifact` 继续对真实/临时 artifact 做字节和 metadata 验证；
- update/preload/preview/window 行为留给其独立 Node owner；
- release identity/build-info/telemetry fixture 使用返回 fresh object 的公共 builder；
- 不修改 workflow、签名、公证或发布行为。

## 事实与根因

### 1. 关键文件和现有 owner

| 文件 | 行数 | 事实 |
| --- | ---: | --- |
| `tests/desktop-package.test.mjs` | 633 | 单个 mega-test，读取 package、main/preload/renderer、20+ desktop/scripts/resource 文件 |
| `tests/packaged-artifact-gate.test.mjs` | 704 | 真实调用/模拟 artifact verifier，并扫描 release command/trust boundary |
| `tests/release-app-stage.test.mjs` | 714 | app assemble/sign/notary/checkpoint/metadata restore fixture |
| `tests/developer-preview-package.test.mjs` | 数百行 | stable-tag sequence identity、独立 Bundle、delivery report |
| `tests/release-candidate-provenance.test.mjs` | 数百行 | candidate identity、bundle create/verify/resolve |
| `tests/source-gate-provenance.test.mjs` | 数百行 | exact tree/version/PR source attestation 和 workflow wiring |

现有可复用生产 verifier：

- `scripts/verify-packaged-artifact.mjs::expectedArtifactLayout`
- `assertNoRetiredEditorArtifacts`
- `verifyAppBundle`
- `verifyPackagedArtifact`
- `appBundleSignaturePolicyForProfile`
- `scripts/release-app-stage.mjs` 的路径、builder args、environment、sign/notarize/restore exports
- `scripts/source-gate-provenance.mjs::evaluateSourceGateEvidence`
- `scripts/release-candidate-provenance.mjs::evaluateReleaseCandidateEvidence` / `verifyReleaseCandidateBundle`

行为 owner 已存在：

- `tests/desktop-preload-ipc.test.mjs`
- `tests/application-update.test.mjs`
- `tests/preview-protocol.test.mjs`
- `tests/electron-window-policy.test.mjs`
- `tests/open-in-default-browser.test.mjs`
- `tests/bridge-startup.test.mjs` / `bridge-shutdown.test.mjs`
- packaged runtime/startup Playwright specs

### 2. package mega-test 的根因

```text
担心某模块漏包或错误暴露 IPC
  -> desktop-package 读取所有源码并 regex
  -> 同一行为又由 controller/preload/preview/window test 证明
  -> verifyAppBundle 再对实际 app.asar/resource 验证
```

应保留的 package oracle 是“最终 manifest/artifact 中包含/排除什么”，而不是每个生产函数的实现文本。

### 3. 交付链不可削弱

```text
Ready source gate exact Tree/version
  -> Release Candidate pre-sign App verify
  -> Developer ID sign + signed startup
  -> notarized App checkpoint
  -> same App as --prepackaged input
  -> DMG/ZIP/blockmap/latest-mac verify
  -> Release reverify exact bytes
  -> immutable tag/publication
```

Developer Preview 和 Release Dry Run 是独立非发布通道，不能与正式 Candidate 身份/凭证混用。fixture 去重不得模糊这三种 profile。

## 修改清单

### `tests/desktop-package.test.mjs`

将单一 mega-test 拆为少量具名 package contract，保留：

1. `package.json build.files` 必须包含主进程、preload、renderer、Bridge dependency closure、schemas、resource、disclaimer、runtime capture/update/preview 必要文件；
2. retired editor/manual update 文件和依赖不得回归；
3. renderer CSP 对 frame/custom preview protocol 的必要允许和对危险能力的拒绝；
4. entitlements 只包含正式需要项，禁止 library validation 逃逸；
5. package identity、appId、artifact profile 和 updater dependency 的固定边界；
6. new owner 文件加入 package allowlist 时能被此测试发现。

从本文件删除并交回 owner：

- updater 状态机/autoDownload/quitAndInstall → `application-update.test.mjs`；
- preload method/channel/payload/sender → `desktop-preload-ipc.test.mjs`；
- Preview containment/path/navigation → `preview-protocol.test.mjs` / window policy；
- external browser/project file behavior → 对应 controller/IPC tests；
- telemetry event behavior → `usage-telemetry.test.mjs`；
- Bridge lifecycle/transaction行为 → Bridge tests；
- Workbench/UI copy → Browser/Electron owner。

允许少量源码字符串的条件：它必须直接证明 package/security/dependency boundary，且最终 artifact verifier 无法在未构建时低成本证明。每条保留断言加一行 owner 原因。

### `tests/packaged-artifact-gate.test.mjs`

保留真实 verifier 调用和 trust profile：

- app.asar、Bridge、Schema、resources、plist/version/build-info/telemetry；
- retired artifact closure；
- candidate/dry-run/developer signature policy 分离；
- restored renderer oracle 缺失、telemetry metadata 缺失等回归；
- DMG/ZIP/blockmap/latest-mac 和 notarization/stapling 边界。

将重复的“缺少文件/篡改文件”案例改为数据表，每个 case 包含：fixture mutation、expected error code/message、profile、是否允许 unsigned。不要把所有失败只合并为 `rejects`。

若 workflow 文本扫描只是在重复 verifier 行为，删除；若它证明凭证使用顺序、无 secrets、tag/release 不在 dry-run，保留为显式 release architecture boundary。

### 新增 `tests/helpers/release-evidence-fixtures.mjs`

提供 fresh builder，不提供共享 mutable fixture：

- `fixturePackageJson(profile)`
- `fixtureBuildInfo(overrides)`
- `fixtureTelemetryConfig(profile, overrides)`
- `fixtureSourceGateIdentity(overrides)`
- `fixtureCandidateIdentity(overrides)`
- `createSyntheticAppBundle(t, options)`（仅在至少两个测试需要完全相同目录闭包时）

约束：

- 每次返回新对象/新 Buffer；
- profile 必须显式为 developer、dry-run、candidate 或 release，不设会混淆信任的默认值；
- Hash 用独立 `crypto` 计算，不调用被测 evaluator 生成期望；
- 每 test 独立 temp root，`t.after` 清理；
- builder 不签名、不执行 Apple 命令、不访问网络。

### `tests/release-app-stage.test.mjs`

- 使用公共 package/build-info/telemetry/identity builder；
- 保留 assemble arguments、identity null vs ad-hoc、sign stage、notary stage、checkpoint restore 和 exact metadata bytes；
- 将相同 profile 差异改为数据表；
- 不合并 pre-sign verify、signed startup、notary checkpoint、artifact restore 的独立阶段。

### `tests/developer-preview-package.test.mjs`

- 使用公共 package/identity fixture；
- 保留 stable official tag 后 first-parent sequence、独立 product name/appId、ad-hoc package args、startup identity、live PR/content report contract；
- Developer Preview 仍不能被 formal lanes 自动调用；
- 不把 developer identity builder 与 candidate identity 合并为无 profile 的宽泛对象。

### `tests/source-gate-provenance.test.mjs`

- 使用公共 source identity fixture；
- 保留 package/lock version equality、Tree Hash、PR/head/base、凭证时效和 workflow 依赖顺序；
- 保留 release/dry-run/candidate 的信任分隔；
- workflow regex 只保留 exact-tree provenance/security/ordering，不检查普通 step copy。

### `tests/release-candidate-provenance.test.mjs`

- 使用公共 candidate identity/build-info fixture；
- 保留 artifact name、run attempt、Tree/version/arch、bundle hash、72h/7d freshness、resolve/verify fail closed；
- 篡改/缺失字段用表驱动但每种 error 独立可诊断。

### `tests/release-provenance.test.mjs`、`tests/package-delivery-report.test.mjs`

仅在确认重复构造相同 identity/build-info 时使用公共 fixture。不要因“文件较大”扩大删除；它们各自的 tag/assets/live PR report 仍为独立 owner。

### 明确不修改的文件

除非测试暴露当前合同不一致并先触发停止报告，不修改：

- `.github/workflows/*.yml`
- `scripts/verify-packaged-artifact.mjs`
- `scripts/release-app-stage.mjs`
- `scripts/source-gate-provenance.mjs`
- `scripts/release-candidate-provenance.mjs`
- `package.json` build 配置
- `desktop/**` 生产文件

本 PR 是测试 ownership/fixture 收敛，不是 release pipeline 重构。

### `scripts/test-node-group.mjs`

- 新 helper test 如有，按 package group 分类；
- 所有顶层 package tests 仍恰好属于 package 组；
- 不把 package tests 移出完整 Node 以减少数量。

### `tests/test-impact-map.json`

- packaging/release/provenance 路径选择直接 owner；
- `desktop/application-update.mjs` 不再因 package regex 选择整个 desktop-package；
- package allowlist/manifest/verifier 变化仍选择 desktop-package + packaged-artifact owner；
- workflow 变化仍选择 provenance/release architecture owner；
- 保持 PR1 release lane 完整列表。

### `tests/test-gate-selection.test.mjs`

增加 package manifest、verifier、workflow、update controller 的精确 ownership 回归，防止再次把所有 delivery tests 绑定到任一 desktop 文件。

### `tests/TEST_STRATEGY.md`

记录：

- package source contract、artifact verifier、runtime startup、provenance 各自 owner；
- developer/dry-run/candidate/release profile 隔离；
- 公共 release fixture 无签名/网络/共享状态；
- workflow source scan 只允许 trust/order boundary。

## 边界条件

必须保持：

- app.asar、Bridge、Schema、resource 和 retired artifact allow/deny；
- CSP、entitlements、Bundle ID、product name、version；
- update controller、preload IPC、Preview/window 行为由独立 owner 覆盖；
- Developer Preview、Dry Run、Candidate、Release 的信任边界和身份隔离；
- pre-sign verify、signed startup、App notary checkpoint、same-App packaging；
- DMG/ZIP/blockmap/latest-mac、Hash、Tree/version/provenance；
- source gate 7 天和 candidate 72 小时等当前时效合同；
- Release 不 rebuild、不替换已验证字节。

明确不做：

- 不运行真实 package、sign、notary、tag 或 Release；
- 不修改 workflow、production verifier 或 package manifest；
- 不删除真实 packaged runtime/startup 测试；
- 不以 mock 替代最终 artifact verifier；
- 不合并不同 trust profile；
- 不修改 `ci-health-report`、review policy 或 review debt；
- 不用 snapshot 文件掩盖字段级断言。

## 验收标准

### 聚焦行为 owner

```bash
node --test \
  tests/application-update.test.mjs \
  tests/desktop-preload-ipc.test.mjs \
  tests/preview-protocol.test.mjs \
  tests/electron-window-policy.test.mjs
```

预期：从 desktop-package 移出的行为仍由 owner 全部通过。

### package/provenance

```bash
npm run test:package
```

预期：package group 全绿；每个缺失/篡改 fixture 报告具体边界；不调用真实 Apple/Release。

必要时单独运行：

```bash
node --test \
  tests/desktop-package.test.mjs \
  tests/packaged-artifact-gate.test.mjs \
  tests/release-app-stage.test.mjs \
  tests/developer-preview-package.test.mjs \
  tests/source-gate-provenance.test.mjs \
  tests/release-candidate-provenance.test.mjs \
  tests/release-provenance.test.mjs \
  tests/package-delivery-report.test.mjs \
  tests/test-gate-selection.test.mjs
```

### 静态和任务门禁

```bash
npm run architecture:check
npm run typecheck
npm run gate:edit
npm run task:finish
```

### 关键回归

- required bundled file 缺失失败；retired file/dependency 回归失败；
- CSP/entitlements 变宽失败；
- dry-run checkpoint 不能被 candidate restore 接受；
- candidate identity Tree/version/arch/run attempt drift 失败；
- restored renderer oracle 或 telemetry metadata 缺失失败；
- source attestation package/lock/version/Tree 不等失败；
- developer identity 不进入 formal lane；
- release workflow 仍验证同一 bytes 后 tag/publish，不 rebuild。

### 量化

- `desktop-package.test.mjs` 只剩 package/security/dependency 边界；
- release fixture 重复只保留一份 fresh builder；
- 净测试 LOC 目标 1,500–2,000；低于目标时说明哪些 trust/oracle 必须保留，不扩大到 CI Health/review governance。

## 停止条件

出现以下任一情况立即停止：

- PR1 未合并，或开放 PR 修改相同 package/provenance 文件；
- 某 desktop-package regex 是当前唯一 package allowlist/security oracle；
- 行为 owner 测试并未真正覆盖被删除断言；
- 公共 fixture 需要调用 production evaluator 生成期望；
- profile 无法显式隔离，builder 会混淆 developer/dry-run/candidate；
- 必须修改 workflow/verifier/package manifest；
- package group 只能通过 mock 掉真实 verifier；
- 需要实际签名、公证或发布才能验收；
- 为达到 LOC 目标必须删除 provenance/trust 边界或扩大到 CI governance。

停止报告必须列出旧断言、最终 artifact 可观测缺口、现有 owner、需要修改的生产/workflow 文件和建议独立 PR。

## 未决风险

- `desktop-package.test.mjs` 的部分源码 regex 可能是 build 前唯一的快速 fail-fast；移除前必须确认 artifact verifier或 direct owner能在 PR gate 中及时运行。
- release fixture 表面相似但 profile 字段语义不同，过度抽象可能掩盖信任边界。
- 1,500–2,000 行目标依赖多个 release test 确有 fixture 重复；若实际重复较少，应接受更低净减少。
- workflow 文本检查是允许的显式 release architecture boundary，但必须逐项区分“顺序/权限”与普通 step 文案。
- 本 PR 不运行真实 package；最终 Ready 的完整 CI/dry-run 才是远端交付链证据，不能把本地 Node 绿色称为 artifact 已验证。
