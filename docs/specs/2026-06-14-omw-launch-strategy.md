# oh-my-workflow — Show HN/GN 출시 전략

> 2026-06-14 · 다각도 분석 워크플로우(12 에이전트, 712K 토큰) 산출물.
> 선행: [`2026-06-12-oh-my-workflow-design.md`](./2026-06-12-oh-my-workflow-design.md) (제품 설계 스펙).
> 이 문서 = **출시 계층의 단일 진실 소스**. 포지셔닝·평가지표·로드맵·레드팀 대응.

## TL;DR — 한 문단

omw는 빈 레포 + 멋진 README로는 **무조건 죽는다**(레드팀 demo-ability 판정: FATAL). 살리는 단 하나의 열쇠는 **`--agent fake` — API 키도 돈도 없이, 결정적으로, 낯선 사람이 5분 안에 복붙으로 돌려보는 무료 경로**다. 이게 이번 세션 코어 빌드(가짜 어댑터 척추)와 정확히 일치한다. 포지셔닝은 "최초/해자"를 버리고 **정직한 2-of-3 교집합 + 'CC 내부 Workflow 패턴을 OSS로 외부화'** 로 좁힌다. 유일하게 진짜 코드인 차별점은 **schema-gate 자가수정 루프**다.

---

## 1. 레드팀 판정 (4 렌즈로 죽이기 시도)

| 렌즈 | 판정 | 핵심 공격 | 수정 |
|---|---|---|---|
| **Demo-ability** | 🔴 **FATAL** | 돌릴 게 없다. 빌드해도 hero 루프가 유료+인증 claude + LLM 비결정성에 묶임. `omw@0.0.0`은 스쿼팅된 빈 패키지. | **`--agent fake`**: 빌트인 가짜 어댑터로 전체 척추+저널+스크립트화된 자가수정을 **무료·결정적**으로. 이게 README 최상단 복붙 라인. |
| **Novelty/prior art** | 🟠 SERIOUS | "그냥 subprocess + for-loop". `agent-authored`(프롬프트일 뿐), `deterministic`(샌드박스 없음→관례), "CC 5훅 검증"(smoke.js 자가채점 = 순환논증) 셋 다 무너진다. | 진짜 코드 차별점 = **schema-gate 자가수정 루프**만 앞세움. 세 단어 모두 정직하게 스코프 축소. |
| **TAM/durability** | 🟠 SERIOUS | "claude만 되는, resume도 없는, Anthropic이 공짜로 하는 걸 더 나쁘게 재구현". 벤더가 한 플래그로 흡수 가능. | **"제품(해자)"이 아니라 "OSS 레퍼런스 구현 + 해부 블로그"** 로 리프레임. 정직함이 곧 방어. 벤더가 흡수해도 교육·서사 가치는 남음. |
| **Agent-first 역설** | 🟡 SURVIVABLE | "인간은 유저가 아니다"를 헤드라인 테제로 내거는 순간, 평가·업보트하는 인간 청중이 튕긴다. | `agent-first`를 **테제→각주**로 강등. 내부 설계법("런타임의 유일 호출자=작성 에이전트→API 5훅")으로만 진술. 인간용 가치(무료 데모)를 앞세움. |

**메타 교훈**: 네 공격 모두 같은 곳을 가리킨다 — **빌드해서, 낯선 사람이 무료로 돌려볼 수 있게 하라. 그리고 과대주장하지 마라.** 정직함이 마케팅이다.

---

## 2. 포지셔닝 (레드팀 보정 완료)

**한 줄**: omw는 당신이 이미 비용 내는 코딩에이전트 CLI(`claude -p` / `codex exec` / `pi`)를 **호스트 에이전트가 스킬 보고 즉석 작성한 평범한 JS 워크플로우의 노드**로 돌린다. omw는 그 스크립트를 실행하고, 노드마다 schema-gate를 걸고, 모든 스텝을 저널링해서 — 에이전트가 **자기 실패를 읽고 자기 스크립트를 고치게** 하는 얇은 결정적 접착제다.

**대안 한 줄(포일용)**: "또 하나의 에이전트 프레임워크가 아니다 — 노드가 단일 LLM 호출이 아니라 **코딩에이전트 통째**다."

**카테고리**: agent-authored · agent-agnostic 코딩에이전트 CLI 오케스트레이션 런타임. 새 카테고리 ❌ (Bernstein·pi-builder·ORCH·sage·sub-agents-skills 다 존재). **한 조합의 레퍼런스 구현 + 해부 블로그**.

