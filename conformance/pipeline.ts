// Conformance: a two-stage pipeline() — each item flows through both stages
// independently. Destructured-DI; runs green under `--agent fake`.

export const meta = { name: "pipeline", phases: [{ title: "Map" }] };

export default async function ({ agent, pipeline, phase }, _args) {
  phase("Map");
  const out = await pipeline(
    ["x", "y"],
    (item) => agent(`STAGE1 ${item}`),
    (prev) => agent(`STAGE2 ${prev}`),
  );
  return { out };
}

export const fake = {
  rules: [
    { match: (p) => p.startsWith("STAGE1"), responses: [{ text: "s1" }] },
    { match: (p) => p.startsWith("STAGE2"), responses: [{ text: "s2" }] },
  ],
};
