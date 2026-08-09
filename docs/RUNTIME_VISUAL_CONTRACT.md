# Runtime visual contract

Runtime visuals are disposable presentation evidence. They never become source,
TargetRef, review-diff, save, export, Version, or AI-input authority. When the
evidence cannot be tied to an exact source host, PageRoot shows no runtime-local
box.

## Shared limits and identity

`app/domain/runtime-visual-contract.js` is the only production declaration of
the cross-surface limits. Edit capture, review capture, and their consumers use
the same frozen values and the accompanying TypeScript declarations.

| Field | Contract |
| --- | --- |
| Contract version | `1` |
| Candidate limit | `128` exact source-empty hosts; directly referenced hosts are prioritized before conservative widening fills remaining slots |
| Identity-attribute limit | `24`; deterministic attributes are shared with the consumer, while every over-limit host is omitted rather than truncated into an unsafe fingerprint, even with an `id`/`name` anchor |
| Owner deadline | `1500ms` for page-realm capture work and review-frame registration |
| Comparison deadline | `500ms` after both exact review frames register |
| Page budget | `8192` atoms, `8192` traversed nodes, `400000` value characters, `4194304` Canvas pixels, `32` bitmap visuals, `16000000` PNG bytes |
| Per-host budget | `4096` atoms and `200000` value characters |
| Source identity | Full lowercase `sha256:<64 hex>`; it is the first cache invalidator and is included in review evidence envelopes |
| Session identity | Validated `review-*` identity plus contract version and side-specific source SHA |

Computed selectors, computed `getElementById` calls, generic selectors, external
scripts, and broad DOM mutation are conservative dependencies. Stable host
references use token-exact matching, so `chart` cannot match the distinct
identifier `late-chart`; these dependencies may widen
the set of exact source-empty candidates and fold the complete source Hash into
the dependency, but they never authorize a guessed runtime node or a rebound
TargetRef. A source Hash change starts a new cache partition, clears the mounted
projection while capture is pending, and rejects late evidence from the old
source.

The main-process Edit owner bounds every page-realm evaluation and screenshot
operation. Timeout, navigation, instability, unsupported paint, budget
exhaustion, an ambiguous binding, or a source/session mismatch fails closed.

For fingerprintless review comments, an observation at the frozen path is
accepted directly. A shifted same-tag observation is considered ambiguous only
when its frozen source-box shape also matches; a clearly unrelated same-tag
node cannot invalidate the already proven path binding.

Formal review uses `ReviewRuntimeVisualCaptureAdapter` as its migration seam.
The current adapter emits the existing first-party page bootstrap; a later
capture implementation can replace that adapter without changing semantic
analysis or the review UI. The adapter receives only the frozen session,
side-specific source SHA, candidate bindings, and private comment bindings.

## Thread settlement matrix

这 13 项结算以提交 `795ed18380a67a56e267cad43cd188877ea1c8f8`
为可复现实现基线。每项在
`tests/fixtures/runtime-visual-hostile-pages.mjs` 有最小 fixture；测试同时校验
fixture、线程 URL 和本表没有漂移。这里的“源码闭合”只表示该 SHA 上有明确的
机器 oracle；GitHub 讨论线程仍按正常 PR 审阅流程处理，不能被当作另一个产品
真值来源。

