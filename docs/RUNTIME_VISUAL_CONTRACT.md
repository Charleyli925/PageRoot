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
| Owner deadline | `1500ms` enforced by Electron main for each disposable owner capture; static Review never waits for it |
| Comparison deadline | `1500ms` for each parallel before/after owner pair; a confirmed local marker starts one separate fresh pair without delaying static Review |
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

The main-process owner bounds every page-realm evaluation and screenshot
operation. Timeout, navigation, instability, unsupported paint, budget
exhaustion, an ambiguous binding, or a source/session mismatch fails closed.

For fingerprintless review comments, an observation at the frozen path is
accepted directly. A shifted same-tag observation is considered ambiguous only
when its frozen source-box shape also matches; a clearly unrelated same-tag
node cannot invalidate the already proven path binding.

## Review owner capture

Formal Review keeps static source/TargetRef analysis as its primary result.
`AiReviewWorkspace` may then send a bounded owner request containing only the
raw HTML whose full SHA-256 it supplies, the side, viewport, and frozen
candidate path/fingerprint records. This is a narrow trusted renderer → preload
→ main request; it never originates from the authored review document.

`desktop/runtime-visual-capture-owner.mjs` creates one non-persistent
`pageroot-review-runtime-*` partition and a hidden sandboxed window for each
request. The before and after requests run in separate window/session pairs;
only a duplicate request for the same side supersedes its predecessor. Its
session serves only the volatile `pageroot-preview:` document with no source
path or declared local assets, denies permissions, navigation, popups,
downloads and webviews, and is released after the request. Before authored
scripts run, the owner parses the raw source and verifies every frozen
path/tag/source-box/fingerprint binding. Facts run only through
`executeJavaScriptInIsolatedWorld`; after scripts run, the isolated program
rechecks the frozen path/tag/identity and rejects duplicate or rebound matches.

Within one owner session, the owner takes a first and second bounded fact pass
and captures each accepted local rect once. It validates PNG headers,
dimensions, aggregate pixels and bytes, hashes the PNG, then discards the PNG
bytes. A local marker is presented only when a second, entirely new before/after
owner-session pair reproduces its source SHA, frozen viewport, facts and pixel
hash. Only a bounded envelope of derived signatures can return to the
coordinator. The authored page receives no candidate key, path, fingerprint,
source-box baseline, screenshot, runtime channel or runtime `MessagePort`.
Failures leave the static review untouched; a mismatch or timeout drops only
the affected supplemental marker.

## Thread settlement matrix

这 13 项结算由
`sha256:6c0b8dd0f40cf0563b49e466571212c6e0fe06005f03bedfaa27624bf50bf915`
不可变实现快照锁定。它按固定顺序哈希 `app/workbench/review-document.ts`、
最小 fixture 和对应的浏览器 oracle；测试每次重算并拒绝漂移。这里的“源码
闭合”只表示该指纹对应的内容有明确的机器 oracle；GitHub 讨论线程仍按正常 PR
审阅流程处理，不能被当作另一个产品真值来源。

