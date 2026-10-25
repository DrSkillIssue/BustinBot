import { DateTime } from "luxon";
import { ApplicationCommandOptionType } from "discord-api-types/v10";
import { beforeEach, describe, expect, test, vi } from "../fixtures.js";
import { IDS, AS, chatInputInteraction } from "../discord/payloads.js";
import {
    getNextEventDate,
    getNextPollDate,
    getNextPrizeDrawDate,
    initTaskScheduler,
} from "../../src/modules/tasks/TaskScheduler.js";

const atMinute = (minute: number): Date =>
    DateTime.now().set({ hour: 12, minute, second: 0, millisecond: 0 }).toJSDate();

describe("the dev-mode task cycle", () => {
    beforeEach(() => {
        vi.stubEnv("BOT_MODE", "dev");
        vi.stubEnv("DISCORD_GUILD_ID_DEV", IDS.guild);
    });

    test("reports when its next poll, task start and prize draw come", async ({ discord, services }) => {
        vi.setSystemTime(atMinute(2));

        await initTaskScheduler(discord.client, services);

        expect([getNextPollDate(), getNextEventDate(), getNextPrizeDrawDate()]).toEqual([
            atMinute(6),
            atMinute(7),
            atMinute(15),
        ]);
    });
});

describe("/tasktoggle leaderboard", () => {
    test("switches periodic leaderboard automation off and back on", async ({ discord, interact, services }) => {
        await services.guilds.updateToggle(IDS.guild, "toggles.taskLeaderboard", true, IDS.user);

        const off = await interact(
            chatInputInteraction(
                "tasktoggle",
                [{ type: ApplicationCommandOptionType.Subcommand, name: "leaderboard" }],
                AS.botAdmin,
            ),
        );
        expect(discord.originalEdits(off)).toEqual([
            expect.objectContaining({ content: "🧊 Periodic leaderboard automation **disabled** (read-only mode)." }),
        ]);
        expect((await services.repos.guildRepo.getGuild(IDS.guild))?.toggles.taskLeaderboard).toBe(false);

        const on = await interact(
            chatInputInteraction(
                "tasktoggle",
                [{ type: ApplicationCommandOptionType.Subcommand, name: "leaderboard" }],
                AS.botAdmin,
            ),
        );
        expect(discord.originalEdits(on)).toEqual([
            expect.objectContaining({ content: "🏆 Periodic leaderboard automation **enabled**." }),
        ]);
        expect((await services.repos.guildRepo.getGuild(IDS.guild))?.toggles.taskLeaderboard).toBe(true);
    });
});
