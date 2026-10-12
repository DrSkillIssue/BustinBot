import cron from "node-cron";
import { ApplicationCommandOptionType } from "discord-api-types/v10";
import { describe, expect, test } from "../../../../tests/fixtures.js";
import { IDS, apiMember } from "../../../../tests/discord/payloads.js";
import { guildFactory } from "../../../../tests/factories.js";
import { initTaskScheduler } from "../../../tasks/TaskScheduler.js";

const admin = { member: apiMember({ roles: [IDS.roles.admin] }) };

function jobCount(guildId: string): number {
    return [...cron.getTasks().values()].filter((job) => job.name?.startsWith(`taskScheduler:${guildId}:`)).length;
}

describe("/tasktoggle schedule", () => {
    test("starts this guild's task jobs and saves the toggle", async ({ discord, slash, services }) => {
        const interaction = await slash("tasktoggle", [{ type: ApplicationCommandOptionType.Subcommand, name: "schedule" }], admin);

        expect(discord.originalEdits(interaction)).toEqual([
            expect.objectContaining({ content: "✅ Task scheduler **enabled** and started for this guild." }),
        ]);
        expect(jobCount(IDS.guild)).toBe(5);
        expect((await services.repos.guildRepo.getGuild(IDS.guild))?.toggles.taskScheduler).toBe(true);
    });

    test("stops only this guild's task jobs when switched off", async ({ discord, slash, otherGuild, services }) => {
        await initTaskScheduler(discord.client, otherGuild);
        await slash("tasktoggle", [{ type: ApplicationCommandOptionType.Subcommand, name: "schedule" }], admin);

        const interaction = await slash("tasktoggle", [{ type: ApplicationCommandOptionType.Subcommand, name: "schedule" }], admin);

        expect(discord.originalEdits(interaction)).toEqual([
            expect.objectContaining({ content: "⏹️ Task scheduler **disabled** and stopped for this guild." }),
        ]);
        expect(jobCount(IDS.guild)).toBe(0);
        expect(jobCount(IDS.otherGuild)).toBe(5);
        expect((await services.repos.guildRepo.getGuild(IDS.guild))?.toggles.taskScheduler).toBe(false);
    });

    test("works for a guild stored without any toggles", async ({ discord, slash, db }) => {
        const { toggles: _toggles, ...withoutToggles } = guildFactory.build();
        await db.doc(`guilds/${IDS.guild}`).set(withoutToggles);

        const interaction = await slash("tasktoggle", [{ type: ApplicationCommandOptionType.Subcommand, name: "schedule" }], admin);

        expect(discord.originalEdits(interaction)).toEqual([
            expect.objectContaining({ content: "✅ Task scheduler **enabled** and started for this guild." }),
        ]);
        expect(jobCount(IDS.guild)).toBe(5);
    });
});

describe("/tasktoggle leaderboard", () => {
    test("switches periodic leaderboard automation off and back on", async ({ discord, slash, services }) => {
        const off = await slash("tasktoggle", [{ type: ApplicationCommandOptionType.Subcommand, name: "leaderboard" }], admin);
        expect(discord.originalEdits(off)).toEqual([
            expect.objectContaining({ content: "🧊 Periodic leaderboard automation **disabled** (read-only mode)." }),
        ]);
        expect((await services.repos.guildRepo.getGuild(IDS.guild))?.toggles.taskLeaderboard).toBe(false);

        const on = await slash("tasktoggle", [{ type: ApplicationCommandOptionType.Subcommand, name: "leaderboard" }], admin);
        expect(discord.originalEdits(on)).toEqual([
            expect.objectContaining({ content: "🏆 Periodic leaderboard automation **enabled**." }),
        ]);
        expect((await services.repos.guildRepo.getGuild(IDS.guild))?.toggles.taskLeaderboard).toBe(true);
    });
});
