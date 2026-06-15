# oh-my-workflow — 설계 스펙

> 2026-06-12 · 브레인스토밍 세션 산출물. 구현 전 단일 진실 소스.
> 선행 작업: `~/dev/personal/workflow-anatomy/` (CC deep-research 워크플로우 해부 — 런타임 표면이 5훅임을 검증, DI 척추 분리 완료)

## 한 줄 정의

**코딩에이전트를 노드로 쓰는, 에이전트-불가지론적(agent-agnostic) 워크플로우 런타임.**

철학적 주장 (README 첫 문단): 오케스트레이션 스크립트는 평범한 JS다. 노드는
이미 잘 만들어진 코딩에이전트다. 우리는 그 사이의 얇은 결정적 접착제만 만든다.

## 배경: 3사 오케스트레이션 철학과 우리 포지션

| | 스크립트 위치 | 작성자 | 결정성/재개 |
|---|---|---|---|
| Claude Code Workflow | 하니스 내부 (샌드박스 JS DSL) | 모델 즉석 | 저널 resume 내장 |
| OpenAI Codex | 외부 (shell / Agents SDK / .toml) | 개발자 사전 | 개발자 책임 |
| pi (Zechner) | 없음 — 에이전트가 Bash 즉흥 | 모델 그때그때 | 없음 (의도적) |
| **oh-my-workflow** | **외부 일반 JS — 호스트 에이전트가 작성** | **모델 즉석 (스킬이 가르침)** | **저널 v1, 재개 v2** |

CC의 "모델이 결정적 스크립트를 즉석 작성" 구조를 재현하되, 모델 부분은 이미
존재하는 호스트 에이전트를 재사용한다 (스킬 배포로). 샌드박스는 영원한 비목표.

## 확정된 결정 (브레인스토밍 Q&A)

1. **목적**: 공개 OSS + 학습/블로그 병행 = 그 자체가 포트폴리오.
2. **agent() 노드의 정체 = 코딩에이전트 CLI subprocess** (`claude -p` / `codex exec` / `pi --print`).
   raw LLM API 어댑터는 비목표 — LangGraph/Mastra와 겹치지 않는 유일한 포지션 보호.
3. **resume**: v1은 JSONL 저널만 (재개-호환 포맷), 재개 로직은 v2.
4. **형태**: 라이브러리 + 얇은 CLI 러너 (B안). 풀 하니스(C안)는 같은 코어 위 증축 경로로 열어둠.
5. **🔑 agent-first 정책: 인간 개발자 유저를 고려하지 않는다.**

## Agent-first 설계 원칙 4

1. **원샷 작성 가능성** — 작성 에이전트가 스킬 문서만 보고 한 번에 올바른
   스크립트를 쓴다. API 표면 극소(5훅+어댑터), 스킬에 복붙 패턴 템플릿 포함.
   영리한 추상화 < 예측 가능한 보일러플레이트.
2. **기계가 읽는 출력** — stdout은 결과 JSON 한 덩어리. 과정은 저널 JSONL.
   pretty 렌더는 `--pretty` 옵션으로 강등 (stderr).
3. **행동 가능한 에러** — 모든 실패는 구조화 에러 + fix_hint. 작성 에이전트의
   자가수정 루프(저널 읽기→스크립트 수정)가 곧 UX.
4. **무대화** — 어떤 경로에서도 인터랙티브 프롬프트 금지. 입력은 플래그/args/파일.

부수 효과: 인간용 문서 불필요. SKILL.md = 전체 문서. 블로그 = 인간용 서사.

## 산출물 3종 (우선순위순)

| 순위 | 표면 | 역할 |
|---|---|---|
| ① | **스킬 (skills.sh 배포)** | 주 진입점. "omw 스크립트 작성→실행→저널 읽기" 루프를 에이전트에게 가르침 |
| ② | 러너 `bunx omw run` | 에이전트가 호출하는 실행기 |
| ③ | npm 라이브러리 | 내부 엔진. 배포 배관. 인간 DX 투자 없음 |

## 비목표 (v1)

