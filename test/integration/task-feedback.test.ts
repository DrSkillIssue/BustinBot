import { describe, expect, test } from "../fixtures.js";
import { PRIVATE_DEFERRAL } from "../discord/harness.js";
import { buttonInteraction } from "../discord/payloads.js";

describe("task feedback buttons", () => {
    test("thank a member for their first vote and raise the task's weight", async ({
        discord,
        interact,
        services,
        factories,
    }) => {
        await factories.task.create({ id: "PVM001", weight: 50 });

        const click = await interact(buttonInteraction("task-feedback|up|PVM001|PVM001-20260105"));

        expect(discord.callbacks(click)).toEqual([PRIVATE_DEFERRAL]);
        expect(discord.originalEdits(click)).toEqual([
            expect.objectContaining({ content: "Thanks for your feedback!" }),
        ]);
        expect(await services.repos.taskRepo.getTaskById("PVM001")).toMatchObject({ weight: 51 });
    });

    test("let a member change their vote", async ({ discord, interact, services, factories }) => {
        await factories.task.create({ id: "PVM001", weight: 50 });
        await interact(buttonInteraction("task-feedback|up|PVM001|PVM001-20260105"));

        const change = await interact(buttonInteraction("task-feedback|down|PVM001|PVM001-20260105"));

        expect(discord.originalEdits(change)).toEqual([expect.objectContaining({ content: "Feedback updated!" })]);
        expect(await services.repos.taskRepo.getTaskById("PVM001")).toMatchObject({ weight: 49 });
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
