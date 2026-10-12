import { SnowflakeUtil } from "discord.js";
import { InteractionResponseType, MessageFlags } from "discord-api-types/v10";
import { describe, expect, test } from "../../../fixtures.js";
import { PRIVATE_DEFERRAL, componentsIn } from "../../../discord/harness.js";
import { routeInteraction } from "../../../../src/core/events/routeInteraction.js";
import {
    AS,
    IDS,
    NAMES,
    buttonInteraction,
    channelSelectInteraction,
    modalSubmitInteraction,
    roleSelectInteraction,
    stringSelectInteraction,
    chatInputInteraction,
} from "../../../discord/payloads.js";
import { guildFactory } from "../../../factories.js";

const CHANNELS = {
    announce: SnowflakeUtil.generate().toString(),
    log: SnowflakeUtil.generate().toString(),
    archive: SnowflakeUtil.generate().toString(),
};
const MOVIE_ADMIN_ROLE = SnowflakeUtil.generate().toString();
const MOVIE_USER_ROLE = SnowflakeUtil.generate().toString();
const MOVIE_CHANNEL = SnowflakeUtil.generate().toString();
const MOVIE_VOICE_CHANNEL = SnowflakeUtil.generate().toString();
const TASK_ADMIN_ROLE = SnowflakeUtil.generate().toString();
const TASK_USER_ROLE = SnowflakeUtil.generate().toString();
const TASK_CHANNEL = SnowflakeUtil.generate().toString();
const TASK_VERIFICATION_CHANNEL = SnowflakeUtil.generate().toString();

// The select menus' custom ids and placeholders in a reply, row by row
describe("the setup commands", () => {
    test("/setup acknowledges privately first, then offers the channel pickers showing the current channels", async ({
        discord,
        interact,
    }) => {
        const interaction = await interact(chatInputInteraction("setup", [], AS.botAdmin));

        expect(discord.callbacks(interaction)).toEqual([PRIVATE_DEFERRAL]);
        expect(componentsIn(discord.originalEdits(interaction)[0]?.components)).toMatchObject([
            { customId: "setup_announce", placeholder: `Channel for bot announcements (Current: #${NAMES.channel})` },
            { customId: "setup_log", placeholder: "Channel for errors and logs (Current: None)" },
            { customId: "setup_archive", placeholder: "Channel for archived posts (Current: None)" },
            { customId: "setup_timezone" },
            { customId: "setup_confirm" },
            { customId: "setup_cancel" },
        ]);
    });

    test("/moviesetup acknowledges privately first, then offers the role and channel pickers showing the current choices", async ({
        discord,
        interact,
    }) => {
        const interaction = await interact(chatInputInteraction("moviesetup", [], AS.botAdmin));

        expect(discord.callbacks(interaction)).toEqual([PRIVATE_DEFERRAL]);
        expect(componentsIn(discord.originalEdits(interaction)[0]?.components)).toMatchObject([
            {
                customId: "moviesetup_admin_role",
                placeholder: `Role for movie admin commands (Current: @${NAMES.roles.movieAdmin})`,
            },
            { customId: "moviesetup_user_role", placeholder: "Role notified for movie nights (Current: None)" },
            {
                customId: "moviesetup_channel",
                placeholder: `Channel for movie night announcements (Current: #${NAMES.channel})`,
            },
            { customId: "moviesetup_voice_channel", placeholder: "Voice channel for movie nights (Current: None)" },
            { customId: "moviesetup_confirm" },
            { customId: "moviesetup_cancel" },
        ]);
    });

    test("/tasksetup acknowledges privately first, then offers the role and channel pickers showing the current choices", async ({
        discord,
        interact,
    }) => {
        const interaction = await interact(chatInputInteraction("tasksetup", [], AS.botAdmin));

        expect(discord.callbacks(interaction)).toEqual([PRIVATE_DEFERRAL]);
        expect(componentsIn(discord.originalEdits(interaction)[0]?.components)).toMatchObject([
            {
                customId: "tasksetup_admin_role",
                placeholder: `Role for approving submissions (Current: @${NAMES.roles.taskAdmin})`,
            },
            {
                customId: "tasksetup_user_role",
                placeholder: `Role notified about tasks (Current: @${NAMES.roles.taskUser})`,
            },
            { customId: "tasksetup_channel", placeholder: `Channel for task posts (Current: #${NAMES.channel})` },
            {
                customId: "tasksetup_verification_channel",
                placeholder: `Channel for managing submissions (Current: #${NAMES.channel})`,
            },
            { customId: "tasksetup_confirm" },
            { customId: "tasksetup_cancel" },
        ]);
    });
});

