// Model-free tests for the rehydration path (the riskiest logic), including
// tokens split across streaming deltas. Run with: node --test test/rehydrate.test.js
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { rehydrate, rehydrateDeep } from "../src/privacy.js";
import { pipeSSEWithRehydration } from "../src/sse-rehydrate.js";

const mapping = {
  "<PERSON_3f9a2b10>": "Sarah Chen",
  "<EMAIL_aa01bb02>": 'a"b@x.com', // contains a quote to exercise JSON escaping
};

describe("rehydrate (string)", () => {
  it("restores plain text", () => {
    assert.equal(rehydrate("Hi <PERSON_3f9a2b10>!", mapping), "Hi Sarah Chen!");
  });
  it("json-escapes when requested", () => {
    assert.equal(rehydrate("<EMAIL_aa01bb02>", mapping, true), 'a\\"b@x.com');
  });
  it("leaves unknown tokens untouched", () => {
    assert.equal(rehydrate("<PERSON_deadbeef>", mapping), "<PERSON_deadbeef>");
  });
});

describe("rehydrateDeep", () => {
  it("walks nested objects/arrays", () => {
    const out = rehydrateDeep(
      { content: [{ type: "text", text: "From <PERSON_3f9a2b10>" }] },
      mapping
    );
    assert.equal(out.content[0].text, "From Sarah Chen");
  });
});

// ---- streaming helpers ----
function streamFromChunks(chunks) {
  const enc = new TextEncoder();
  let i = 0;
  return {
    getReader() {
      return {
        async read() {
          if (i >= chunks.length) return { done: true, value: undefined };
          return { done: false, value: enc.encode(chunks[i++]) };
        },
      };
    },
  };
}

function fakeRes() {
  let out = "";
  return { write: (s) => (out += s), end: (s) => (out += s || ""), get text() { return out; } };
}

function ev(obj) {
  return `event: ${obj.type}\ndata: ${JSON.stringify(obj)}\n\n`;
}

describe("pipeSSEWithRehydration", () => {
  it("rehydrates a token split across two text deltas", async () => {
    const chunks = [
      ev({ type: "content_block_start", index: 0, content_block: { type: "text" } }),
      ev({ type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "Hi <PERSON_3f9" } }),
      ev({ type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "a2b10>, hello" } }),
      ev({ type: "content_block_stop", index: 0 }),
    ];
    const res = fakeRes();
    await pipeSSEWithRehydration(streamFromChunks(chunks), res, mapping);

    // Concatenate all emitted text_delta text fields.
    const texts = [...res.text.matchAll(/"text":"((?:[^"\\]|\\.)*)"/g)].map((m) =>
      JSON.parse(`"${m[1]}"`)
    );
    assert.equal(texts.join(""), "Hi Sarah Chen, hello");
  });

  it("json-escapes originals inside input_json_delta", async () => {
    const chunks = [
      ev({ type: "content_block_start", index: 0, content_block: { type: "tool_use" } }),
      ev({ type: "content_block_delta", index: 0, delta: { type: "input_json_delta", partial_json: '{"to":"<EMAIL_aa01bb02>"}' } }),
      ev({ type: "content_block_stop", index: 0 }),
    ];
    const res = fakeRes();
    await pipeSSEWithRehydration(streamFromChunks(chunks), res, mapping);
    // The reassembled tool input must remain parseable JSON.
    const partials = [...res.text.matchAll(/"partial_json":"((?:[^"\\]|\\.)*)"/g)].map((m) =>
      JSON.parse(`"${m[1]}"`)
    );
    const assembled = partials.join("");
    assert.deepEqual(JSON.parse(assembled), { to: 'a"b@x.com' });
  });
});
