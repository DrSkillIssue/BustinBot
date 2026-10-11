import { InteractionResponseType, MessageFlags } from "discord-api-types/v10";
import { describe, expect, test, vi } from "../../../tests/fixtures.js";
import { routeInteraction } from "../../../core/events/routeInteraction.js";
import { createServiceContainer } from "../../../core/services/ServiceFactory.js";
import { GuildRepository } from "../../../core/database/GuildRepo.js";
import {
    IDS,
    buttonInteraction,
    channelSelectInteraction,
    modalSubmitInteraction,
    roleSelectInteraction,
    stringSelectInteraction,
} from "../../../tests/discord/payloads.js";
import { buildGuild } from "../../../tests/fakes/builders.js";

const CHANNELS = { announce: "100000000000000201", log: "100000000000000202", archive: "100000000000000203" };

describe("/setup choices", () => {
    test("saves the chosen channels and marks the core setup complete", async ({ discord, interact, db }) => {
        vi.spyOn(console, "log").mockImplementation(() => {});
        await interact(channelSelectInteraction("setup_announce", [CHANNELS.announce]));
        await interact(channelSelectInteraction("setup_log", [CHANNELS.log]));
        await interact(channelSelectInteraction("setup_archive", [CHANNELS.archive]));

        const confirm = await interact(buttonInteraction("setup_confirm"));

        expect(discord.callbacks(confirm)).toEqual([{
            type: InteractionResponseType.UpdateMessage,
            data: expect.objectContaining({ content: expect.stringContaining("Setup complete!"), components: [] }),
        }]);
        expect(await new GuildRepository(db).getGuild(IDS.guild)).toMatchObject({
            channels: { announcements: CHANNELS.announce, botLog: CHANNELS.log, botArchive: CHANNELS.archive, taskChannel: IDS.channel },
            setupComplete: { core: true, movie: true, task: true },
        });
    });

    test("lists what is still missing when confirmed too early", async ({ discord, interact }) => {
        await interact(channelSelectInteraction("setup_announce", [CHANNELS.announce]));

        const confirm = await interact(buttonInteraction("setup_confirm"));

        expect(discord.callbacks(confirm)).toEqual([{
            type: InteractionResponseType.ChannelMessageWithSource,
            data: expect.objectContaining({ content: "Please select: botLog, botArchive", flags: MessageFlags.Ephemeral }),
        }]);
    });

    test("discards the choices when cancelled", async ({ discord, interact }) => {
        await interact(channelSelectInteraction("setup_announce", [CHANNELS.announce]));

        const cancel = await interact(buttonInteraction("setup_cancel"));
        const confirm = await interact(buttonInteraction("setup_confirm"));

        expect(discord.callbacks(cancel)).toEqual([{
            type: InteractionResponseType.UpdateMessage,
            data: expect.objectContaining({ content: "Setup cancelled. No changes were made.", components: [] }),
        }]);
        expect(discord.callbacks(confirm)).toEqual([
            expect.objectContaining({ data: expect.objectContaining({ content: "Please select: announcements, botLog, botArchive" }) }),
        ]);
    });

    test("keeps one guild's choices separate from another's", async ({ discord, interact, services, commands, db }) => {
        const otherGuild = "100000000000000011";
        await new GuildRepository(db).initGuild(otherGuild, buildGuild({ id: otherGuild }));
        const otherServices = createServiceContainer(db, otherGuild, services.botStats);
        await interact(channelSelectInteraction("setup_announce", [CHANNELS.announce]));

        const confirmElsewhere = await discord.dispatch(buttonInteraction("setup_confirm", undefined, { guild_id: otherGuild }));
        await routeInteraction(confirmElsewhere, discord.client, commands, otherServices);

        expect(discord.callbacks(confirmElsewhere)).toEqual([
            expect.objectContaining({ data: expect.objectContaining({ content: "Please select: announcements, botLog, botArchive" }) }),
        ]);
    });

    test("opens the timezone form and saves a recognised zone", async ({ discord, interact, db }) => {
        const button = await interact(buttonInteraction("setup_timezone"));
        expect(discord.modal(button)?.custom_id).toBe("setup_timezone_modal");

        vi.spyOn(console, "log").mockImplementation(() => {});
        const submit = await interact(modalSubmitInteraction("setup_timezone_modal", { timezone_input: "Australia/Melbourne" }));

        expect(discord.callbacks(submit)).toEqual([{
            type: InteractionResponseType.ChannelMessageWithSource,
            data: expect.objectContaining({ content: expect.stringContaining("Timezone set to **Australia/Melbourne**"), flags: MessageFlags.Ephemeral }),
        }]);
        expect(await new GuildRepository(db).getGuild(IDS.guild)).toMatchObject({ timezone: "Australia/Melbourne", channels: buildGuild().channels });
    });

    test("rejects a timezone it does not recognise", async ({ discord, interact, db }) => {
        const submit = await interact(modalSubmitInteraction("setup_timezone_modal", { timezone_input: "not a zone" }));

        expect(discord.callbacks(submit)).toEqual([{
            type: InteractionResponseType.ChannelMessageWithSource,
            data: expect.objectContaining({ content: expect.stringContaining("Could not recognise that timezone"), flags: MessageFlags.Ephemeral }),
        }]);
        expect((await new GuildRepository(db).getGuild(IDS.guild))?.timezone).toBe(buildGuild().timezone);
    });
});

