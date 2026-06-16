# 내부 메커니즘 딥다이브 — resume & 결정성 (CC dynamic workflow 대비)

> 2026-06-15 · "omw가 동결한 resume 키가 Claude Code식 *최장 불변 접두사* 라이브
> resume을 **포맷 변경 없이** 지탱하는가?"를 실증으로 검증한 노트.
> 해부 블로그(P3-13)의 재료이자 v2 resume 스펙의 출발점.

## 정직 스코프 (전략 §2 준수)

이 문서는 **CC Workflow 도구의 동작 *명세*를 독해한 충실한 재구성**이지, Anthropic
바이너리 해부가 아니다. "CC 내부를 검증했다"가 아니라 "공개 동작 명세와 동형으로
설계했고, 그 설계가 라이브 resume을 지탱함을 omw 코드로 실증했다"가 정확한 주장이다.

## 질문

omw는 resume **키**를 `(callIndex, promptHash, optsHash)`로 동결했다(`src/journal.ts`).
CC의 `resumeFromRunId`는 "동일 스크립트+args면 100% 캐시 히트, 첫 편집/신규 호출과
그 이후만 라이브 실행"이라는 *최장 불변 접두사* 모델이다. omw의 동결 키가 이걸
**저널 포맷 변경 없이** 지탱하는가? 급소는 **callIndex 결정성** — 재실행 때 `agent()`
호출 순서가 어긋나면 키가 전부 밀려 resume이 무너진다(CC가 `Date.now`/`Math.random`을
막는 이유).

## 메커니즘 (코드 레벨)

- `runtime.ts:82` — `const call = ++callCounter`가 `agent()` 진입 **동기 첫 줄**에서 부여.
- `parallel`(179) — `thunks.map(t => Promise.resolve().then(t))`: 각 thunk이
  **마이크로태스크 큐에 배열 순서대로(FIFO)** 등록 → `++callCounter`가 배열 순서로 실행.
  **병렬인데도 callIndex가 결정적**인 비자명한 토대.
- `pipeline`(192) — `items.map(async …)`: 각 async가 배열 순서로 동기 시작.
- `journal.ts` — `stableStringify`로 opts 키 정렬 + `undefined` 드롭 → 행동 동일한
  opts가 동일 해시. `promptHash`/`optsHash`는 벽시계 시간 제외.

## 실증 (재현: `bun` 스크립트, fake 어댑터)

### 실증 1 — resume 키 시퀀스 결정성
`examples/deep-research`(parallel+pipeline+self-repair+timeout 포함)를 runtime으로 2회
실행 → `agent_start`의 `(call,promptHash,optsHash)` 시퀀스 추출.

```
run1: 7 keys | run2: 7 keys
byte-identical resume-key sequence: true
```

병렬 fan-out(call 2,3,4 = SEARCH a/b/c)도 마이크로태스크 FIFO 덕에 바이트 동일.
→ **동결 키는 실제 runtime 실행 경로에서 안정적.**

### 실증 2 — 최장 불변 접두사 라이브 resume
1차 journal로 `(call,pHash,oHash)→result` 맵 구축 후:

```
identical re-run: 4/4 cache HITS          (CC "same script+args -> 100%")
edited last node:  HIT HIT HIT MISS        (SYNTH 프롬프트만 변경)
-> longest unchanged prefix = 3 nodes, then live from first MISS
```

→ **동결 키로 CC의 접두사 캐시 모델이 정확히 재현됨.** 포맷 변경 0.

### 실증 3 — 결정성은 resume의 전제조건
```
DETERMINISTIC      -> identical key sequence: true   (3 vs 3 calls)
NON-DETERMINISTIC  -> identical key sequence: false  (Math.random 분기/노드)
```

→ 비결정 워크플로우는 키가 어긋나 resume 전면 미스. **CC는 강제(throw), omw는 관례.**

## 결론

내부 메커니즘은 **CC와 동형으로 설계됐고, 동결 계약(저널 포맷 + resume 키)이 라이브
resume을 포맷 변경 없이 지탱함이 실증됨**. *라이브로* 닮으려면 v2 두 조각이 남는다.

| 메커니즘 | CC | omw 현재 | 상태 |
|---|---|---|---|
| resume 키 안정성 | 최장 불변 접두사 | 동결 키, 실행서 바이트 동일 | ✅ 실증됨 |
| 라이브 resume(접두사 캐시) | `resumeFromRunId` | 키→result 100% 히트 / 편집부터 라이브 | 🟡 runtime 캐시 훅 미구현(v2) |
| 결정성 강제 | `Date.now`/`random` throw | 관례 | 🟡 v2 |

## v2 설계 스케치

### 1. runtime resume 주입점 (~20줄, 동결 계약 무손상)
```
makeRuntime({ adapter, journal, concurrency, resume })
// agent() 진입, journal.agentStart 직후:
if (resume) {
  const hit = resume.lookup({ call, promptHash: promptHash(prompt), optsHash: optsHash(opts) });
  if (hit.found) {                       // 어댑터 스킵
    journal.agentEnd({ call, ok: true, result: hit.value, durationMs: 0, cached: true });
    return hit.value;
  }
}
```
- `resume`는 이전 journal에서 `(call,pHash,oHash)→result` 맵을 만든 lookup.
- 실증 1·2가 이 조회의 안전성(키 안정 + 접두사 일치)을 이미 보장.
- `agent_end`에 `cached:true` 1필드 추가 — 이벤트 7종 *구조*는 유지(증분 필드).
- **부분 실패**: `agent_end{ok:false}`는 캐시 안 함 → resume 시 실패 노드만 재시도.

### 2. 결정성 강제 (opt-in, resume 모드)
- 워크플로우 실행 컨텍스트에서 `Date.now`/`Math.random`/argless `new Date()` 가드.
- 후보: (a) `node:vm`/worker 격리 컨텍스트의 글로벌만 패치(깨끗하나 직렬화 경계),
  (b) 실행 직전 글로벌 패치 + 복원(가벼우나 동시성 주의), (c) 정적 lint 경고(최경량).
- 없으면 resume은 "결정적 워크플로우에 한해 동작"으로 정직 라벨.

## 정직 표면 한 줄 (SKILL/README 반영)

> resume은 **설계·포맷이 동결돼 실증으로 지탱 확인됨**. 라이브 재개와 결정성 강제는
> v2 — 그래서 현재 `omw replay`는 "fixture replay"(기록 재구성)로 정직하게 라벨된다.
