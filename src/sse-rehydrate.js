// Streaming SSE rehydrator for Anthropic's Messages API event stream.
//
// Anthropic streams events separated by a blank line ("\n\n"), each with an
// `event:` line and a `data:` JSON line. We rehydrate placeholder tokens inside:
//   - text_delta.text          -> raw original value (shown to the user)
//   - input_json_delta.partial_json -> JSON-escaped original (stays valid JSON)
//
// A token can be split across consecutive deltas, so per content-block we hold
// back any trailing fragment that could still be the start of a token, and flush
// it as a synthetic delta right before that block's content_block_stop.
import { rehydrate } from "./privacy.js";

// A trailing fragment that might still grow into a complete token.
const PARTIAL_TAIL_RE = /<[A-Z][A-Z_]*(?:_[0-9a-f]{0,8})?>?$/;

function splitSafe(s) {
  const m = s.match(PARTIAL_TAIL_RE);
  // Only hold back if the fragment is genuinely incomplete (no closing '>').
  if (!m || m[0].endsWith(">")) return [s, ""];
  return [s.slice(0, m.index), s.slice(m.index)];
}

export async function pipeSSEWithRehydration(upstreamBody, res, mapping) {
  const reader = upstreamBody.getReader();
  const decoder = new TextDecoder();

  let buf = "";
  const carry = new Map(); // block index -> held text fragment
  const blockType = new Map(); // block index -> "text" | "input_json" | "other"

  const write = (s) => res.write(s);

  const handleEvent = (raw) => {
    const dataLineIdx = raw.indexOf("data:");
    if (dataLineIdx === -1) return raw + "\n\n";

    const dataStr = raw.slice(raw.indexOf("data:") + 5).replace(/^\s/, "");
    let evt;
    try {
      evt = JSON.parse(dataStr);
    } catch {
      return raw + "\n\n"; // not JSON we understand; pass through verbatim
    }

    const reserialize = (obj) => `event: ${obj.type}\ndata: ${JSON.stringify(obj)}\n\n`;

    if (evt.type === "content_block_start") {
      const t = evt.content_block && evt.content_block.type;
      blockType.set(evt.index, t === "tool_use" ? "input_json" : t === "text" ? "text" : "other");
      return raw + "\n\n";
    }

    if (evt.type === "content_block_delta" && evt.delta) {
      const isText = evt.delta.type === "text_delta";
      const isJson = evt.delta.type === "input_json_delta";
      if (isText || isJson) {
        const field = isText ? "text" : "partial_json";
        const idx = evt.index;
        let chunk = (carry.get(idx) || "") + (evt.delta[field] || "");
        chunk = rehydrate(chunk, mapping, isJson);
        const [safe, held] = splitSafe(chunk);
        carry.set(idx, held);
        evt.delta[field] = safe;
        return reserialize(evt);
      }
      return raw + "\n\n";
    }

    if (evt.type === "content_block_stop") {
      const idx = evt.index;
      const held = carry.get(idx);
      carry.delete(idx);
      let out = "";
      if (held) {
        const isJson = blockType.get(idx) === "input_json";
        const flushed = rehydrate(held, mapping, isJson);
        const delta = isJson
          ? { type: "input_json_delta", partial_json: flushed }
          : { type: "text_delta", text: flushed };
        out += reserialize({ type: "content_block_delta", index: idx, delta });
      }
      return out + raw + "\n\n";
    }

    return raw + "\n\n";
  };

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });

      let sep;
      while ((sep = buf.indexOf("\n\n")) !== -1) {
        const rawEvent = buf.slice(0, sep);
        buf = buf.slice(sep + 2);
        if (rawEvent.trim()) write(handleEvent(rawEvent));
      }
    }
    // Flush any trailing partial event.
    if (buf.trim()) write(handleEvent(buf.trim()));
  } finally {
    res.end();
  }
}
