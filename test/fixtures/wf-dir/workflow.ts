import type { Runtime } from "../../../src/runtime";
export default async function (rt: Runtime) {
  rt.phase("Dir");
  return await rt.agent("x");
}
