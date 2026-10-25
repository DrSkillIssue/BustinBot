import { GuildMemberFlagsBitField, RoleFlagsBitField, SnowflakeUtil } from "discord.js";
import {
    ApplicationCommandType,
    ChannelType,
    ComponentType,
    GuildDefaultMessageNotifications,
    GuildExplicitContentFilter,
    GuildMFALevel,
    GuildNSFWLevel,
    GuildPremiumTier,
    GuildSystemChannelFlags,
    GuildVerificationLevel,
    InteractionContextType,
    InteractionType,
    Locale,
    MessageType,
    type APIApplicationCommandAutocompleteGuildInteraction,
    type APIApplicationCommandInteractionDataOption,
    type APIAttachment,
    type APIChatInputApplicationCommandGuildInteraction,
    type APIGuildMember,
    type APIGuildTextChannel,
    type APIGuildVoiceChannel,
    type APIVoiceState,
    type APIInteractionDataResolved,
    type APIInteractionDataResolvedChannel,
    type APIInteractionGuildMember,
    type APIMessage,
    type APIMessageButtonInteractionData,
    type APIMessageComponentButtonInteraction,
    type APIMessageComponentSelectMenuInteraction,
    type APIMessageSelectMenuInteractionData,
    type APIModalSubmitGuildInteraction,
    type APIRole,
    type APIUser,
    type GatewayGuildCreateDispatchData,
    type GatewayMessageCreateDispatchData,
} from "discord-api-types/v10";

export const IDS = {
    application: "100000000000000001",
    bot: "100000000000000002",
    guild: "100000000000000010",
    otherGuild: "100000000000000011",
    otherGuildChannel: "100000000000000021",
    uncachedGuild: "100000000000000012",
    channel: "100000000000000020",
    missingChannel: "100000000000000099",
    owner: "100000000000000029",
    dm: "100000000000000050",
    user: "100000000000000030",
    roles: {
        admin: "100000000000000041",
        taskAdmin: "100000000000000042",
        movieAdmin: "100000000000000043",
        taskUser: "100000000000000044",
    },
} as const;

export const NAMES = {
    guild: "Test Guild",
    channel: "general",
    username: "tester",
    displayName: "Tester",
    roles: { admin: "BustinBot Admin", taskAdmin: "Task Admin", movieAdmin: "Movie Admin", taskUser: "Task User" },
} as const;

const EPOCH = "2026-01-01T00:00:00.000Z";
const NO_ROLE_FLAGS = new RoleFlagsBitField().bitfield;
const NO_MEMBER_FLAGS = new GuildMemberFlagsBitField().bitfield;

export function apiUser(overrides: Partial<APIUser> = {}): APIUser {
    return {
        id: IDS.user,
        username: NAMES.username,
        discriminator: "0",
        global_name: NAMES.displayName,
        avatar: null,
        ...overrides,
    };
}

export function apiRole(overrides: Partial<APIRole> = {}): APIRole {
    return {
        id: SnowflakeUtil.generate().toString(),
        name: "role",
        color: 0,
        colors: { primary_color: 0, secondary_color: null, tertiary_color: null },
        hoist: false,
        icon: null,
        unicode_emoji: null,
        position: 1,
        permissions: "0",
        managed: false,
        mentionable: false,
        flags: NO_ROLE_FLAGS,
        ...overrides,
    };
}

export function apiTextChannel(
    overrides: Partial<APIGuildTextChannel<ChannelType.GuildText>> = {},
): APIGuildTextChannel<ChannelType.GuildText> & { guild_id: string } {
    return {
        id: IDS.channel,
        type: ChannelType.GuildText,
        guild_id: IDS.guild,
        name: NAMES.channel,
        position: 0,
        parent_id: null,
        nsfw: false,
        topic: null,
        last_message_id: null,
        rate_limit_per_user: 0,
        permission_overwrites: [],
        ...overrides,
    };
}

