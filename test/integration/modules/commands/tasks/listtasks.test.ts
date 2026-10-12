import { ApplicationCommandOptionType, InteractionResponseType, MessageFlags } from "discord-api-types/v10";
import { describe, expect, test } from "../../../../fixtures.js";
import { buttonsIn } from "../../../../discord/harness.js";
import { apiMessage, buttonInteraction } from "../../../../discord/payloads.js";
import { TaskCategory } from "../../../../../src/models/Task.js";

describe("/listtasks", () => {
    test("pages through a category's tasks with buttons that keep working", async ({
        discord,
        interact,
        slash,
        factories,
    }) => {
        for (let number = 1; number <= 9; number++) {
            await factories.task.create({ id: `MIN00${number}`, category: TaskCategory.MinigameMisc });
        }
        await factories.task.create({ id: "PVM001", category: TaskCategory.PvM });

        const command = await slash("listtasks", [
            { type: ApplicationCommandOptionType.String, name: "category", value: TaskCategory.MinigameMisc },
        ]);
        const [firstPage] = discord.originalEdits(command);
        const next = await interact(
            buttonInteraction("listtasks|Minigame/Misc|next|1", apiMessage({ flags: MessageFlags.Ephemeral })),
        );

        expect(firstPage?.embeds?.[0]).toMatchObject({
            title: "📋 Task List - Minigame/Misc",
            footer: { text: "Page 1/2 • 9 tasks" },
        });
        expect(firstPage?.embeds?.[0]?.description).toContain("MIN008");
        expect(firstPage?.embeds?.[0]?.description).not.toContain("MIN009");
        expect(buttonsIn(firstPage?.components).map((button) => button.customId)).toEqual([
            "listtasks|Minigame/Misc|start|0",
            "listtasks|Minigame/Misc|prev|-1",
            "listtasks|Minigame/Misc|next|1",
            "listtasks|Minigame/Misc|end|1",
        ]);
        expect(discord.callbacks(next)).toEqual([{ type: InteractionResponseType.DeferredMessageUpdate }]);
        const [secondPage] = discord.originalEdits(next);
        expect(secondPage?.embeds?.[0]).toMatchObject({ footer: { text: "Page 2/2 • 9 tasks" } });
        expect(secondPage?.embeds?.[0]?.description).toContain("MIN009");
        expect(secondPage?.embeds?.[0]?.description).not.toContain("MIN008");
        expect(
            buttonsIn(secondPage?.components).find((button) => button.customId === "listtasks|Minigame/Misc|end|1"),
        ).toMatchObject({ disabled: true });
    });

    test("shows every category on one page without buttons when the tasks fit", async ({
        discord,
        slash,
        factories,
    }) => {
        await factories.task.create({ id: "PVM001", category: TaskCategory.PvM });
        await factories.task.create({ id: "SKL001", category: TaskCategory.Skilling });

        const command = await slash("listtasks");

        const [page] = discord.originalEdits(command);
        expect(page).toMatchObject({
            embeds: [{ title: "📋 Task List - All Categories", footer: { text: "Page 1/1 • 2 tasks" } }],
            components: [],
        });
    });

    test("says so when a category has no tasks", async ({ discord, slash, factories }) => {
        await factories.task.create({ id: "PVM001", category: TaskCategory.PvM });

        const command = await slash("listtasks", [
            { type: ApplicationCommandOptionType.String, name: "category", value: TaskCategory.Leagues },
        ]);

        expect(discord.originalEdits(command)).toEqual([
            expect.objectContaining({ content: "No tasks were found for **Leagues**." }),
        ]);
    });

    test("shows every category for a page button whose category it doesn't know", async ({
        discord,
        interact,
        factories,
    }) => {
        await factories.task.create({ id: "PVM001", category: TaskCategory.PvM });
        await factories.task.create({ id: "SKL001", category: TaskCategory.Skilling });

        const press = await interact(
            buttonInteraction("listtasks|Raids|start|0", apiMessage({ flags: MessageFlags.Ephemeral })),
        );

        expect(discord.originalEdits(press)).toEqual([
            expect.objectContaining({
                embeds: [expect.objectContaining({ title: "📋 Task List - All Categories" })],
            }),
        ]);
    });
});