describe("/moviesetup choices", () => {
    test("saves the movie roles and channels without touching other settings", async ({ discord, interact, db }) => {
        vi.spyOn(console, "log").mockImplementation(() => {});
        await interact(roleSelectInteraction("moviesetup_admin_role", ["100000000000000301"]));
        await interact(roleSelectInteraction("moviesetup_user_role", ["100000000000000302"]));
        await interact(channelSelectInteraction("moviesetup_channel", ["100000000000000303"]));
        await interact(channelSelectInteraction("moviesetup_voice_channel", ["100000000000000304"]));

        const confirm = await interact(buttonInteraction("moviesetup_confirm"));

        expect(discord.callbacks(confirm)).toEqual([{
            type: InteractionResponseType.UpdateMessage,
            data: expect.objectContaining({ content: expect.stringContaining("Movie module setup complete!"), components: [] }),
        }]);
        expect(await new GuildRepository(db).getGuild(IDS.guild)).toMatchObject({
            roles: { ...buildGuild().roles, movieAdmin: "100000000000000301", movieUser: "100000000000000302" },
            channels: { ...buildGuild().channels, movieNight: "100000000000000303", movieVC: "100000000000000304" },
        });
    });

    test("lists what is still missing when confirmed too early", async ({ discord, interact }) => {
        await interact(channelSelectInteraction("moviesetup_channel", ["100000000000000303"]));

        const confirm = await interact(buttonInteraction("moviesetup_confirm"));

        expect(discord.callbacks(confirm)).toEqual([{
            type: InteractionResponseType.ChannelMessageWithSource,
            data: expect.objectContaining({ content: "Please select: movieAdmin, movieUser, movieVC before confirming.", flags: MessageFlags.Ephemeral }),
        }]);
    });
});

describe("/tasksetup choices", () => {
    test("saves the task roles, channels and leaderboard period", async ({ discord, interact, db }) => {
        vi.spyOn(console, "log").mockImplementation(() => {});
        await interact(roleSelectInteraction("tasksetup_admin_role", ["100000000000000401"]));
        await interact(roleSelectInteraction("tasksetup_user_role", ["100000000000000402"]));
        await interact(channelSelectInteraction("tasksetup_channel", ["100000000000000403"]));
        await interact(channelSelectInteraction("tasksetup_verification_channel", ["100000000000000404"]));
        await interact(stringSelectInteraction("tasksetup_period_events", ["6"]));

        const confirm = await interact(buttonInteraction("tasksetup_confirm"));

        expect(discord.callbacks(confirm)).toEqual([{
            type: InteractionResponseType.UpdateMessage,
            data: expect.objectContaining({ content: expect.stringContaining("Task module setup complete!"), components: [] }),
        }]);
        expect(await new GuildRepository(db).getGuild(IDS.guild)).toMatchObject({
            roles: { ...buildGuild().roles, taskAdmin: "100000000000000401", taskUser: "100000000000000402" },
            channels: { ...buildGuild().channels, taskChannel: "100000000000000403", taskVerification: "100000000000000404" },
            taskSettings: { periodEvents: 6 },
        });
    });

    test("cancels without saving anything", async ({ discord, interact, db }) => {
        await interact(roleSelectInteraction("tasksetup_admin_role", ["100000000000000401"]));

        const cancel = await interact(buttonInteraction("tasksetup_cancel"));

        expect(discord.callbacks(cancel)).toEqual([{
            type: InteractionResponseType.UpdateMessage,
            data: expect.objectContaining({ content: "Task setup cancelled. No changes were made.", components: [] }),
        }]);
        expect((await new GuildRepository(db).getGuild(IDS.guild))?.roles).toEqual(buildGuild().roles);
    });
});