| Thread | Implementation fingerprint | 最小 fixture | Producer → consumer | 机器 oracle | 合同与结算 |
| --- | --- | --- | --- | --- | --- |
| [#100 `PRRT_kwDOTdtgh86W9A1Y`](https://github.com/Charleyli925/PageRoot/pull/100#discussion_r3728044924) | `sha256:6c0b8dd0f40cf0563b49e466571212c6e0fe06005f03bedfaa27624bf50bf915` | `pr100-canvas-native-intrinsics` | Review owner isolated facts → runtime envelope | Native DOM/Electron Canvas hostile-page coverage | 作者脚本前的 intrinsics poisoning 不能影响 owner deadline 或 isolated facts；源码闭合。 |
| [#100 `PRRT_kwDOTdtgh86W9A1b`](https://github.com/Charleyli925/PageRoot/pull/100#discussion_r3728044929) | `sha256:6c0b8dd0f40cf0563b49e466571212c6e0fe06005f03bedfaa27624bf50bf915` | `pr100-single-painted-child` | Review owner facts → runtime comparison | `one painted child and its geometry` Node oracle | 一个可见 painted child 加 geometry atom 足以作为视觉证据；源码闭合。 |
| [#100 `PRRT_kwDOTdtgh86W9A1d`](https://github.com/Charleyli925/PageRoot/pull/100#discussion_r3728044932) | `sha256:6c0b8dd0f40cf0563b49e466571212c6e0fe06005f03bedfaa27624bf50bf915` | `pr100-transparent-text` | Review owner paint facts → signature consumer | hostile browser/Electron text-paint coverage | 不可见 color/fill/shadow/decoration/stroke 不产生视觉权威；源码闭合。 |
| [#105 `PRRT_kwDOTdtgh86XQhQi`](https://github.com/Charleyli925/PageRoot/pull/105#discussion_r3735482719) | `sha256:6c0b8dd0f40cf0563b49e466571212c6e0fe06005f03bedfaa27624bf50bf915` | `pr105-generic-selector-host` | `runtime-visual-projection` → Edit capture owner | `generic selectors retain anonymous exact visual hosts` | 间接通用 selector 保守纳入精确空宿主，不伪造身份；源码闭合。 |
| [#105 `PRRT_kwDOTdtgh86XQhQm`](https://github.com/Charleyli925/PageRoot/pull/105#discussion_r3735482725) | `sha256:6c0b8dd0f40cf0563b49e466571212c6e0fe06005f03bedfaa27624bf50bf915` | `pr105-dynamic-id-dependency` | dependency Hash producer → projection session cache consumer | `computed element lookup fails closed to the full source dependency` | 计算出的 `getElementById` 依赖完整 source SHA；源码闭合。 |
| [#105 `PRRT_kwDOTdtgh86XQhQo`](https://github.com/Charleyli925/PageRoot/pull/105#discussion_r3735482728) | `sha256:6c0b8dd0f40cf0563b49e466571212c6e0fe06005f03bedfaa27624bf50bf915` | `pr105-owner-deadline` | main-process capture owner → session revocation | `capture owner deadline destroys a page that stalls its settle clock` | 页面时钟不能延长 owner deadline；超时销毁窗口并撤销会话；源码闭合。 |
| [#107 `PRRT_kwDOTdtgh86XW6Z8`](https://github.com/Charleyli925/PageRoot/pull/107#discussion_r3737918687) | `sha256:6c0b8dd0f40cf0563b49e466571212c6e0fe06005f03bedfaa27624bf50bf915` | `pr107-parser-text-mutation` | parser binding producer → Review owner validation | Native DOM path-only parser-decoy coverage | 解析器新增目标只按冻结 path/完整 fingerprint 绑定；指纹缺失的移位同标签目标 fail closed；源码闭合。 |
| [#107 `PRRT_kwDOTdtgh86XW6Z_`](https://github.com/Charleyli925/PageRoot/pull/107#discussion_r3737918691) | `sha256:6c0b8dd0f40cf0563b49e466571212c6e0fe06005f03bedfaa27624bf50bf915` | `pr107-attribute-limit` | Review candidate builder → owner request | 24/25 identity-attribute boundary coverage | 超过 24 个属性时 producer 和 consumer 都整体省略 binding，`id`/`name` 也不能例外；源码闭合。 |
| [#115 `PRRT_kwDOTdtgh86XguR7`](https://github.com/Charleyli925/PageRoot/pull/115#discussion_r3741631696) | `sha256:6c0b8dd0f40cf0563b49e466571212c6e0fe06005f03bedfaa27624bf50bf915` | `pr115-empty-id-substring-selector` | Edit selector matcher → candidate prioritizer | `empty ID substring selectors do not consume the candidate cap` | 空 `id` substring operand 匹配零宿主，不能耗尽 128 个候选位；已重新验证并源码闭合。 |
| [#115 `PRRT_kwDOTdtgh86Xi4nh`](https://github.com/Charleyli925/PageRoot/pull/115#discussion_r3742374961) | `sha256:6c0b8dd0f40cf0563b49e466571212c6e0fe06005f03bedfaa27624bf50bf915` | `pr115-empty-class-substring-selector` | Edit class selector matcher → candidate prioritizer | `empty class substring selectors do not consume the candidate cap` | 空 `class` substring operand 与 ID/data 语义一致，匹配零宿主；已重新验证并源码闭合。 |
| [#115 `PRRT_kwDOTdtgh86Xi4ni`](https://github.com/Charleyli925/PageRoot/pull/115#discussion_r3742374962) | `sha256:6c0b8dd0f40cf0563b49e466571212c6e0fe06005f03bedfaa27624bf50bf915` | `pr115-class-selector-operator` | Review candidate builder → `annotateRuntimeVisualCandidates` | Native DOM `formal Review recognizes class selector operators and class writes` | Formal Review 对完整 class value 应用已支持的属性操作符，而不是做字面 token 猜测；已重新验证并源码闭合。 |
| [#115 `PRRT_kwDOTdtgh86XjDNb`](https://github.com/Charleyli925/PageRoot/pull/115#discussion_r3742429285) | `sha256:6c0b8dd0f40cf0563b49e466571212c6e0fe06005f03bedfaa27624bf50bf915` | `pr115-fingerprinted-parser-decoy` | frozen parser binding → owner runtime validation | Native DOM `fingerprinted runtime hosts fail closed when a matching parser decoy shifts the target` | 冻结 path 已绑定一个元素后，第二个 off-path matching fingerprint 使整个 binding 失效，不能把 decoy 归属给 source host；源码闭合。 |
| [#115 `PRRT_kwDOTdtgh86XjDNd`](https://github.com/Charleyli925/PageRoot/pull/115#discussion_r3742429287) | `sha256:6c0b8dd0f40cf0563b49e466571212c6e0fe06005f03bedfaa27624bf50bf915` | `pr115-class-write-causality` | Review candidate builder → `annotateRuntimeVisualCandidates` | Native DOM `formal Review recognizes class selector operators and class writes` | `className =` 与 `setAttribute("class", ...)` 必须同时由候选宿主的直接 selector 证明；通用或 alias receiver fail closed；已源码闭合。 |

This contract does not add screenshot features, serialize new temporary DOM
attributes, or change the review UI.
