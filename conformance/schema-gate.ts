// Conformance: the schema gate repairs a first non-conforming response, then
// returns validated JSON. Destructured-DI; runs green under `--agent fake`.

export const meta = { name: "schema-gate" };

const numSchema = { type: "object", properties: { n: { type: "number" } }, required: ["n"], additionalProperties: false };

export default async function ({ agent }, _args) {
  const got = await agent("COMPUTE", { schema: numSchema });
  return { got };
}

export const fake = {
  rules: [
    {
      match: (p) => p.includes("COMPUTE"),
      // First response is invalid (string n), gate feeds the error back, second is valid.
      responses: [{ text: '{"n":"not-a-number"}' }, { text: '{"n":7}' }],
    },
  ],
};
