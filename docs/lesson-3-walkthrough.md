# Lesson 3 classroom walkthrough

**Topic:** Query Handles and Runtime Methods · Claude Agent SDK TypeScript 0.3.310

Allow 20–30 minutes. Start in **Practice**. It uses fictional messages and usage, clearly labeled in the UI; no model account is needed. The host controller is the same one used by optional live mode.

## 1. Retain and observe

Create a query handle. Record its short ID. Send a turn and identify the `system`, `user`, `assistant`, and `result` events. Explain why the host must inspect the type before reading fields.

**Check:** The turn count becomes 1, close count stays 0, and status returns to ready. A streaming-input turn result is separate from closing the whole session.

Read `src/server/live.ts` and `input.ts`. Find the open input queue and the single call to `query()`. Then find the `for await` consumer in `session.ts`.

## 2. Separate inspection from control

Click **Available agents** and **MCP status**. Open **Change the runtime**, attach the course MCP server, and inspect status again. Compare the control event data.

**Questions:** Did agent discovery launch an agent? Does a connected server prove permission to use its tools?

**Answers:** No. Discovery inspects availability. MCP status inspects a connection; tool availability and permission require separate configuration. Live mode disables built-in tools and only auto-approves the exact bundled course-note tool.

Remove the server, inspect status, then attach it again. Explain that this UI manages its own dynamic server set. Settings-defined and plugin-owned servers follow different removal rules.

## 3. Change the next response

In practice mode enter `student-model-v2`, apply the model, and send a second turn. Compare the handle ID and turn count.

**Check:** The same ID remains, the turn count becomes 2, and the host records `setModel()` separately from messages. The fixture model is fictional. In live mode use an available provider model; a change applies to subsequent responses and does not rewrite earlier output.

Try **Reload plugins**. Read its returned outcome. A `held: true` response means the runtime held the reload because of cache impact. The application does not force a second reload.

## 4. Read usage without double-counting

Inspect **Result usage** and **Context usage**. After two practice turns, the latest fictional cumulative cost is $0.0020, not $0.0030.

**Why?** Each result's `total_cost_usd` and `modelUsage` are cumulative snapshots. Replace the latest snapshot. `usage` covers the main-loop turn. Context categories describe the current context window and are separate from billing.

**Version correction:** The conceptual `getUsage()` name in the lesson is not a `Query` method in the pinned 0.3.310 package. The sample reads result fields. It does not silently substitute the package's explicitly experimental usage API.

## 5. Close deliberately

Send another turn and close while it is running. Verify the handle is closed and no later result changes the UI. Create a new handle and compare the new ID and reset counters.

**Check:** The host calls `q.close()` once per session and disposes its input queue, abort signal, timer, and bundled MCP server. Reading usage would not perform cleanup. Replacement, expiry, timeout, stream end/failure, and graceful shutdown also trigger disposal.

## 6. Optional live check

Use your own server-side API key and switch to live mode. Sending a prompt makes billable model requests. Repeat one turn, inspect the available runtime data, then close. Do not expect fixture wording, token counts, model names, or costs to match real output.

## Student extension

Add a **last successful control** indicator from the selected event log. Keep runtime controls and messages separate. Do not add a second `query()` call for inspection. Add a test that a failed control does not overwrite the last successful indicator.

## Exit questions

1. Why retain q? **To observe, inspect, control, and close the same session.**
2. What does async iteration provide? **Typed runtime messages as the query proceeds.**
3. Does a connected MCP server imply permission? **No.**
4. What is the difference between usage inspection and cleanup? **One reads resource information; the other ends the session and releases host resources.**

Finish the in-app quiz and export a trace. A practice trace explicitly marks `fixtureData: true`.
