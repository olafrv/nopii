// Redacts PII from the USER PROMPT inside an Anthropic Messages API request body.
//
// We only touch user-role messages (the human turn). System prompts and assistant
// turns are left untouched. Within a user message we redact:
//   - plain string content
//   - { type: "text", text } blocks
//   - { type: "tool_result", content } text (file/command output the user is feeding back)
//
// Set REDACT_TOOL_RESULTS=false to skip tool_result content and redact only the
// literal typed prompt.
import { createContext, scrubText } from "./privacy.js";

const REDACT_TOOL_RESULTS = process.env.REDACT_TOOL_RESULTS !== "false";

async function scrubBlock(block, ctx) {
  if (typeof block === "string") return scrubText(block, ctx);
  if (!block || typeof block !== "object") return block;

  if (block.type === "text" && typeof block.text === "string") {
    return { ...block, text: await scrubText(block.text, ctx) };
  }

  if (REDACT_TOOL_RESULTS && block.type === "tool_result" && block.content != null) {
    if (typeof block.content === "string") {
      return { ...block, content: await scrubText(block.content, ctx) };
    }
    if (Array.isArray(block.content)) {
      const content = [];
      for (const inner of block.content) content.push(await scrubBlock(inner, ctx));
      return { ...block, content };
    }
  }

  return block;
}

async function scrubMessageContent(content, ctx) {
  if (typeof content === "string") return scrubText(content, ctx);
  if (Array.isArray(content)) {
    const out = [];
    for (const block of content) out.push(await scrubBlock(block, ctx));
    return out;
  }
  return content;
}

// Returns { body, mapping, count }. `body` is a new object safe to forward.
export async function redactRequestBody(body) {
  const ctx = createContext();

  if (!body || !Array.isArray(body.messages)) {
    return { body, mapping: ctx.mapping, count: 0 };
  }

  const messages = [];
  for (const msg of body.messages) {
    if (msg && msg.role === "user") {
      messages.push({ ...msg, content: await scrubMessageContent(msg.content, ctx) });
    } else {
      messages.push(msg);
    }
  }

  return { body: { ...body, messages }, mapping: ctx.mapping, count: ctx.count };
}
