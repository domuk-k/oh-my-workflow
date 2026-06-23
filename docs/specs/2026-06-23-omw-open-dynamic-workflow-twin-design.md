---
title: omw 리디자인 — native Claude Code Workflow의 "open dynamic-workflow twin"
date: 2026-06-23
status: design (브레인스토밍 합의, 구현 전)
supersedes-context: docs/specs/2026-06-12-oh-my-workflow-design.md (v1 honest-scope)
---

# omw = the open dynamic-workflow twin

## 0. 한 줄 / 왜 지금

Claude Code 하니스에 **native `Workflow` 툴**이 들어갔고, 그 API가 omw와 거의 동형이다 —
`agent()` / `parallel()` / `pipeline()` / `phase()` / `log()` + `budget` / `workflow()` /
`agentType` / `run_in_background` / `isolation:'worktree'` / `schema`. (omw 메모의 v2 로드맵 전부가
이미 native에 출하돼 있음.)

native는 그 패턴을 **폐쇄형·in-harness·단일 벤더**로 가진다. omw는 같은 패턴의
**오픈·이식 가능·검사 가능한 트윈**으로 재포지셔닝한다 — "claude design ↔ open design" 의 관계.

> 포지셔닝 한 줄: **oh-my-workflow — the open *dynamic-workflow* runtime.**
> native가 "(Claude) dynamic workflow"라면 omw는 그 오픈 트윈. 같은 개념을 **표준 JS**로 쓰고,
> **아무 코딩에이전트로·하니스 밖·CI에서** 돌린다.

## 1. 전략 결정 (확정)

1. **1차 목표 = drop-in "탈출구"**: native Workflow 개념을 거의 그대로 omw에서 쓸 수 있게.
   API 어휘·semantics를 native에 정렬. 셀링포인트 = "하니스 밖·아무 에이전트·CI에서 같은 스크립트."
2. **단, "표준 우선"이지 "verbatim 클론"이 아니다.** (← 핵심 원칙)
   - native의 스크립트 포맷은 **비표준 호스트 DSL**이다: 앰비언트 글로벌(import 없음) + top-level
     `return` + `Date.now()/Math.random()/new Date()` freeze-throw 샌드박스 + `meta`를 AST로 정적추출.
     (번들 2.1.186 실측: `Object.freeze(RealDate); RealDate.now = () => { throw }`,
     `Math.random = () => { throw }`, `meta must be a pure literal`, 임베드 근거 문자열
     `"Date.now/Math.random/new Date are unavailable in scripts (they would break resume)"`.)
   - 그 포맷을 *그대로* 실행하려면 omw가 **소스 트랜스폼 + 샌드박스**를 떠안아야 하고, 결과적으로
     omw는 Anthropic 사설 포맷의 *다운스트림 그림자*가 된다 → "open"이 아니다. **그래서 verbatim
     트랜스폼 접근(탈락).**
   - **왜 native는 그 기계장치를 졌나 (고고학 결론):** native의 *작성자가 모델 자신*이다 —
     하니스 안에서 인라인 문자열로, zero-shot으로, **node_modules/package.json 없이** 코드를 뱉는다.
     그래서 (a) import가 물리적으로 resolve 불가 → 앰비언트 글로벌이 강제, (b) 작성자가 컨벤션을
     안 지킬 거라 가정 → 비결정성을 *권고가 아니라 freeze로 불가능*하게, (c) `meta`를 실행 전
     UI(권한 다이얼로그·진행 트리)에 표시하려고 AST로 정적추출. **Anthropic엔 싼 거래** — 어차피
     안 쓰는 portability를 내주고 생성 신뢰성 + resume 건전성을 샀다.
   - **omw에선 그 비용이 반전된다.** omw의 존재 이유 *자체가* portability(하니스 밖·CI·아무 에이전트).
     게다가 omw 작성자(역시 에이전트)는 **resolvable 프로젝트의 파일**로 쓰고, **동봉 스킬**이 정확한
     템플릿을 컨텍스트에 준다 → 생성 신뢰성은 "매직으로 실수 봉쇄"가 아니라 "스킬 + 표준 모듈
     resolution"으로 확보. 따라서 native의 매직은 omw에 불필요하고 해롭다.
3. **그래서 full flip**: 단일 표준 표면으로 통일. 기존 `(rt, args)`는 브리지 + deprecation → 0.5 제거.