**정직한 novelty (주장하는 것 / 안 하는 것)**:
- ❌ 안 함: 최초, 최고, 해자.
- ✅ 함: 어떤 단일 출시 프로젝트도 셋 다는 안 하는 **2-of-3 교집합** — (a) 오케스트레이션 스크립트를 **호스트 에이전트가 스킬로 즉석 작성**(Bernstein/pi-builder처럼 인간이 미리 ❌, sub-agents-skills처럼 턴별 라우팅 ❌), (b) **외부에서 재사용 에이전트 CLI로 실행**(Anthropic 봉인 샌드박스 ❌), (c) **claude/codex/pi 불가지론**.
- ⚓ 앵커: "omw는 **CC 내부 Workflow 도구의 패턴**('모델이 결정적 오케스트레이션 스크립트를 즉석 작성')을 OSS로 외부화해 아무 CLI에서나 돌린다."

**3가지 과대주장 → 정직 스코프**:
1. `agent-authored` = **스킬(프롬프트)** + 하류의 진짜 코드 아티팩트. 런타임 속성 ❌.
2. `deterministic` = 엔진이 실제 보장하는 것만(안정적 resume 키, JSONL 레코딩 리플레이, schema-gate). 유저 스크립트 결정성은 **관례**(샌드박스 없음, 설계상).
3. `workflow-anatomy` = **"이해를 위한 충실한 재구성, 내 멘탈 모델"**. "Anthropic 바이너리 해부/5훅 검증" ❌ (가짜 런타임 테스트는 재구성이 5훅 위에 합성됨을 확인할 뿐).

**유일하게 코드 모양인 차별점 (리드)**: schema-gate **자가수정 루프** — 작성 에이전트가 구조화된 저널 에러(`kind` + `fix_hint`)를 읽고 자기 스크립트를 편집. "subprocess + for-loop" 비교가 못 잡는 부분.

---

## 3. 평가지표 스코어카드

### Layer A — 출시/트랙션 KPI (출시가 먹혔나)

| ID | 지표 | 타깃 (Floor / Target / Hit) | 측정 (무료) |
|---|---|---|---|
| A1 | HN 프론트 진입 | 90분 내 ≥10pt & 2h 내 /front | Algolia HN API 10분 폴링 |
| A2 | HN 프론트 체류/피크 | 프론트 터치 / ≥3h·peak ≤#15·≥40pt / top10·≥100pt | hnrankalerts + Algolia 스냅샷 |
| A3 | GeekNews 프론트 | 6h 내 ≥15업·홈, 12h 'latest' 잔류 | news.hada.io HTML 스냅샷 (+1/6/24h) |
| A4 | 업보트 속도 | HN ≥0.1pt/min(1h) · GN ≥5업(2h) | 동일 폴링 델타 |
| A5 | GitHub 스타 (48h) | 30 / 100 / 300 | REST stargazers + star-history cron |
| A6 | Try-it 전환 | ≥50 cloners / ≥200 dl(주1) / ≥30 skill installs | GitHub Traffic + npmjs dl API |
| A7 | 코멘트 품질 | net-positive, ≥3 substantive, ≤1 미반박 "trivial" | Algolia 코멘트 + LLM 센티먼트 |
| A8 | 실유저 issue/PR | 72h 내 비작성자 ≥3, ≥1 실버그 | GitHub API author!=owner |
| A9 | 블로그 read-through | 72h ≥1000 readers, ≥40% scroll, ≥5% CTR→repo | Plausible/GoatCounter scroll+outbound |

### Layer B — 제품 품질 바 ("Show HN ready"의 기술적 정의)