| Thread | Source SHA | 最小 fixture | Producer → consumer | 机器 oracle | 合同与结算 |
| --- | --- | --- | --- | --- | --- |
| [#100 `PRRT_kwDOTdtgh86W9A1Y`](https://github.com/Charleyli925/PageRoot/pull/100#discussion_r3728044924) | `795ed18380a67a56e267cad43cd188877ea1c8f8` | `pr100-canvas-native-intrinsics` | `reviewBootstrap` → `acceptReviewRuntimeVisualSnapshots` | Native DOM/Electron Canvas hostile-page coverage | 在作者脚本前冻结 `Number`、`Math.round`、`Math.max`；源码闭合。 |
| [#100 `PRRT_kwDOTdtgh86W9A1b`](https://github.com/Charleyli925/PageRoot/pull/100#discussion_r3728044929) | `795ed18380a67a56e267cad43cd188877ea1c8f8` | `pr100-single-painted-child` | `reviewBootstrap` → runtime comparison | `one painted child and its geometry` Node oracle | 一个可见 painted child 加 geometry atom 足以作为视觉证据；源码闭合。 |
| [#100 `PRRT_kwDOTdtgh86W9A1d`](https://github.com/Charleyli925/PageRoot/pull/100#discussion_r3728044932) | `795ed18380a67a56e267cad43cd188877ea1c8f8` | `pr100-transparent-text` | `reviewBootstrap` paint producer → signature consumer | hostile browser/Electron text-paint coverage | 不可见 color/fill/shadow/decoration/stroke 不产生视觉权威；源码闭合。 |
| [#105 `PRRT_kwDOTdtgh86XQhQi`](https://github.com/Charleyli925/PageRoot/pull/105#discussion_r3735482719) | `795ed18380a67a56e267cad43cd188877ea1c8f8` | `pr105-generic-selector-host` | `runtime-visual-projection` → Edit capture owner | `generic selectors retain anonymous exact visual hosts` | 间接通用 selector 保守纳入精确空宿主，不伪造身份；源码闭合。 |
| [#105 `PRRT_kwDOTdtgh86XQhQm`](https://github.com/Charleyli925/PageRoot/pull/105#discussion_r3735482725) | `795ed18380a67a56e267cad43cd188877ea1c8f8` | `pr105-dynamic-id-dependency` | dependency Hash producer → projection session cache consumer | `computed element lookup fails closed to the full source dependency` | 计算出的 `getElementById` 依赖完整 source SHA；源码闭合。 |
| [#105 `PRRT_kwDOTdtgh86XQhQo`](https://github.com/Charleyli925/PageRoot/pull/105#discussion_r3735482728) | `795ed18380a67a56e267cad43cd188877ea1c8f8` | `pr105-owner-deadline` | main-process capture owner → session revocation | `capture owner deadline destroys a page that stalls its settle clock` | 页面时钟不能延长 owner deadline；超时销毁窗口并撤销会话；源码闭合。 |
| [#107 `PRRT_kwDOTdtgh86XW6Z8`](https://github.com/Charleyli925/PageRoot/pull/107#discussion_r3737918687) | `795ed18380a67a56e267cad43cd188877ea1c8f8` | `pr107-parser-text-mutation` | parser binding producer → private comment/runtime consumer | Native DOM path-only parser-decoy coverage | 解析器新增目标只按冻结 path/完整 fingerprint 绑定；指纹缺失的移位同标签目标 fail closed；源码闭合。 |
| [#107 `PRRT_kwDOTdtgh86XW6Z_`](https://github.com/Charleyli925/PageRoot/pull/107#discussion_r3737918691) | `795ed18380a67a56e267cad43cd188877ea1c8f8` | `pr107-attribute-limit` | `reviewBootstrapElementBinding` → page bootstrap | 24/25 identity-attribute boundary coverage | 超过 24 个属性时 producer 和 consumer 都整体省略 binding，`id`/`name` 也不能例外；源码闭合。 |
| [#115 `PRRT_kwDOTdtgh86XguR7`](https://github.com/Charleyli925/PageRoot/pull/115#discussion_r3741631696) | `795ed18380a67a56e267cad43cd188877ea1c8f8` | `pr115-empty-id-substring-selector` | Edit selector matcher → candidate prioritizer | `empty ID substring selectors do not consume the candidate cap` | 空 `id` substring operand 匹配零宿主，不能耗尽 128 个候选位；已重新验证并源码闭合。 |
| [#115 `PRRT_kwDOTdtgh86Xi4nh`](https://github.com/Charleyli925/PageRoot/pull/115#discussion_r3742374961) | `795ed18380a67a56e267cad43cd188877ea1c8f8` | `pr115-empty-class-substring-selector` | Edit class selector matcher → candidate prioritizer | `empty class substring selectors do not consume the candidate cap` | 空 `class` substring operand 与 ID/data 语义一致，匹配零宿主；已重新验证并源码闭合。 |
| [#115 `PRRT_kwDOTdtgh86Xi4ni`](https://github.com/Charleyli925/PageRoot/pull/115#discussion_r3742374962) | `795ed18380a67a56e267cad43cd188877ea1c8f8` | `pr115-class-selector-operator` | Review class-selector matcher → `annotateRuntimeVisualCandidates` | Native DOM `formal Review recognizes class selector operators and class writes` | Formal Review 对完整 class value 应用已支持的属性操作符，而不是做字面 token 猜测；已重新验证并源码闭合。 |
| [#115 `PRRT_kwDOTdtgh86XjDNb`](https://github.com/Charleyli925/PageRoot/pull/115#discussion_r3742429285) | `795ed18380a67a56e267cad43cd188877ea1c8f8` | `pr115-fingerprinted-parser-decoy` | page bootstrap parser binding → runtime snapshot consumer | Native DOM `fingerprinted runtime hosts fail closed when a matching parser decoy shifts the target` | 冻结 path 已绑定一个元素后，第二个 off-path matching fingerprint 使整个 binding 失效，不能把 decoy 归属给 source host；源码闭合。 |
| [#115 `PRRT_kwDOTdtgh86XjDNd`](https://github.com/Charleyli925/PageRoot/pull/115#discussion_r3742429287) | `795ed18380a67a56e267cad43cd188877ea1c8f8` | `pr115-class-write-causality` | Review class-write matcher → `annotateRuntimeVisualCandidates` | Native DOM `formal Review recognizes class selector operators and class writes` | `className =` 与 `setAttribute("class", ...)` 必须同时由候选宿主的直接 selector 证明；通用或 alias receiver fail closed；已源码闭合。 |

This contract does not add screenshot features, serialize new temporary DOM
attributes, or change the review UI.
