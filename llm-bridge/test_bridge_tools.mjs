import Anthropic from "@anthropic-ai/sdk";

// Points at the LOCAL litellm proxy, not OpenRouter directly — this is the
// exact same client shape server.mjs uses (authToken + baseURL), so a pass
// here means the bridge is a drop-in ANTHROPIC_BASE_URL replacement.
const anthropic = new Anthropic({
  authToken: process.env.LITELLM_MASTER_KEY,
  apiKey: null,
  baseURL: "http://127.0.0.1:8471",
});

const tools = [
  {
    name: "get_weather",
    description: "Get the current weather for a city.",
    input_schema: {
      type: "object",
      properties: { city: { type: "string" } },
      required: ["city"],
    },
  },
];

async function main() {
  console.log("--- Test 1: does it respond at all, and does it call the tool? ---");
  const stream = anthropic.messages.stream({
    model: "intellirecon-primary",
    max_tokens: 300,
    tools,
    messages: [{ role: "user", content: "What's the weather in Cape Town? Use the tool." }],
  });
  stream.on("text", (t) => process.stdout.write(t));
  const final = await stream.finalMessage();
  console.log("\nstop_reason:", final.stop_reason);
  console.log("content blocks:", JSON.stringify(final.content, null, 2));

  const toolUse = final.content.find((b) => b.type === "tool_use");
  if (!toolUse) {
    console.log("\nRESULT: NO tool_use block returned — bridge did not translate a tool call.");
    return;
  }
  console.log("\ntool_use block found:", JSON.stringify(toolUse));

  console.log("\n--- Test 2: continuing the conversation with a tool_result ---");
  const stream2 = anthropic.messages.stream({
    model: "intellirecon-primary",
    max_tokens: 300,
    tools,
    messages: [
      { role: "user", content: "What's the weather in Cape Town? Use the tool." },
      { role: "assistant", content: final.content },
      {
        role: "user",
        content: [
          { type: "tool_result", tool_use_id: toolUse.id, content: "18C, partly cloudy" },
        ],
      },
    ],
  });
  stream2.on("text", (t) => process.stdout.write(t));
  const final2 = await stream2.finalMessage();
  console.log("\nstop_reason2:", final2.stop_reason);
  console.log("\nRESULT: full round trip (tool_use -> tool_result -> final answer) succeeded.");
}

main().catch((e) => {
  console.error("ERROR:", e.status, e.message);
  process.exit(1);
});