describe("/setup choices", () => {
    test("saves the chosen channels and marks the core setup complete", async ({ discord, interact, services }) => {
        await interact(channelSelectInteraction("setup_announce", [CHANNELS.announce]));
        await interact(channelSelectInteraction("setup_log", [CHANNELS.log]));
        await interact(channelSelectInteraction("setup_archive", [CHANNELS.archive]));

        const confirm = await interact(buttonInteraction("setup_confirm"));

        expect(discord.callbacks(confirm)).toEqual([
            {
                type: InteractionResponseType.UpdateMessage,
                data: expect.objectContaining({ content: expect.stringContaining("Setup complete!"), components: [] }),
            },
        ]);
        expect(await services.repos.guildRepo.getGuild(IDS.guild)).toMatchObject({
            channels: {
                announcements: CHANNELS.announce,
                botLog: CHANNELS.log,
                botArchive: CHANNELS.archive,
                taskChannel: IDS.channel,
            },
            setupComplete: { core: true, movie: true, task: true },
        });
    });

    test("lists what is still missing when confirmed too early", async ({ discord, interact }) => {
        await interact(channelSelectInteraction("setup_announce", [CHANNELS.announce]));

        const confirm = await interact(buttonInteraction("setup_confirm"));

        expect(discord.callbacks(confirm)).toEqual([
            {
                type: InteractionResponseType.ChannelMessageWithSource,
                data: expect.objectContaining({
                    content: "Please select: botLog, botArchive",
                    flags: MessageFlags.Ephemeral,
                }),
            },
        ]);
    });

    test("discards the choices when cancelled", async ({ discord, interact }) => {
        await interact(channelSelectInteraction("setup_announce", [CHANNELS.announce]));

        const cancel = await interact(buttonInteraction("setup_cancel"));
        const confirm = await interact(buttonInteraction("setup_confirm"));

        expect(discord.callbacks(cancel)).toEqual([
            {
                type: InteractionResponseType.UpdateMessage,
                data: expect.objectContaining({ content: "Setup cancelled. No changes were made.", components: [] }),
            },
        ]);
        expect(discord.callbacks(confirm)).toEqual([
            expect.objectContaining({
                data: expect.objectContaining({ content: "Please select: announcements, botLog, botArchive" }),
            }),
        ]);
    });

    test("keeps one guild's choices separate from another's", async ({ discord, interact, otherGuild, commands }) => {
        await interact(channelSelectInteraction("setup_announce", [CHANNELS.announce]));

        const confirmElsewhere = await discord.dispatch(
            buttonInteraction("setup_confirm", undefined, { guild_id: IDS.otherGuild }),
        );
        await routeInteraction(confirmElsewhere, discord.client, commands, otherGuild);

        expect(discord.callbacks(confirmElsewhere)).toEqual([
            expect.objectContaining({
                data: expect.objectContaining({ content: "Please select: announcements, botLog, botArchive" }),
            }),
        ]);
    });

    test("opens the timezone form and saves a recognised zone", async ({ discord, interact, services }) => {
        const button = await interact(buttonInteraction("setup_timezone"));
        expect(discord.modal(button)?.custom_id).toBe("setup_timezone_modal");

        const submit = await interact(
            modalSubmitInteraction("setup_timezone_modal", { timezone_input: "Australia/Melbourne" }),
        );

        expect(discord.callbacks(submit)).toEqual([
            {
                type: InteractionResponseType.ChannelMessageWithSource,
                data: expect.objectContaining({
                    content: expect.stringContaining("Timezone set to **Australia/Melbourne**"),
                    flags: MessageFlags.Ephemeral,
                }),
            },
        ]);
        expect(await services.repos.guildRepo.getGuild(IDS.guild)).toMatchObject({
            timezone: "Australia/Melbourne",
            channels: guildFactory.build().channels,
        });
    });

    test("rejects a timezone it does not recognise", async ({ discord, interact, services }) => {
        const submit = await interact(modalSubmitInteraction("setup_timezone_modal", { timezone_input: "not a zone" }));

        expect(discord.callbacks(submit)).toEqual([
            {
                type: InteractionResponseType.ChannelMessageWithSource,
                data: expect.objectContaining({
                    content: expect.stringContaining("Could not recognise that timezone"),
                    flags: MessageFlags.Ephemeral,
                }),
            },
        ]);
        expect((await services.repos.guildRepo.getGuild(IDS.guild))?.timezone).toBe(guildFactory.build().timezone);
    });
});

