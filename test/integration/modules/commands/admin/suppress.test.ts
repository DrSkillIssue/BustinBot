import { ApplicationCommandOptionType } from "discord-api-types/v10";
import { describe, expect, test, vi, storePollableTasks } from "../../../../fixtures.js";
import { AS, IDS } from "../../../../discord/payloads.js";

describe("/suppress", () => {
    test("stops the bot pinging roles for the given minutes", async ({ discord, slash, factories }) => {
        await storePollableTasks(factories);
        discord.acceptMessages(IDS.channel);
        vi.setSystemTime(new Date("2026-03-05T12:00:00Z"));

        const command = await slash(
            "suppress",
            [{ type: ApplicationCommandOptionType.Integer, name: "minutes", value: 30 }],
            AS.botAdmin,
        );
        await slash("taskpoll", [], AS.botAdmin);

        // 12:30 UTC on 5 March
        expect(discord.originalEdits(command)).toEqual([
            expect.objectContaining({
                content:
                    "Mention suppression enabled for **30** minutes. It will expire <t:1772713800:R> (<t:1772713800:F>).",
            }),
        ]);
        const [announcement] = discord.messagesSentTo(IDS.channel);
        expect(announcement).toMatchObject({
            content: "**New task polls are live!** Cast your votes for each category below:",
            allowed_mentions: { parse: [], users: [], roles: [] },
        });
    });
});