| ID | 지표 | 타깃 | 측정 |
|---|---|---|---|
| **B0** | **워킹 스켈레톤 green (THE GATE)** | `bun test`가 5훅 척추 1바퀴 + 스크립트화된 schema-fail→retry→null 통과, exit 0 | 매 push CI. **red = no launch** |
| B1 | 무료 경로 첫 green | clone→`bunx oh-my-workflow run examples/deep-research --agent fake` exit0 + schema-valid stdout, ≤5분, CLI/키 0 | docker clean-run 타이밍 |
| B2 | 낯선사람-green 재현성 | 3환경(macOS/ubuntu/devcontainer) 5/5 fresh clone, 수정 0 | GHA matrix + nightly OMW_LIVE |
| B3 | 원샷 작성성 (USP, 측정) | 3 fresh task ×10 trial 중 ≥8: SKILL.md만으로 runnable 스크립트, exit0, ≤1 자가수정, 인간편집 0 | `claude -p`에 SKILL+task 파이프, 모델 핀 고정 |
| B4 | 에러 행동가능성 | exit 1/2/3 + null-contract 전부 `fix_hint` JSON; 주입결함 ≥9/10 ≤2사이클 자가수정 | fault-injection 테이블 + agent-loop eval |
| B5 | schema-gate 재시도 정확성 | fence/bare-brace/prose 추출 ≥95%(20-fixture); 정확히 2회 캡; 소진 시 null | bun unit, 재시도 카운트 |
| B6 | null-contract 불변식 | 모든 실패 kind + 스키마 소진 → null + `agent_end{ok:false}`; unhandled rejection 0 | fault fake + process counter ==0 |
| B7 | 저널/리플레이 충실도 + resume 키 안정 | 고아 없는 페어 이벤트; 리플레이가 phase순서+stats 재현; resume키 2회 동일 run 바이트동일; golden journal CI drift 차단 | 이벤트 스키마 검증 + golden snapshot diff |
| B8 | 어댑터 계약 적합성 | claude가 conformance 통과; 실envelope 필드리네임 golden fixture(`session_id→sessionId` 등) | spawn mock + 캡처 fixture |
| B9 | 동시성/리소스 안전 | parallel/pipeline이 limit(기본4) 초과 안함; 50노드 후 누수 child/fd 0 | in-flight counter + pgrep/fd diff |
| B10 | 순수부 커버리지 | schema-gate/journal/limiter ≥90% line; "all-abstain must not survive" 클래스 | `bun test --coverage` gate |
| B11 | 콜드 설치 풋프린트 | `--help` ≤10s(warm registry); deps 검소(ajv+최소) | clean container 타이밍 + du -sh |
| B12 | 정직 표면 (anti-overclaim) | README 첫 화면: adapter matrix(claude full/codex,pi exp), codex#15451 caveat, "no sandbox/결정성=관례", workflow-anatomy="재구성" | 출시 전 체크리스트 vs 레드팀 |

---

## 4. 갭 분석 (이번 세션 vs 핸드오프)

### 🔴 이번 세션 (BLOCKER + 코어 계약)
- **빈 레포** → 워킹 스켈레톤이 `bun test` green. 모든 것의 하류.
- **`omw@0.0.0` 스쿼터** → 패키지명 `oh-my-workflow`, bin alias `omw`, 모든 docs `bunx oh-my-workflow run`. (npm 클레임/transfer는 핸드오프지만 **이름 결정은 지금 package.json에 박는다**.)
- **무료/결정적 try-it 부재** → 빌트인 fake AgentPort + `--agent fake`. demo-ability FATAL→survivable로 전환. **이번 세션 코어**.
- **과대주장 3종** → positioning 문서에 보정 언어 락(코드 아님).
- **schema-gate 추출 우선순위 미정** → 결정적 규칙(마지막 fenced 블록, 없으면 최대 balanced-brace 스팬) + fixture.
- **null-contract 실패출처 소실** → 모든 null에 terminal `kind` 저널; 전 실패가 null로 깔때기(throw 안함); SKILL 기본 템플릿이 null-handling.