describe("/moviesetup choices", () => {
    test("saves the movie roles and channels without touching other settings", async ({
        discord,
        interact,
        services,
    }) => {
        await interact(roleSelectInteraction("moviesetup_admin_role", [MOVIE_ADMIN_ROLE]));
        await interact(roleSelectInteraction("moviesetup_user_role", [MOVIE_USER_ROLE]));
        await interact(channelSelectInteraction("moviesetup_channel", [MOVIE_CHANNEL]));
        await interact(channelSelectInteraction("moviesetup_voice_channel", [MOVIE_VOICE_CHANNEL]));

        const confirm = await interact(buttonInteraction("moviesetup_confirm"));

        expect(discord.callbacks(confirm)).toEqual([
            {
                type: InteractionResponseType.UpdateMessage,
                data: expect.objectContaining({
                    content: expect.stringContaining("Movie module setup complete!"),
                    components: [],
                }),
            },
        ]);
        expect(await services.repos.guildRepo.getGuild(IDS.guild)).toMatchObject({
            roles: guildFactory.build({ roles: { movieAdmin: MOVIE_ADMIN_ROLE, movieUser: MOVIE_USER_ROLE } }).roles,
            channels: guildFactory.build({ channels: { movieNight: MOVIE_CHANNEL, movieVC: MOVIE_VOICE_CHANNEL } })
                .channels,
        });
    });

    test("lists what is still missing when confirmed too early", async ({ discord, interact }) => {
        await interact(channelSelectInteraction("moviesetup_channel", [MOVIE_CHANNEL]));

        const confirm = await interact(buttonInteraction("moviesetup_confirm"));

        expect(discord.callbacks(confirm)).toEqual([
            {
                type: InteractionResponseType.ChannelMessageWithSource,
                data: expect.objectContaining({
                    content: "Please select: movieAdmin, movieUser, movieVC before confirming.",
                    flags: MessageFlags.Ephemeral,
                }),
            },
        ]);
    });
});

describe("/tasksetup choices", () => {
    test("saves the task roles, channels and leaderboard period", async ({ discord, interact, services }) => {
        await interact(roleSelectInteraction("tasksetup_admin_role", [TASK_ADMIN_ROLE]));
        await interact(roleSelectInteraction("tasksetup_user_role", [TASK_USER_ROLE]));
        await interact(channelSelectInteraction("tasksetup_channel", [TASK_CHANNEL]));
        await interact(channelSelectInteraction("tasksetup_verification_channel", [TASK_VERIFICATION_CHANNEL]));
        await interact(stringSelectInteraction("tasksetup_period_events", ["6"]));

        const confirm = await interact(buttonInteraction("tasksetup_confirm"));

        expect(discord.callbacks(confirm)).toEqual([
            {
                type: InteractionResponseType.UpdateMessage,
                data: expect.objectContaining({
                    content: expect.stringContaining("Task module setup complete!"),
                    components: [],
                }),
            },
        ]);
        expect(await services.repos.guildRepo.getGuild(IDS.guild)).toMatchObject({
            roles: guildFactory.build({ roles: { taskAdmin: TASK_ADMIN_ROLE, taskUser: TASK_USER_ROLE } }).roles,
            channels: guildFactory.build({
                channels: { taskChannel: TASK_CHANNEL, taskVerification: TASK_VERIFICATION_CHANNEL },
            }).channels,
            taskSettings: { periodEvents: 6 },
        });
    });

    test("cancels without saving anything", async ({ discord, interact, services }) => {
        await interact(roleSelectInteraction("tasksetup_admin_role", [TASK_ADMIN_ROLE]));

        const cancel = await interact(buttonInteraction("tasksetup_cancel"));

        expect(discord.callbacks(cancel)).toEqual([
            {
                type: InteractionResponseType.UpdateMessage,
                data: expect.objectContaining({
                    content: "Task setup cancelled. No changes were made.",
                    components: [],
                }),
            },
        ]);
        expect((await services.repos.guildRepo.getGuild(IDS.guild))?.roles).toEqual(guildFactory.build().roles);
    });
});