> 진짜 "open twin"의 시험: **어떤 에이전트(codex / pi / opencode …)라도 쉽고 안정적으로
> 작성해서 쓸 수 있는가.** 이게 모든 표면 결정의 북극성.

## 2. Authoring 모델 (§1) — 구조분해 DI, 매직 0

스크립트는 **진짜 ES 모듈**이다. 매직 글로벌 없음, 소스 트랜스폼 없음, 샌드박스 default 없음.

```js
export const meta = { name: 'research', phases: [{ title: 'Scan' }] }   // 평범한 named export

export default async function ({ agent, parallel, pipeline, phase, log, workflow, budget }, args) {
  phase('Scan')
  const hits = await parallel(qs.map(q => () => agent(`search ${q}`, { schema })))
  return { hits: hits.filter(Boolean) }
}
```

- 훅은 **첫 파라미터로 구조분해 주입** → 본문 안은 **bare `agent()` / `parallel()`** (native급 외형).
- `import { agent } from 'oh-my-workflow'` (ALS)도, 앰비언트 글로벌도, 트랜스폼도 **아님**. 시그니처가
  사용 가능한 훅을 *그 자리에서* 노출 → 임의의 에이전트가 한 줄에서 보고 생성, import specifier
  외울 필요 없음(zero-shot 최빈 실수원 제거), 테스트 trivial(가짜 객체 하나 주입).
- `meta`는 **표준 named export**(정적 import 가능). `name`/`phases?`/`model?`/`whenToUse?`/`description?`.
  부재 허용(`name`은 경로 폴백). native와 달리 "pure literal AST 추출" 강제 안 함 — 표준 모듈이라 그냥 읽음.
- **back-compat 브리지**: 모듈이 레거시 `export default (rt, args)`(혹은 `rt.agent` 사용)면 → 같은 훅으로
  합성한 `rt` 객체로 호출 + 1회 deprecation 경고. **0.4에서 브리지, 0.5에서 제거.**

### 거부된 대안
- **ALS import** (`import { agent }` + ALS 컨텍스트): bare 호출은 되나 import specifier 취약성 +
  암묵 결합 한 겹 추가 → 구조분해 DI가 더 단순·정직.
- **verbatim 소스 트랜스폼** (native 스크립트 복붙 실행): §1.2 — portability 자살, 사설 포맷 그림자.

## 3. 프리미티브 & 어휘 패리티 (§2)

| 프리미티브 | 설계 | 결정 |
|---|---|---|
| `args` | 2번째 파라미터 (`--args JSON`, verbatim, 부재 시 `undefined`) | — |
| `budget` | `{ total: number\|null, spent(): number, remaining(): number }`. `--budget N`(토큰). `spent()` = Σ 노드 output 토큰(adapter usage). `fake` = 합성 비용. `remaining()` = total null이면 `Infinity`. | **소진 시 `agent()` throw** (아래) |
| `workflow(ref, args?)` | 인라인 중첩 실행, **1단계만**(중첩 안 중첩 → throw). journal(하위 그룹)·limiter·budget·abort 공유. `ref` = 이름(workflows 디렉토리) 또는 `{ scriptPath }`. | v2 로드맵 → 채택 |
| opts `isolation:'worktree'` | ephemeral **git worktree를 노드 cwd로**, 변경 없으면 auto-remove. non-git → temp 복사 + 경고. (omw가 진짜 구현; 이미 `cwd` 보유.) | 채택 |
| opts `agentType` | **named node profile**로 해석 = `{ adapter, model, flags?, … }` (omw config). **크로스벤더**(프로필이 codex/pi일 수 있음 → native보다 강력). 미지정 → 경고 + default adapter. | 채택 |
| opts `effort` | adapter가 노출하면 매핑(tier/thinking 등), 아니면 record + no-op + 1회 경고. | honest-scope |
| `meta.phases` | `[{ title, model?, detail? }]` 선언적 + per-phase 기본 model. `phase(title)` 명령형도 유지. | native 패리티 |
| model 우선순위 | `opts.model` > `phase.model` > `meta.model` > adapter default | native 체인 |
| 기존 opts 유지 | `label`, `phase`, `schema`, `model`, `cwd`, `timeoutMs`, `maxRetries`, `inheritMcp` | 추가분과 공존 |

### budget ceiling = native대로 throw (불변식의 명시적 예외)
- omw 코어 불변식은 **"`agent()` never throws; terminal node 실패 → null."** budget는 이 불변식의
  *유일한, 문서화된 예외*다: `spent() >= total`이면 `agent()`가 `BudgetExceededError` throw.
