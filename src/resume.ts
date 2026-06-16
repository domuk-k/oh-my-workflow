// The resume index turns a PRIOR run's journal into a lookup: (call, promptHash,
// optsHash) -> result. It is the read side of the frozen resume contract — the
// same longest-unchanged-prefix key the journal records — so v2 live-resume
// layers on without a format change. Only ok:true ends are cached; a failed node
// has no entry, so resume re-runs it live (partial-failure recompute).

import { type JournalEvent, parseJournalLines, resumeKey } from "./journal";

export type ResumeKey = { call: number; promptHash: string; optsHash: string };

export type ResumeHit = { found: false } | { found: true; value: unknown };

export type ResumeIndex = {
  lookup(key: ResumeKey): ResumeHit;
  /** Count of cached (ok) nodes available to resume. 0 means an empty/truncated/
   *  wrong journal, so the caller can warn instead of silently re-running live. */
  size: number;
};

export function makeResumeIndex(events: JournalEvent[]): ResumeIndex {
  const byCall = new Map<number, ResumeKey>();
  const results = new Map<string, unknown>();

  for (const e of events) {
    if (e.ev === "agent_start") {
      byCall.set(e.call, { call: e.call, promptHash: e.promptHash, optsHash: e.optsHash });
    } else if (e.ev === "agent_end" && e.ok) {
      const k = byCall.get(e.call);
      if (k) results.set(resumeKey(k), e.result);
    }
  }

  return {
    lookup(key) {
      const rk = resumeKey(key);
      if (!results.has(rk)) return { found: false };
      return { found: true, value: results.get(rk) };
    },
    size: results.size,
  };
}

/** Build a resume index from raw journal JSONL lines (a recorded run file).
 *  Tolerates blank/malformed lines the same way the replay summarizer does, so a
 *  partially-flushed journal still resumes its valid prefix. */
export function makeResumeIndexFromLines(lines: string[]): ResumeIndex {
  return makeResumeIndex(parseJournalLines(lines));
}
