import { ApplicationCommandOptionType } from "discord-api-types/v10";
import { describe, expect, test } from "../../../../fixtures.js";
import { TaskCategory } from "../../../../../src/models/Task.js";

describe("/viewtask", () => {
    test("shows the task found by its id, with its tier amounts", async ({ discord, slash, factories }) => {
        const task = await factories.task.create({
            id: "PVM007",
            taskName: "Kill {amount} Vorkath",
            category: TaskCategory.PvM,
            amtBronze: 5,
            amtSilver: 10,
            amtGold: 20,
        });

        const command = await slash("viewtask", [
            { type: ApplicationCommandOptionType.String, name: "search", value: task.id },
        ]);

        const [reply] = discord.originalEdits(command);
        expect(reply?.embeds?.[0]).toMatchObject({ title: "PvM Task", footer: { text: task.id } });
        expect(reply?.embeds?.[0]?.description).toContain("**Kill {amount} Vorkath**");
        expect(reply?.embeds?.[0]?.description).toContain("🥉 **5** 🥈 **10** 🥇 **20**");
    });

    test("finds a task by a misspelt name", async ({ discord, slash, factories }) => {
        await factories.task.create({ id: "PVM001", taskName: "Kill {amount} Zulrah" });
        const vorkath = await factories.task.create({ id: "PVM002", taskName: "Kill {amount} Vorkath" });

        const command = await slash("viewtask", [
            { type: ApplicationCommandOptionType.String, name: "search", value: "vorkth" },
        ]);

        expect(discord.originalEdits(command)[0]?.embeds?.[0]?.footer?.text).toBe(vorkath.id);
    });

    test("says so when nothing matches", async ({ discord, slash, factories }) => {
        await factories.task.create({ id: "PVM001", taskName: "Kill {amount} Zulrah" });

        const command = await slash("viewtask", [
            { type: ApplicationCommandOptionType.String, name: "search", value: "Tempoross" },
        ]);

        expect(discord.originalEdits(command)).toEqual([
            expect.objectContaining({ content: "No task found matching `Tempoross`." }),
        ]);
    });

    test("says so when no tasks are stored", async ({ discord, slash }) => {
        const command = await slash("viewtask", [
            { type: ApplicationCommandOptionType.String, name: "search", value: "PVM001" },
        ]);

        expect(discord.originalEdits(command)).toEqual([
            expect.objectContaining({ content: "No tasks were found in the database." }),
        ]);
    });
});