- 멘탈모델: **"node 실패 = null(범주 1), run-level 자원 한계 = throw(범주 2)."** 둘은 다른 범주.
- native와 정렬: top-level `await agent()`는 throw로 run halt. **`parallel`/`pipeline` 스테이지 안에서
  나는 throw는 →null로 잡힌다(native도 동일)** → ceiling은 top-level에서 "하드". 진짜 1차 제어는
  작성자 루프 가드(`while (budget.remaining() > N)`), throw는 백스톱.

## 4. Resume & 결정성 (§3)

1. **주소**: `omw run <wf> --resume <runId|path>`. `runId` → `.omw/<runId>.jsonl` 해석(native
   `resumeFromRunId` 정렬). 기존 path 인자도 계속 허용. run 시작 시 `runId` 출력.
2. **키**: `(call-ordinal, promptHash, semanticOptsHash)`. native도 prefix 모델("first edited/new call
   and everything after runs live")이라 ordinal-prefix는 이미 정렬됨. **정제: optsHash에서 cosmetic
   (`label`/`phase`) 제외**, semantic(`model`/`schema`/`effort`/`isolation`/`agentType`/`cwd`/`inheritMcp`)만
   → 라벨 바꿔도 캐시 유지. (ok:true 노드만 캐시; 실패·abstain은 재실행 — 기존 유지.)
3. **결정성 = opt-in `--strict`**: `--strict`일 때만 실행 중 `globalThis.Date`/`Math.random`/`new Date`를
   throw로 패치(native 샌드박스를 *기질이 아니라 모드로* 빌림). 실행 후 복원. default는 컨벤션 +
   선택적 lint. → resume 건전성은 strict에서 보장; **agent 작성·CI 재현엔 strict 권장.**
4. **정직한 한계(유지)**: resume는 per-node 키 매칭이라 **파일시스템 사이드채널**(노드1이 쓴 파일을
   노드2가 읽음)은 키에 안 잡힘 → stale 위험. `--strict`도 이건 못 고침(시계/난수 한정). 문서 명시.

## 5. 포지셔닝 · SKILL · 네이밍 · 마이그레이션 (§4)

- **네이밍**: `oh-my-workflow` / `omw` **유지**(npm 0.3.0 equity + oh-my-zsh 감성 + 짧은 명령어).
  "open"은 *포지셔닝*에만: **"the open dynamic-workflow runtime."** (native "dynamic workflow" ↔
  "open dynamic workflow" 대칭을 이름이 아니라 태그라인으로 빌림 — republish/마이그레이션 비용 0.)
- **SKILL.md 재작성** (주 산출물):
  - 새 표면 교육: 구조분해 DI + bare 호출 + `meta` + 프리미티브 패리티.
  - **크로스-에이전트 보이스**: "Claude가 ~" 아니라 "작성 에이전트가 ~". `omw skill install --codex`
    (AGENTS.md) / `--opencode` 등 → *어느 호스트든 같은 지식*. (open twin의 authoring 측 증명.)
  - honest-scope 유지(아래 §8).
- **README**: 고고학 통찰을 *차별점*으로 — "native는 in-harness 매직(AST 추출·freeze-throw 샌드박스·
  인라인 글로벌)을 어쩔 수 없이 진다. omw는 **매직-프리 표준 JS** — 트랜스폼 없음, 샌드박스는
  default 아닌 `--strict`. 그래서 어디서나 돈다." (약점=portability를 정직히 인정 → 그게 포지셔닝.)
- **버저닝**: 작성 표면 breaking → **0.4.0**(새 표면 + 브리지 + deprecation) → **0.5.0**(브리지 제거).
- **`omw codemod` (양방향 다리)**: ① 레거시 `(rt,args)` → 구조분해 DI. ② **verbatim native 스크립트 →
  omw form**(앰비언트 글로벌→구조분해 주입, top-level return→함수 return, `meta` 정규화). = "사설
  포맷에서 *import* 해오는 다리" = open 트윈의 정의. (런타임 트랜스폼이 아니라 1회 변환 — 투명·검사가능.)

## 6. 테스트 & conformance (§5) — drop-in의 증명