export function apiVoiceChannel(
    overrides: Partial<APIGuildVoiceChannel> = {},
): APIGuildVoiceChannel & { guild_id: string } {
    return {
        id: SnowflakeUtil.generate().toString(),
        type: ChannelType.GuildVoice,
        guild_id: IDS.guild,
        name: "Movie Night",
        position: 1,
        parent_id: null,
        nsfw: false,
        last_message_id: null,
        rate_limit_per_user: 0,
        permission_overwrites: [],
        bitrate: 64000,
        user_limit: 0,
        rtc_region: null,
        ...overrides,
    };
}

export function apiVoiceState(
    userId: string,
    channelId: string | null,
    overrides: Partial<APIVoiceState> = {},
): APIVoiceState & { guild_id: string } {
    return {
        guild_id: IDS.guild,
        channel_id: channelId,
        user_id: userId,
        member: apiGuildMember({ user: apiUser({ id: userId }) }),
        session_id: `session-${userId}`,
        deaf: false,
        mute: false,
        self_deaf: false,
        self_mute: false,
        self_video: false,
        suppress: false,
        request_to_speak_timestamp: null,
        ...overrides,
    };
}

export function apiGuild(overrides: Partial<GatewayGuildCreateDispatchData> = {}): GatewayGuildCreateDispatchData {
    const id = overrides.id ?? IDS.guild;
    return {
        id,
        name: NAMES.guild,
        icon: null,
        splash: null,
        discovery_splash: null,
        owner_id: IDS.owner,
        afk_channel_id: null,
        afk_timeout: 300,
        verification_level: GuildVerificationLevel.None,
        default_message_notifications: GuildDefaultMessageNotifications.OnlyMentions,
        explicit_content_filter: GuildExplicitContentFilter.Disabled,
        roles: [
            apiRole({ id, name: "@everyone", position: 0 }),
            apiRole({ id: IDS.roles.admin, name: NAMES.roles.admin }),
            apiRole({ id: IDS.roles.taskAdmin, name: NAMES.roles.taskAdmin }),
            apiRole({ id: IDS.roles.movieAdmin, name: NAMES.roles.movieAdmin }),
            apiRole({ id: IDS.roles.taskUser, name: NAMES.roles.taskUser }),
        ],
        emojis: [],
        features: [],
        mfa_level: GuildMFALevel.None,
        application_id: null,
        system_channel_id: null,
        system_channel_flags: GuildSystemChannelFlags.SuppressJoinNotifications,
        rules_channel_id: null,
        vanity_url_code: null,
        description: null,
        banner: null,
        premium_tier: GuildPremiumTier.None,
        preferred_locale: Locale.EnglishGB,
        public_updates_channel_id: null,
        nsfw_level: GuildNSFWLevel.Default,
        premium_progress_bar_enabled: false,
        safety_alerts_channel_id: null,
        stickers: [],
        hub_type: null,
        incidents_data: null,
        region: "",
        joined_at: EPOCH,
        large: false,
        member_count: 1,
        members: [],
        channels: [apiTextChannel()],
        threads: [],
        presences: [],
        voice_states: [],
        stage_instances: [],
        guild_scheduled_events: [],
        soundboard_sounds: [],
        unavailable: false,
        ...overrides,
    };
}

export function apiOtherGuild(): GatewayGuildCreateDispatchData {
    return apiGuild({
        id: IDS.otherGuild,
        channels: [apiTextChannel({ id: IDS.otherGuildChannel, guild_id: IDS.otherGuild })],
    });
}

export function apiGuildMember(overrides: Partial<APIGuildMember> = {}): APIGuildMember {
    return {
        user: apiUser(),
        roles: [],
        joined_at: EPOCH,
        deaf: false,
        mute: false,
        flags: NO_MEMBER_FLAGS,
        avatar: null,
        banner: null,
        ...overrides,
    };
}

export function apiMember(overrides: Partial<APIInteractionGuildMember> = {}): APIInteractionGuildMember {
    return { ...apiGuildMember(), permissions: "0", ...overrides };
}

