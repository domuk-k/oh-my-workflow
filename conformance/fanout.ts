// Conformance: a fan-out over parallel(), survivors through filter(Boolean).
// Native-shaped destructured-DI authoring; runs green under `--agent fake`.

export const meta = { name: "fanout", phases: [{ title: "Search" }] };

export default async function ({ agent, parallel, phase }, _args) {
  phase("Search");
  const found = await parallel(
    ["a", "b", "c"].map((t) => () => agent(`SEARCH ${t}`, { label: `search:${t}` })),
  );
  return { found: found.filter(Boolean) };
}

export const fake = {
  rules: [
    { match: (p) => p.includes("SEARCH a"), responses: [{ text: "A" }] },
    { match: (p) => p.includes("SEARCH b"), responses: [{ fail: "timeout" }] },
    { match: (p) => p.includes("SEARCH c"), responses: [{ text: "C" }] },
  ],
};
