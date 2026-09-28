import { expect } from "bun:test"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { ModelV2 } from "@opencode-ai/core/model"
import { ProjectV2 } from "@opencode-ai/core/project"
import { ProviderV2 } from "@opencode-ai/core/provider"
import { SessionV1 } from "@opencode-ai/core/v1/session"
import { Effect, Layer } from "effect"
import { Agent } from "@/agent/agent"
import { Provider } from "@/provider/provider"
import { Question } from "@/question"
import { SessionCompaction } from "@/session/compaction"
import { MessageID, SessionID } from "@/session/schema"
import { Session } from "@/session/session"
import { PlanExitTool } from "@/tool/plan"
import { Truncate } from "@/tool/truncate"
import { testEffect } from "../lib/effect"

const it = testEffect(LayerNode.compile(LayerNode.group([Agent.node, Truncate.node])))

it.instance("compacts context when exiting plan mode", () => {
  const sessionID = SessionID.make("ses_test")
  const model = {
    providerID: ProviderV2.ID.opencode,
    modelID: ModelV2.ID.make("test"),
  }
  const calls: string[] = []
  const messages: SessionV1.User[] = []
  const parts: SessionV1.Part[] = []
  const compactions: Parameters<SessionCompaction.Interface["create"]>[0][] = []
  const questions: Question.Info[][] = []

  return Effect.gen(function* () {
    const tool = yield* PlanExitTool
    const result = yield* (yield* tool.init()).execute(
      {},
      {
        sessionID,
        messageID: MessageID.make("msg_test"),
        agent: "plan",
        abort: new AbortController().signal,
        messages: [],
        metadata: () => Effect.void,
        ask: () => Effect.void,
      },
    )

    expect(questions[0]?.[0]?.question).toContain("compact the previous context")
    expect(result.title).toBe("Compacting context and switching to build agent")
    expect(messages).toContainEqual(expect.objectContaining({ sessionID, agent: "build", model }))
    expect(parts).toContainEqual(
      expect.objectContaining({
        type: "text",
        text: expect.stringContaining("Execute the plan"),
        synthetic: true,
      }),
    )
    expect(compactions).toEqual([{ sessionID, agent: "build", model, auto: true }])
    expect(calls).toEqual(["message", "part", "compaction"])
  }).pipe(
    Effect.provide(
      Layer.mergeAll(
        Layer.mock(Session.Service, {
          get: () =>
            Effect.succeed({
              id: sessionID,
              slug: "test",
              projectID: ProjectV2.ID.make("test"),
              directory: "",
              title: "test",
              version: "test",
              time: { created: 0, updated: 0 },
            }),
          messages: () =>
            Effect.succeed([
              {
                info: {
                  id: MessageID.make("msg_previous"),
                  sessionID,
                  role: "user",
                  time: { created: 0 },
                  agent: "plan",
                  model,
                },
                parts: [],
              },
            ]),
          updateMessage: (message) => {
            if (message.role === "user") messages.push(message)
            calls.push("message")
            return Effect.succeed(message)
          },
          updatePart: (part) => {
            parts.push(part)
            calls.push("part")
            return Effect.succeed(part)
          },
        }),
        Layer.mock(Question.Service, {
          ask: (input) => {
            questions.push([...input.questions])
            return Effect.succeed([["Yes"]])
          },
        }),
        Layer.mock(Provider.Service, {
          defaultModel: () => Effect.succeed(model),
        }),
        Layer.mock(SessionCompaction.Service, {
          create: (input) => {
            compactions.push(input)
            calls.push("compaction")
            return Effect.void
          },
        }),
      ),
    ),
  )
})
