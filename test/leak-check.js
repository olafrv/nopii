// Deterministic leak-check: fails CI when known PII stops being detected (a leak)
// or when safe sentences get over-scrubbed. Requires the GLiNER model to be present.
import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import { detectEntities } from "../src/ner.js";
import { fixtures } from "./pii-fixtures.js";

describe("PII leak-check", () => {
  before(async () => {
    await detectEntities("warm-up");
  });

  for (const fixture of fixtures) {
    it(`${fixture.shouldRedact ? "detects" : "ignores"}: "${fixture.text.slice(0, 55)}"`, async () => {
      const entities = await detectEntities(fixture.text);
      const detectedTypes = entities.map((e) => e.type);

      if (fixture.shouldRedact) {
        assert.ok(
          detectedTypes.includes(fixture.type),
          `LEAK: "${fixture.text}": expected ${fixture.type} to be detected but it was not.`
        );
      } else {
        assert.ok(
          !detectedTypes.includes("PERSON"),
          `OVER-SCRUB: "${fixture.text}": PERSON detected but this sentence has no name.`
        );
      }
    });
  }
});