- 샌드박스 실행 (스크립트 = 신뢰된 코드)
- resume 재개 로직 (포맷만 호환)
- raw LLM API 어댑터
- 풀 TUI (ink/blessed 금지 — 순차 로그 + phase 들여쓰기까지)
- 인터랙티브 모드 일체

## 아키텍처

```
oh-my-workflow/
├── src/
│   ├── runtime.ts        # makeRuntime — 5훅 조립 (코어의 전부)
│   ├── schema-gate.ts    # JSON 추출 → ajv 검증 → 재시도 → null
│   ├── journal.ts        # JSONL 이벤트 기록 (resume-호환)
│   ├── adapters/
│   │   ├── types.ts      # AgentPort 계약
│   │   ├── claude.ts     # claude -p --output-format json (+--resume followUp)
│   │   ├── codex.ts      # codex exec --json
│   │   └── pi.ts         # pi --print
│   └── cli/
│       ├── run.ts        # omw run
│       └── replay.ts     # omw replay
├── skill/                # ← 사실상 루트 제품 (SKILL.md + 패턴 템플릿)
├── examples/
│   └── deep-research/    # workflow-anatomy 척추 이식 — 첫 dogfood
└── test/                 # fake adapter (workflow-anatomy/smoke.js 패턴)
```

언어/런타임: TypeScript + bun. 배럴파일 금지(직접 import) — 사용자 전역 규칙.

## 핵심 계약

### Runtime (워크플로우가 받는 것 — workflow-anatomy에서 검증된 5훅)

```ts
type Runtime = {
  agent(prompt: string, opts?: AgentOpts): Promise<unknown | null>
  pipeline(items, ...stages): Promise<any[]>     // 배리어 없음, 아이템별 독립
  parallel(thunks): Promise<any[]>               // 배리어
  phase(title: string): void
  log(msg: string): void
}
```

**null-계약**: `agent()`는 절대 throw하지 않는다. 최종 실패 = null 반환 + 저널
기록. 워크플로우 패턴(`filter(Boolean)`, 기권 정족수)이 이 계약 위에 선다.

### AgentPort (어댑터가 구현하는 것)

```ts
type AgentPort = {
  name: string
  invoke(req: { prompt, model?, cwd?, timeoutMs? }): Promise<AgentResult>
  followUp?(sessionId: string, prompt: string): Promise<AgentResult>  // 선택
}
type AgentResult =
  | { ok: true,  text: string, meta: { durationMs, sessionId?, costUsd? } }
  | { ok: false, kind: "timeout" | "nonzero_exit" | "spawn_failure", stderr?: string }
```

### 어댑터 매핑

| | invoke | 구조화출력 | 세션 재개 |
|---|---|---|---|
| claude | `claude -p <p> --output-format json` | `.result` 파싱 | ✅ `--resume` → followUp |
| codex | `codex exec <p> --json` | JSONL 최종 메시지 추출 | v1 미구현 |
| pi | `pi --print <p>` | stdout | v1 미구현 |

- 모델 티어 별칭 `"fast" | "smart"` + 어댑터별 매핑표, raw 문자열 passthrough 허용.
- `cwd`는 호출별 옵션. 퍼미션 플래그(skip-permissions 류)는 어댑터 생성 시 명시 opt-in.

## 스키마 게이트 (결정: 코어가 재시도)

스키마 위반은 노드 수준 확률적 노이즈 — 작성 에이전트까지 올리면 워크플로우
전체 재실행으로 갚는다. 노드 재시도는 프로세스 1개 재부팅. **작성 에이전트는
스키마 노이즈를 보지 않고, 구조적 에러만 본다.**

```
어댑터 text → JSON 추출(펜스/중괄호 휴리스틱) → ajv 검증(JSON Schema)
  실패 시: followUp 있으면 같은 세션에 에러 피드백 / 없으면 fresh+에러 첨부
  최대 2회 재시도 → 최종 실패 null (시도 전부 저널 기록)
```

작성 에이전트의 자가수정 루프는 상위 계층에 그대로 — 두 루프는 다른 문제를 푼다.

## 저널 포맷 (JSONL)

