import { SnowflakeUtil } from "discord.js";
import {
    ComponentType,
    InteractionResponseType,
    MessageFlags,
    type RESTPatchAPIWebhookWithTokenMessageJSONBody,
} from "discord-api-types/v10";
import { describe, expect, test } from "../../../fixtures.js";
import { PRIVATE_DEFERRAL } from "../../../discord/harness.js";
import { routeInteraction } from "../../../../src/core/events/routeInteraction.js";
import {
    IDS,
    buttonInteraction,
    channelSelectInteraction,
    modalSubmitInteraction,
    roleSelectInteraction,
    stringSelectInteraction,
    apiMember,
} from "../../../discord/payloads.js";
import { guildFactory } from "../../../factories.js";

const CHANNELS = {
    announce: SnowflakeUtil.generate().toString(),
    log: SnowflakeUtil.generate().toString(),
    archive: SnowflakeUtil.generate().toString(),
};
const admin = { member: apiMember({ roles: [IDS.roles.admin] }) };
const MOVIE_ADMIN_ROLE = SnowflakeUtil.generate().toString();
const MOVIE_USER_ROLE = SnowflakeUtil.generate().toString();
const MOVIE_CHANNEL = SnowflakeUtil.generate().toString();
const MOVIE_VOICE_CHANNEL = SnowflakeUtil.generate().toString();
const TASK_ADMIN_ROLE = SnowflakeUtil.generate().toString();
const TASK_USER_ROLE = SnowflakeUtil.generate().toString();
const TASK_CHANNEL = SnowflakeUtil.generate().toString();
const TASK_VERIFICATION_CHANNEL = SnowflakeUtil.generate().toString();

// The select menus' custom ids and placeholders in a reply, row by row
function menuPlaceholders(edit: RESTPatchAPIWebhookWithTokenMessageJSONBody | undefined): Record<string, string> {
    const components = (edit?.components ?? []).flatMap((row) =>
        row.type === ComponentType.ActionRow ? row.components : [],
    );
    return Object.fromEntries(
        components.flatMap((menu) =>
            "placeholder" in menu && menu.placeholder ? [[menu.custom_id, menu.placeholder]] : [],
        ),
    );
}

describe("the setup commands", () => {
    test("/setup acknowledges privately first, then offers the channel pickers showing the current channels", async ({
        discord,
        slash,
    }) => {
        const interaction = await slash("setup", [], admin);

        expect(discord.callbacks(interaction)).toEqual([PRIVATE_DEFERRAL]);
        expect(menuPlaceholders(discord.originalEdits(interaction)[0])).toEqual({
            setup_announce: "Channel for bot announcements (Current: #general)",
            setup_log: "Channel for errors and logs (Current: None)",
            setup_archive: "Channel for archived posts (Current: None)",
        });
    });

    test("/moviesetup acknowledges privately first, then offers the role and channel pickers showing the current choices", async ({
        discord,
        slash,
    }) => {
        const interaction = await slash("moviesetup", [], admin);

        expect(discord.callbacks(interaction)).toEqual([PRIVATE_DEFERRAL]);
        expect(menuPlaceholders(discord.originalEdits(interaction)[0])).toEqual({
            moviesetup_admin_role: "Role for movie admin commands (Current: @Movie Admin)",
            moviesetup_user_role: "Role notified for movie nights (Current: None)",
            moviesetup_channel: "Channel for movie night announcements (Current: #general)",
            moviesetup_voice_channel: "Voice channel for movie nights (Current: None)",
        });
    });

    test("/tasksetup acknowledges privately first, then offers the role and channel pickers showing the current choices", async ({
        discord,
        slash,
    }) => {
        const interaction = await slash("tasksetup", [], admin);

        expect(discord.callbacks(interaction)).toEqual([PRIVATE_DEFERRAL]);
        expect(menuPlaceholders(discord.originalEdits(interaction)[0])).toEqual({
            tasksetup_admin_role: "Role for approving submissions (Current: @Task Admin)",
            tasksetup_user_role: "Role notified about tasks (Current: None)",
            tasksetup_channel: "Channel for task posts (Current: #general)",
            tasksetup_verification_channel: "Channel for managing submissions (Current: #general)",
        });
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