### 🟢 핸드오프 (타세션)
- MVP: `cli/run.ts`·`cli/replay.ts`, `--agent fake` 무료 try-it 배선, `examples/deep-research` (OMW_LIVE 뒤 real-claude e2e).
- SKILL.md + 패턴 템플릿(fan-out / verify-vote 기권정족수 / pipeline / loop-until-dry) + run→journal→fix 디버그 루프. B3 10-prompt eval로 ≥8/10까지 반복.
- **Substantial 바**: 벤치마크 하니스(fake 오버헤드 격리), `adapters/claude.ts` golden fixture, `adapters/codex.ts`+`pi.ts`(experimental, codex는 #15451 관용 추출기), `oh-my-workflow doctor` preflight.
- **Category 에세이/해부 블로그** + 4-way 포지셔닝 표. 오너 노트 앵커(LLM=센서·스크립트=컨트롤러, decomposition-enables-delegation, '시멘트 붓기' 은유 KR).
- 레퍼런스 폴리시: README(`--agent fake` above fold, adapter matrix+caveat 첫화면), asciinema/agg GIF(fake run+자가수정).
- 출시 옵스: `npm publish --provenance`, zce에 `omw` transfer 요청, skills.sh 제출, 블로그 애널리틱스+폴링 cron 사전 계측, Tue–Thu ~8–10am PT 스케줄, firstComment 즉시, 부스터 코멘트 금지, 2–3h 베이비싯.

---

## 5. 이번 세션 코어 빌드 계획 (TDD)

목표: **`bun test` green over the 5-hook spine.**

1. 스캐폴드: `package.json`(name `oh-my-workflow`, bin `{omw: dist/cli/run.js}`), `tsconfig`, bun test, ajv dep, 배럴파일 금지(직접 import).
2. `adapters/types.ts` — AgentPort + AgentResult 계약 그대로.
3. **TEST FIRST** — fake AgentPort(workflow-anatomy/smoke.js 이식: label/promptHash 라우팅 canned) + fault-injection(kind별 ok:false, schema 위반 텍스트). **척추 fixture이자 결정성 fixture이자 `--agent fake`의 엔진**.
4. `schema-gate.ts` (TDD, ~20-case fixture): 추출(결정적 우선순위) → ajv → followUp/fresh → 정확히 2회 → null. never throws.
5. `journal.ts` (TDD): JSONL writer, sha256 promptHash/optsHash, null마다 `agent_end{ok:false,kind}`. 페어 이벤트, resume키 바이트안정, golden snapshot.
6. `runtime.ts` — `makeRuntime`: 5훅을 주입된 AgentPort+journal 위에 조립. null-contract, 동시성 limiter(기본4) 초과 금지, phase/log.
7. **THE GATE TEST**: scope→search→verify→synthesize 1바퀴 + 스크립트화된 schema-fail→retry→null→`filter(Boolean)` 생존 + null-contract property + limiter in-flight 단언.
8. v2 계약 락: terminal `kind`, resume키 `(callIndex, promptHash, optsHash)`, golden-journal 뒤 이벤트 스키마 동결.
9. positioning 노트 락(코드 아님): 보정 언어를 in-repo 문서에. README/블로그는 핸드오프.

**원래 스펙 대비 단 하나의 변경 (권장)**: fake 어댑터를 `test/`에만 두지 않고 **빌트인 `--agent fake` 런타임 어댑터로 승격**. 이유: demo-ability FATAL을 해소하는 유일한 무료·결정적 try-it 경로 = 출시 생존의 핵심. 어차피 척추 fixture로 만들 코드라 비용 0.

---

## 6. Show HN / Show GN 초안 (핸드오프 시 사용)

> 전문은 워크플로우 산출물에 보존. 핵심만.

**HN 타이틀**: `Show HN: oh-my-workflow – run coding-agent CLIs (claude -p / codex exec) as nodes in a plain-JS workflow`

**리드 try-it** (README above fold = HN body 최상단):
```
bunx oh-my-workflow run examples/deep-research --agent fake
```
무료·키없음·결정적. 빌트인 fake가 scope→search→verify→synthesize 척추+JSONL 저널+스크립트화된 schema-fail→자가수정을 돌리고 result JSON 하나 출력.

**firstComment 골격**: (1) 출처 = CC 내부 Workflow 호기심 → workflow-anatomy 재구성(정직 스코프) → OSS 외부화. (2) 공정한 반박 선제: "subprocess+for-loop 아니냐"→맞다, 단 schema-gate 자가수정 루프는 아니다(유일 진짜 아티팩트); "agent-authored는 프롬프트"→맞다, 해자 주장 안함; "샌드박스 없는데 deterministic"→엔진 보장만 정직 스코프; "Bernstein/CC Workflow와 뭐가 다르냐"→README 표, 최초 주장 안함; "LangGraph와?"→레이어 다름(노드=CLI 통째); "agent-first 인간용 아니냐"→내부 설계법일 뿐, 무료 데모 있음. (3) v1 caveat 정직: no sandbox, no live resume(v2), claude flagship·codex/pi experimental(#15451), `doctor`.

**Show GN 변형**: 'Show GN:' 프리픽스, **본문 한국어, 학습/포트폴리오 해부**로 프레임(제품 피치 ❌). 리드: "Claude Code 내부 Workflow 도구를 밖에서 재구성해 이해한 뒤 패턴을 OSS로 외부화한 실험." 오너 은유 그대로: omw = 비결정적 코딩에이전트들 사이에 붓는 **결정적 시멘트**; 'LLM=센서, 스크립트=컨트롤러'를 오케스트레이션에 적용. 동일 caveat. HN 1–2일 후 포스트. **GN도 HN과 동일하게 tryability 게이트 적용**(미실행 작업엔 가혹).

---

## 7. 참조
- 제품 스펙: [`2026-06-12-oh-my-workflow-design.md`](./2026-06-12-oh-my-workflow-design.md)
- 선행 해부: `~/dev/personal/workflow-anatomy/`
- prior art (정직 표에 명시): Bernstein, pi-builder, ORCH, sage, shinpr/sub-agents-skills, ray-amjad/claude-code-workflow-creator
- codex `--json` malformed under MCP: openai/codex#15451
- 환경 확인(2026-06-14): bun 1.3.10, node v22.19.0, claude 2.1.177, codex 0.137.0, pi 미설치
