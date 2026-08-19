import type { EvalRunResult, ToolCall } from "./agent.js";

export interface EvalCase {
  name: string;
  query: string;
  /** Return a failure reason, or null if the result passes. */
  check(result: EvalRunResult): string | null;
}

function lastCallTo(toolCalls: ToolCall[], name: string): ToolCall | undefined {
  return [...toolCalls].reverse().find((c) => c.name === name);
}

export const cases: EvalCase[] = [
  {
    name: "country + minimum aperture",
    query: "find my Switzerland shots at f/8 or narrower",
    check(result) {
      const call = lastCallTo(result.toolCalls, "search_photos");
      if (!call) return "expected a search_photos call, got none";
      if (call.input.country !== "Switzerland") {
        return `expected country "Switzerland", got ${JSON.stringify(call.input.country)}`;
      }
      const exposure = call.input.exposure as
        { minAperture?: number } | undefined;
      if (
        typeof exposure?.minAperture !== "number" ||
        exposure.minAperture < 8
      ) {
        return `expected exposure.minAperture >= 8 ("f/8 or narrower"), got ${JSON.stringify(exposure)}`;
      }
      return null;
    },
  },
  {
    name: "country-only lookup",
    query: "how many photos do I have from Vietnam?",
    check(result) {
      const call = lastCallTo(result.toolCalls, "search_photos");
      if (!call) return "expected a search_photos call, got none";
      if (call.input.country !== "Vietnam") {
        return `expected country "Vietnam", got ${JSON.stringify(call.input.country)}`;
      }
      return null;
    },
  },
  {
    name: "country + maximum ISO",
    query: "show me low-ISO shots from Sweden, ISO 100 or under",
    check(result) {
      const call = lastCallTo(result.toolCalls, "search_photos");
      if (!call) return "expected a search_photos call, got none";
      if (call.input.country !== "Sweden") {
        return `expected country "Sweden", got ${JSON.stringify(call.input.country)}`;
      }
      const exposure = call.input.exposure as { maxIso?: number } | undefined;
      if (typeof exposure?.maxIso !== "number" || exposure.maxIso > 100) {
        return `expected exposure.maxIso <= 100, got ${JSON.stringify(exposure)}`;
      }
      return null;
    },
  },
  {
    name: "regression: exploratory searches don't leak into the shown images",
    query: "show me 5 pics from switzerland on the first day",
    check(result) {
      const call = lastCallTo(result.toolCalls, "search_photos");
      if (!call) return "expected a search_photos call, got none";
      if (call.input.country !== "Switzerland") {
        return `expected country "Switzerland", got ${JSON.stringify(call.input.country)}`;
      }
      // A multi-step query like this often makes the model search broadly
      // first (e.g. no limit, to find "the first day") and then again with
      // a tight limit. Regression guard for the image-accumulation bug:
      // `images` must come from the LAST search only, not every round.
      const declaredLimit =
        typeof call.input.limit === "number" ? call.input.limit : 20;
      if (result.images.length > declaredLimit) {
        return `images (${result.images.length}) exceed the last search's own limit (${declaredLimit}) — a prior round's results leaked through`;
      }
      return null;
    },
  },
  {
    name: "vibe query picks semantic search, not structured filters",
    query: "find me some moody, foggy-looking photos",
    check(result) {
      const call = lastCallTo(result.toolCalls, "search_photos_by_description");
      if (!call) {
        return "expected a search_photos_by_description call, got none";
      }
      if (typeof call.input.query !== "string" || !call.input.query.trim()) {
        return `expected a non-empty query string, got ${JSON.stringify(call.input.query)}`;
      }
      return null;
    },
  },
];
