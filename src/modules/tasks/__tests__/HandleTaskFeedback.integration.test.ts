import { InteractionResponseType, MessageFlags } from "discord-api-types/v10";
import { describe, expect, test } from "../../../tests/fixtures.js";
import { routeInteraction } from "../../../core/events/routeInteraction.js";
import { CONCURRENT_TRANSACTION_TIMEOUT_MS } from "../../../tests/firestoreEmulator.js";
import { IDS, buttonInteraction } from "../../../tests/discord/payloads.js";
import { buildTask } from "../../../tests/fakes/builders.js";

const privateDeferral = { type: InteractionResponseType.DeferredChannelMessageWithSource, data: { flags: MessageFlags.Ephemeral } };

describe("task feedback buttons", () => {
    test("thank a member for their first vote and raise the task's weight", async ({ discord, interact, services }) => {
        await services.repos.taskRepo!.createTask(buildTask({ id: "PVM001", weight: 50 }));

        const click = await interact(buttonInteraction("task-feedback|up|PVM001|PVM001-20260105"));

        expect(discord.callbacks(click)).toEqual([privateDeferral]);
        expect(discord.originalEdits(click)).toEqual([expect.objectContaining({ content: "Thanks for your feedback!" })]);
        expect(await services.repos.taskRepo!.getTaskById("PVM001")).toMatchObject({ weight: 51 });
    });

    test("count two quick clicks of the same button once", async ({ discord, services, commands }) => {
        await services.repos.taskRepo!.createTask(buildTask({ id: "PVM001", weight: 50 }));
        const first = await discord.dispatch(buttonInteraction("task-feedback|up|PVM001|PVM001-20260105"));
        const second = await discord.dispatch(buttonInteraction("task-feedback|up|PVM001|PVM001-20260105"));

        await Promise.all([first, second].map((click) => routeInteraction(click, discord.client, commands, services)));

        const replies = [first, second].map((click) => discord.originalEdits(click)[0]?.content).sort();
        expect(replies).toEqual(["Thanks for your feedback!", "You already gave this task a 👍."]);
        expect(await services.repos.taskRepo!.getTaskById("PVM001")).toMatchObject({ weight: 51 });
    }, CONCURRENT_TRANSACTION_TIMEOUT_MS);

    test("let a member change their vote", async ({ discord, interact, services }) => {
        await services.repos.taskRepo!.createTask(buildTask({ id: "PVM001", weight: 50 }));
        await interact(buttonInteraction("task-feedback|up|PVM001|PVM001-20260105"));

        const change = await interact(buttonInteraction("task-feedback|down|PVM001|PVM001-20260105"));

        expect(discord.originalEdits(change)).toEqual([expect.objectContaining({ content: "Feedback updated!" })]);
        expect(await services.repos.taskRepo!.getTaskById("PVM001")).toMatchObject({ weight: 49 });
    });

    test("still work on posts made before the button ids changed", async ({ discord, interact, services, db }) => {
        await services.repos.taskRepo!.createTask(buildTask({ id: "PVM001", weight: 50 }));

        const click = await interact(buttonInteraction("task-feedback-down-PVM001-20251006"));

        expect(discord.originalEdits(click)).toEqual([expect.objectContaining({ content: "Thanks for your feedback!" })]);
        expect((await db.doc(`guilds/${IDS.guild}/taskFeedback/PVM001_${IDS.user}`).get()).data()).toMatchObject({
            taskId: "PVM001", eventId: "PVM001-20251006", vote: "down",
        });
    });

    test("reject a direction they don't know", async ({ discord, interact }) => {
        const click = await interact(buttonInteraction("task-feedback|sideways|PVM001|PVM001-20260105"));

        expect(discord.originalEdits(click)).toEqual([expect.objectContaining({ content: "Unknown feedback type." })]);
    });

    test("say so when the task no longer exists", async ({ discord, interact }) => {
        const click = await interact(buttonInteraction("task-feedback|up|PVM404|PVM404-20260105"));

        expect(discord.originalEdits(click)).toEqual([expect.objectContaining({ content: "Task not found." })]);
    });
});
