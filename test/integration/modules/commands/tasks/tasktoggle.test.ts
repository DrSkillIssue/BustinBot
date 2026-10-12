import { ApplicationCommandOptionType } from "discord-api-types/v10";
import { describe, expect, test } from "../../../../fixtures.js";
import { AS, IDS, chatInputInteraction } from "../../../../discord/payloads.js";
import { guildFactory } from "../../../../factories.js";
import { initTaskScheduler } from "../../../../../src/modules/tasks/TaskScheduler.js";

describe("/tasktoggle schedule", () => {
    test("starts this guild's task jobs and saves the toggle", async ({
        discord,
        interact,
        services,
        scheduledJobs,
    }) => {
        const interaction = await interact(
            chatInputInteraction(
                "tasktoggle",
                [{ type: ApplicationCommandOptionType.Subcommand, name: "schedule" }],
                AS.botAdmin,
            ),
        );

        expect(discord.originalEdits(interaction)).toEqual([
            expect.objectContaining({ content: "✅ Task scheduler **enabled** and started for this guild." }),
        ]);
        expect(Object.keys(scheduledJobs(IDS.guild))).toHaveLength(5);
        expect((await services.repos.guildRepo.getGuild(IDS.guild))?.toggles.taskScheduler).toBe(true);
    });

    test("stops only this guild's task jobs when switched off", async ({
        discord,
        interact,
        otherGuild,
        services,
        scheduledJobs,
    }) => {
        await initTaskScheduler(discord.client, otherGuild);
        await interact(
            chatInputInteraction(
                "tasktoggle",
                [{ type: ApplicationCommandOptionType.Subcommand, name: "schedule" }],
                AS.botAdmin,
            ),
        );

        const interaction = await interact(
            chatInputInteraction(
                "tasktoggle",
                [{ type: ApplicationCommandOptionType.Subcommand, name: "schedule" }],
                AS.botAdmin,
            ),
        );

        expect(discord.originalEdits(interaction)).toEqual([
            expect.objectContaining({ content: "⏹️ Task scheduler **disabled** and stopped for this guild." }),
        ]);
        expect(Object.keys(scheduledJobs(IDS.guild))).toHaveLength(0);
        expect(Object.keys(scheduledJobs(IDS.otherGuild))).toHaveLength(5);
        expect((await services.repos.guildRepo.getGuild(IDS.guild))?.toggles.taskScheduler).toBe(false);
    });

    test("works for a guild stored without any toggles", async ({ discord, interact, db, scheduledJobs }) => {
        const { toggles: _toggles, ...withoutToggles } = guildFactory.build();
        await db.doc(`guilds/${IDS.guild}`).set(withoutToggles);

        const interaction = await interact(
            chatInputInteraction(
                "tasktoggle",
                [{ type: ApplicationCommandOptionType.Subcommand, name: "schedule" }],
                AS.botAdmin,
            ),
        );

        expect(discord.originalEdits(interaction)).toEqual([
            expect.objectContaining({ content: "✅ Task scheduler **enabled** and started for this guild." }),
        ]);
        expect(Object.keys(scheduledJobs(IDS.guild))).toHaveLength(5);
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