```jsonl
{"ev":"run_start","run":"r-7f3a","wf":"research.workflow.js","args":"...","ts":...}
{"ev":"phase","title":"Search"}
{"ev":"agent_start","call":3,"label":"search:broad","phase":"Search","adapter":"claude","promptHash":"sha256:…","optsHash":"…"}
{"ev":"attempt","call":3,"n":1,"kind":"schema_violation","errors":[…]}
{"ev":"agent_end","call":3,"ok":true,"result":{…},"durationMs":42000}
{"ev":"log","msg":"…"}
{"ev":"run_end","ok":true,"stats":{…}}
```

재개 키 = `(call 순번, promptHash, optsHash)` — CC의 최장-불변-접두사 모델과
동일, v2 resume이 포맷 변경 없이 얹힘. 샌드박스가 없어 비결정성(Date.now 등)을
강제 금지할 수 없으므로 **스킬 문서가 작성 에이전트에게 회피를 지시** (관례로 해결).

## 러너 계약

```sh
omw run wf.js --agent claude --args '{"q":"..."}'   # stdout: 결과 JSON만
omw replay .omw/r-7f3a.jsonl [--json]
```

| 종료코드 | 의미 |
|---|---|
| 0 | 완주 (노드 실패는 null-계약으로 워크플로우가 소화 — 여기 안 잡힘) |
| 1 | 스크립트 에러 (throw/문법) → stderr 구조화 JSON |
| 2 | 사용법 에러 |
| 3 | 어댑터 부재 → `{"error":"adapter_missing","install_hint":…}` |

동시성 기본 4 (subprocess 노드는 무거움), `--concurrency` 조정.

## 테스트 전략

- 단위: 순수부(schema-gate 추출/검증, journal 직렬화, 동시성 제한) — bun test
- 통합(가짜): fake AgentPort 주입으로 척추 한 바퀴 — workflow-anatomy/smoke.js 패턴
- 통합(실물): claude 어댑터 실호출 테스트는 `OMW_LIVE=1` env flag 뒤에
- dogfood: examples/deep-research가 곧 e2e

## 스킬 문서(SKILL.md) 구성

1. 언제 쓰나 (트리거 조건)
2. 5훅 API — 최소 표면 레퍼런스
3. 복붙 패턴 템플릿: fan-out / verify-vote(기권 정족수 포함) / pipeline / loop-until-dry
4. 실행·디버그 루프: `omw run` → 종료코드/저널 해석 → 스크립트 수정
5. 관례: 비결정성 회피(미래 resume 호환), null-계약 위에서 작성하기

## v2 경로

- resume: 저널 재생 (포맷 이미 호환)
- codex/pi followUp (세션 재개) 어댑터 보강
- C안 증축: 호스트 에이전트가 스킬로 스크립트를 작성하는 현 구조가 이미 C의
  "모델 즉석 작성"을 커버 — 남는 건 샌드박스뿐이고 그건 영구 비목표

## 미해결 질문

- npm/skills.sh에서 `oh-my-workflow` / `omw` 네이밍 가용성 확인
- codex `exec`의 `--json` 이벤트 스키마 버전 안정성 (구현 시점에 재확인)
- pi `--print`의 구조화출력 협조 수준 (실측 필요)
- 퍼미션 정책 기본값 — 노드가 파일을 만지는 워크플로우에서 안전 기본값 설계

## 참조

- 해부 선행작업: `~/dev/personal/workflow-anatomy/` (README에 원본과의 차이 장부 포함)
- [Codex Subagents](https://developers.openai.com/codex/subagents) · [Codex+Agents SDK 쿡북](https://developers.openai.com/cookbook/examples/codex/codex_mcp_agents_sdk/building_consistent_workflows_codex_cli_agents_sdk)
- [Zechner — pi 회고](https://mariozechner.at/posts/2025-11-30-pi-coding-agent/) · [pi 서브에이전트 방식](https://x.com/badlogicgames/status/2001088673698189732)
- [oh-my-pi (네이밍 영감)](https://github.com/can1357/oh-my-pi)