const interactionBase = {
    application_id: IDS.application,
    guild_id: IDS.guild,
    version: 1 as const,
    app_permissions: "0",
    locale: Locale.EnglishGB,
    guild_locale: Locale.EnglishGB,
    entitlements: [],
    authorizing_integration_owners: {},
    context: InteractionContextType.Guild,
    attachment_size_limit: 10_485_760,
};

function interactionChannel() {
    return { id: IDS.channel, type: ChannelType.GuildText as const, guild_id: IDS.guild, name: NAMES.channel };
}

export const AS = {
    botAdmin: { member: apiMember({ roles: [IDS.roles.admin] }) },
    taskAdmin: { member: apiMember({ roles: [IDS.roles.taskAdmin] }) },
    movieAdmin: { member: apiMember({ roles: [IDS.roles.movieAdmin] }) },
};

export function chatInputInteraction(
    name: string,
    options: APIApplicationCommandInteractionDataOption[] = [],
    overrides: Partial<APIChatInputApplicationCommandGuildInteraction> = {},
    resolved?: APIInteractionDataResolved,
): APIChatInputApplicationCommandGuildInteraction {
    return {
        ...interactionBase,
        id: SnowflakeUtil.generate().toString(),
        token: `token-${SnowflakeUtil.generate().toString()}`,
        type: InteractionType.ApplicationCommand,
        data: {
            id: SnowflakeUtil.generate().toString(),
            name,
            type: ApplicationCommandType.ChatInput,
            options,
            ...(resolved ? { resolved } : {}),
        },
        channel: interactionChannel(),
        channel_id: IDS.channel,
        member: apiMember(),
        ...overrides,
    };
}

export function autocompleteInteraction(
    name: string,
    options: APIApplicationCommandInteractionDataOption[],
    overrides: Partial<APIApplicationCommandAutocompleteGuildInteraction> = {},
): APIApplicationCommandAutocompleteGuildInteraction {
    return {
        ...interactionBase,
        id: SnowflakeUtil.generate().toString(),
        token: `token-${SnowflakeUtil.generate().toString()}`,
        type: InteractionType.ApplicationCommandAutocomplete,
        data: {
            id: SnowflakeUtil.generate().toString(),
            name,
            type: ApplicationCommandType.ChatInput,
            options,
        },
        channel: interactionChannel(),
        channel_id: IDS.channel,
        member: apiMember(),
        ...overrides,
    };
}

export function buttonInteraction(
    customId: string,
    message: APIMessage = apiMessage(),
    overrides: Partial<APIMessageComponentButtonInteraction> = {},
): APIMessageComponentButtonInteraction {
    const data: APIMessageButtonInteractionData = { custom_id: customId, component_type: ComponentType.Button };
    return {
        ...interactionBase,
        id: SnowflakeUtil.generate().toString(),
        token: `token-${SnowflakeUtil.generate().toString()}`,
        type: InteractionType.MessageComponent,
        data,
        message,
        channel: interactionChannel(),
        channel_id: IDS.channel,
        member: apiMember(),
        ...overrides,
    };
}

function selectInteraction(
    data: APIMessageSelectMenuInteractionData,
    message: APIMessage,
    overrides: Partial<APIMessageComponentSelectMenuInteraction>,
): APIMessageComponentSelectMenuInteraction {
    return {
        ...interactionBase,
        id: SnowflakeUtil.generate().toString(),
        token: `token-${SnowflakeUtil.generate().toString()}`,
        type: InteractionType.MessageComponent,
        data,
        message,
        channel: interactionChannel(),
        channel_id: IDS.channel,
        member: apiMember(),
        ...overrides,
    };
}

export function apiResolvedChannel(
    overrides: Partial<APIInteractionDataResolvedChannel> = {},
): APIInteractionDataResolvedChannel {
    return { id: IDS.channel, name: NAMES.channel, type: ChannelType.GuildText, permissions: "0", ...overrides };
}