- **conformance 스위트** `conformance/*.{js,ts}` (모두 `--agent fake`, green 단정):
  fanout(parallel 배리어) · pipeline(아이템 독립 · `(prev,item,idx)` · throw→null+나머지 skip) ·
  **budget 루프 + 소진 throw** · **nested `workflow()`** · schema-gate self-repair ·
  **`isolation:'worktree'`**(실제 worktree 생성/제거) · **`--strict` 결정성 throw** ·
  resume prefix-cache(+ cosmetic 재라벨 → 캐시 유지).
- **native-parity 테스트**: verbatim native 형태 스크립트(예: 문서의 review-changes 파이프라인) →
  `omw codemod` → omw fake 실행 → 단정. ("native에서 import" 다리 증명.)
- **기존 엔진 테스트 유지** + 신규: 로더(meta 추출, 구조분해 DI 실행) · 브리지(레거시 rt→deprecation) ·
  budget ceiling throw · agentType 프로필 해석 · worktree 생성/정리 · `--strict` 패치/복원.
- **CI**: npm `--provenance` 배포 + 테스트 매트릭스.

## 7. 에러 핸들링

- 로더: default export 누락/arity 틀림 → 명확 에러. 레거시 + 신형 동시 감지 → 신형 우선 + 경고.
- budget: `BudgetExceededError` top-level throw(parallel 안에선 →null, native 동일).
- node 실패(adapter throw / nonzero_exit / timeout / refusal / no_json / schema_violation) → null(불변).
- `agentType` 미지정 프로필 → 경고 + default. `effort` 미지원 adapter → 경고 + record.
- `workflow()` 2단계 중첩 → throw. `--strict`에서 Date/random 호출 → throw(메시지에 strict 안내).

## 8. Honest-scope / 비목표

- **노드 고도(altitude)**: omw 노드 = 외부 CLI subprocess 통째, native 노드 = in-harness subagent.
  *같은 스크립트라도 노드 무게·비용·지연이 다르다.* (어휘를 맞춰도 이건 안 맞음 — 정직히 표기.)
- **스키마 충족 방식**: omw는 노드 텍스트에서 JSON 휴리스틱 추출 후 Ajv 검증 vs native는
  StructuredOutput 툴 강제 → 모델이 prose만 뱉으면 omw는 `no_json`으로 null 날 수 있음.
- **결정성**: default는 컨벤션(샌드박스 아님). 건전한 resume는 `--strict` 필요.
- **안 만드는 것 (YAGNI)**: 결정성 샌드박스 default · per-call 4096 / lifetime 1000 캡(선택적 백스톱만,
  진짜 ceiling은 `budget`) · 앰비언트 글로벌 · 소스 트랜스폼 런타임.

## 9. 결정 로그 (닫은 포크 + 근거)

| 포크 | 결정 | 근거 |
|---|---|---|
| native를 얼마나 따라가나 | **drop-in 탈출구** (오픈 표준 정체성/패리티-따라잡기 아님) | 사용자 선택; 셀링 = portability |
| 표면 뒤집기 범위 | **full flip** (듀얼모드/패리티-우선 아님) | 단일 표준 표면, 브리지로 완화 |
| authoring 메커니즘 | **구조분해 DI** (ALS / verbatim 트랜스폼 아님) | "any agent 안정 작성" 북극성 + 매직 0 + portability |
| budget 소진 | **agent() throw** (순수 null-contract 아님) | drop-in 충실; node 실패와 다른 범주 |
| agentType | **node profile (크로스벤더)** | native보다 강력, 외부 CLI 모델에 자연 |
| 결정성 | **opt-in `--strict`** (default 샌드박스 아님) | 고고학: 샌드박스는 작성자=모델일 때만 제값 → 모드 |
| 네이밍 | **omw 유지 + "open dynamic-workflow" 태그라인** | equity + 개념 가독성, 비용 0 |

### 부록 — 왜 native는 이렇게 했나 (고고학 요약, CC 2.1.186 번들 실측)
작성자가 *모델*이라(인라인·zero-shot·무프로젝트): 앰비언트 글로벌(import resolve 불가 회피),
freeze-throw(컨벤션 안 지킬 작성자에게 비결정성을 *불가능*하게), `meta` AST 정적추출(실행 전 UI 표시).
**핵심 교훈: 같은 기계장치도 작성자·가치가 바뀌면 cost/benefit이 반전한다** — native엔 정답(portability
불요)인 게 omw엔 오답(portability가 전부). 그래서 omw는 클론이 아니라 *표준 트윈*이어야 한다.
