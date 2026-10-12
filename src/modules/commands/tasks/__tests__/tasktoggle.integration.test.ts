import cron from "node-cron";
import { ApplicationCommandOptionType } from "discord-api-types/v10";
import { afterEach, describe, expect, test } from "../../../../tests/fixtures.js";
import { createServiceContainer } from "../../../../core/services/ServiceFactory.js";
import { GuildRepository } from "../../../../core/database/GuildRepo.js";
import { IDS, withRoles } from "../../../../tests/discord/payloads.js";
import { buildGuild } from "../../../../tests/fakes/builders.js";
import { initTaskScheduler } from "../../../tasks/TaskScheduler.js";

const admin = withRoles(IDS.roles.admin);

function subcommand(name: "schedule" | "leaderboard") {
    return [{ type: ApplicationCommandOptionType.Subcommand as const, name }];
}

function jobCount(guildId: string): number {
    return [...cron.getTasks().values()].filter((job) => job.name?.startsWith(`taskScheduler:${guildId}:`)).length;
}

afterEach(async () => {
    await cron.shutdown();
});

describe("/tasktoggle schedule", () => {
    test("starts this guild's task jobs and saves the toggle", async ({ discord, slash, db }) => {
        const interaction = await slash("tasktoggle", subcommand("schedule"), admin);

        expect(discord.originalEdits(interaction)).toEqual([
            expect.objectContaining({ content: "✅ Task scheduler **enabled** and started for this guild." }),
        ]);
        expect(jobCount(IDS.guild)).toBe(5);
        expect((await new GuildRepository(db).getGuild(IDS.guild))?.toggles.taskScheduler).toBe(true);
    });

    test("stops only this guild's task jobs when switched off", async ({ discord, slash, services, db }) => {
        await new GuildRepository(db).initGuild(IDS.otherGuild, buildGuild({ id: IDS.otherGuild }));
        await initTaskScheduler(discord.client, createServiceContainer(db, IDS.otherGuild, services.botStats));
        await slash("tasktoggle", subcommand("schedule"), admin);

        const interaction = await slash("tasktoggle", subcommand("schedule"), admin);

        expect(discord.originalEdits(interaction)).toEqual([
            expect.objectContaining({ content: "⏹️ Task scheduler **disabled** and stopped for this guild." }),
        ]);
        expect(jobCount(IDS.guild)).toBe(0);
        expect(jobCount(IDS.otherGuild)).toBe(5);
        expect((await new GuildRepository(db).getGuild(IDS.guild))?.toggles.taskScheduler).toBe(false);
    });

    test("works for a guild stored without any toggles", async ({ discord, slash, db }) => {
        const { toggles: _toggles, ...withoutToggles } = buildGuild();
        await db.doc(`guilds/${IDS.guild}`).set(withoutToggles);

        const interaction = await slash("tasktoggle", subcommand("schedule"), admin);

        expect(discord.originalEdits(interaction)).toEqual([
            expect.objectContaining({ content: "✅ Task scheduler **enabled** and started for this guild." }),
        ]);
        expect(jobCount(IDS.guild)).toBe(5);
    });
});

describe("/tasktoggle leaderboard", () => {
    test("switches periodic leaderboard automation off and back on", async ({ discord, slash, db }) => {
        const off = await slash("tasktoggle", subcommand("leaderboard"), admin);
        expect(discord.originalEdits(off)).toEqual([
            expect.objectContaining({ content: "🧊 Periodic leaderboard automation **disabled** (read-only mode)." }),
        ]);
        expect((await new GuildRepository(db).getGuild(IDS.guild))?.toggles.taskLeaderboard).toBe(false);

        const on = await slash("tasktoggle", subcommand("leaderboard"), admin);
        expect(discord.originalEdits(on)).toEqual([
            expect.objectContaining({ content: "🏆 Periodic leaderboard automation **enabled**." }),
        ]);
        expect((await new GuildRepository(db).getGuild(IDS.guild))?.toggles.taskLeaderboard).toBe(true);
    });
});