export function channelSelectInteraction(
    customId: string,
    channelIds: string[],
    message: APIMessage = apiMessage(),
    overrides: Partial<APIMessageComponentSelectMenuInteraction> = {},
): APIMessageComponentSelectMenuInteraction {
    const channels = Object.fromEntries(channelIds.map((id) => [id, apiResolvedChannel({ id, name: "channel" })]));
    return selectInteraction(
        {
            custom_id: customId,
            component_type: ComponentType.ChannelSelect,
            values: channelIds,
            resolved: { channels },
        },
        message,
        overrides,
    );
}

export function roleSelectInteraction(
    customId: string,
    roleIds: string[],
    message: APIMessage = apiMessage(),
    overrides: Partial<APIMessageComponentSelectMenuInteraction> = {},
): APIMessageComponentSelectMenuInteraction {
    const roles = Object.fromEntries(roleIds.map((id) => [id, apiRole({ id })]));
    return selectInteraction(
        { custom_id: customId, component_type: ComponentType.RoleSelect, values: roleIds, resolved: { roles } },
        message,
        overrides,
    );
}

export function stringSelectInteraction(
    customId: string,
    values: string[],
    message: APIMessage = apiMessage(),
    overrides: Partial<APIMessageComponentSelectMenuInteraction> = {},
): APIMessageComponentSelectMenuInteraction {
    return selectInteraction(
        { custom_id: customId, component_type: ComponentType.StringSelect, values },
        message,
        overrides,
    );
}

export function modalSubmitInteraction(
    customId: string,
    fields: Record<string, string>,
    overrides: Partial<APIModalSubmitGuildInteraction> = {},
): APIModalSubmitGuildInteraction {
    return {
        ...interactionBase,
        id: SnowflakeUtil.generate().toString(),
        token: `token-${SnowflakeUtil.generate().toString()}`,
        type: InteractionType.ModalSubmit,
        data: {
            custom_id: customId,
            components: Object.entries(fields).map(([fieldId, value]) => ({
                type: ComponentType.Label,
                component: { type: ComponentType.TextInput, custom_id: fieldId, value },
            })),
        },
        channel: interactionChannel(),
        channel_id: IDS.channel,
        member: apiMember(),
        ...overrides,
    };
}

export function apiMessage(overrides: Partial<APIMessage> = {}): APIMessage {
    return {
        id: SnowflakeUtil.generate().toString(),
        channel_id: IDS.channel,
        author: apiUser({ id: IDS.bot, username: "BustinBot", bot: true }),
        content: "",
        timestamp: EPOCH,
        edited_timestamp: null,
        tts: false,
        mention_everyone: false,
        mentions: [],
        mention_roles: [],
        attachments: [],
        embeds: [],
        pinned: false,
        type: MessageType.Default,
        ...overrides,
    };
}

export function messageCreate(
    content: string,
    overrides: Partial<GatewayMessageCreateDispatchData> = {},
): GatewayMessageCreateDispatchData {
    const { user: _user, permissions: _permissions, ...member } = apiMember();
    return {
        ...apiMessage({ content, author: apiUser() }),
        guild_id: IDS.guild,
        member,
        mentions: [],
        ...overrides,
    };
}

export function apiAttachment(overrides: Partial<APIAttachment> = {}): APIAttachment {
    const id = overrides.id ?? SnowflakeUtil.generate().toString();
    const filename = overrides.filename ?? "screenshot.png";
    const url = `https://cdn.discordapp.com/attachments/${IDS.channel}/${id}/${filename}`;
    return {
        id,
        filename,
        size: 8,
        url,
        proxy_url: url.replace("cdn.discordapp.com", "media.discordapp.net"),
        content_type: "image/png",
        ...overrides,
    };
}

export function directMessage(
    content: string,
    overrides: Partial<GatewayMessageCreateDispatchData> = {},
): GatewayMessageCreateDispatchData {
    return {
        ...apiMessage({ content, author: apiUser(), channel_id: IDS.dm }),
        channel_type: ChannelType.DM,
        mentions: [],
        ...overrides,
    };
}
