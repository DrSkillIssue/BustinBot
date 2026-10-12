import { SnowflakeUtil } from "discord.js";
import {
    ApplicationCommandType,
    ChannelType,
    ComponentType,
    GuildDefaultMessageNotifications,
    GuildExplicitContentFilter,
    GuildHubType,
    GuildMemberFlags,
    GuildMFALevel,
    GuildNSFWLevel,
    GuildPremiumTier,
    GuildSystemChannelFlags,
    GuildVerificationLevel,
    InteractionContextType,
    InteractionType,
    Locale,
    MessageType,
    RoleFlags,
    type APIApplicationCommandInteractionDataOption,
    type APIAttachment,
    type APIChatInputApplicationCommandGuildInteraction,
    type APIGuildMember,
    type APIGuildTextChannel,
    type APIGuildVoiceChannel,
    type APIVoiceState,
    type APIInteractionDataResolved,
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

// Raw Discord API payloads, shaped exactly as Discord sends them. Tests override only what they care about.

export const IDS = {
    application: "100000000000000001",
    bot: "100000000000000002",
    guild: "100000000000000010",
    // A second guild the bot is in, with its own channel, for tests that show guilds are kept apart
    otherGuild: "100000000000000011",
    otherGuildChannel: "100000000000000021",
    // A guild discord.js hasn't cached: its interactions carry members as raw data, with role ids only
    uncachedGuild: "100000000000000012",
    channel: "100000000000000020",
    // A channel that was deleted, or that the bot can't see
    missingChannel: "100000000000000099",
    // The guild's owner, so that the default user is an ordinary member
    owner: "100000000000000029",
    // The harness user's DM channel with the bot
    dm: "100000000000000050",
    user: "100000000000000030",
    roles: {
        admin: "100000000000000041",
        taskAdmin: "100000000000000042",
        movieAdmin: "100000000000000043",
    },
} as const;

const EPOCH = "2026-01-01T00:00:00.000Z";
// Discord flag fields are bitfields; zero means no flags are set
const NO_ROLE_FLAGS = 0 as RoleFlags;
const NO_MEMBER_FLAGS = 0 as GuildMemberFlags;


export function apiUser(overrides: Partial<APIUser> = {}): APIUser {
    return {
        id: IDS.user,
        username: "tester",
        discriminator: "0",
        global_name: "Tester",
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

// A guild text channel, as the gateway and REST API send one: with the id of its guild
export function apiTextChannel(
    overrides: Partial<APIGuildTextChannel<ChannelType.GuildText>> = {}
): APIGuildTextChannel<ChannelType.GuildText> & { guild_id: string } {
    return {
        id: IDS.channel,
        type: ChannelType.GuildText,
        guild_id: IDS.guild,
        name: "general",
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

// A guild voice channel, as the gateway and REST API send one
export function apiVoiceChannel(overrides: Partial<APIGuildVoiceChannel> = {}): APIGuildVoiceChannel & { guild_id: string } {
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

// A member's voice connection: in a voice channel, or (channel_id null) in none
export function apiVoiceState(userId: string, channelId: string | null, overrides: Partial<APIVoiceState> = {}): APIVoiceState & { guild_id: string } {
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

// The payload of a GUILD_CREATE gateway event; the @everyone role shares the guild's id
export function apiGuild(overrides: Partial<GatewayGuildCreateDispatchData> = {}): GatewayGuildCreateDispatchData {
    const id = overrides.id ?? IDS.guild;
    return {
        id,
        name: "Test Guild",
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
            apiRole({ id: IDS.roles.admin, name: "BustinBot Admin" }),
            apiRole({ id: IDS.roles.taskAdmin, name: "Task Admin" }),
            apiRole({ id: IDS.roles.movieAdmin, name: "Movie Admin" }),
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
        hub_type: null as GuildHubType | null,
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

// A guild member as the REST API returns one
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

// The member who invoked an interaction, which also carries their permissions in the channel
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
    return { id: IDS.channel, type: ChannelType.GuildText as const, guild_id: IDS.guild, name: "general" };
}

// `resolved` carries the users, members and roles that user and role options refer to
export function chatInputInteraction(
    name: string,
    options: APIApplicationCommandInteractionDataOption[] = [],
    overrides: Partial<APIChatInputApplicationCommandGuildInteraction> = {},
    resolved?: APIInteractionDataResolved
): APIChatInputApplicationCommandGuildInteraction {
    return {
        ...interactionBase,
        id: SnowflakeUtil.generate().toString(),
        token: `token-${SnowflakeUtil.generate().toString()}`,
        type: InteractionType.ApplicationCommand,
        data: { id: SnowflakeUtil.generate().toString(), name, type: ApplicationCommandType.ChatInput, options, ...(resolved ? { resolved } : {}) },
        channel: interactionChannel(),
        channel_id: IDS.channel,
        member: apiMember(),
        ...overrides,
    };
}

export function buttonInteraction(
    customId: string,
    message: APIMessage = apiMessage(),
    overrides: Partial<APIMessageComponentButtonInteraction> = {}
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
    overrides: Partial<APIMessageComponentSelectMenuInteraction>
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

export function channelSelectInteraction(
    customId: string,
    channelIds: string[],
    message: APIMessage = apiMessage(),
    overrides: Partial<APIMessageComponentSelectMenuInteraction> = {}
): APIMessageComponentSelectMenuInteraction {
    const channels = Object.fromEntries(channelIds.map((id) => [id, { id, name: "channel", type: ChannelType.GuildText, permissions: "0" }]));
    return selectInteraction({ custom_id: customId, component_type: ComponentType.ChannelSelect, values: channelIds, resolved: { channels } }, message, overrides);
}

export function roleSelectInteraction(
    customId: string,
    roleIds: string[],
    message: APIMessage = apiMessage(),
    overrides: Partial<APIMessageComponentSelectMenuInteraction> = {}
): APIMessageComponentSelectMenuInteraction {
    const roles = Object.fromEntries(roleIds.map((id) => [id, apiRole({ id })]));
    return selectInteraction({ custom_id: customId, component_type: ComponentType.RoleSelect, values: roleIds, resolved: { roles } }, message, overrides);
}

export function stringSelectInteraction(
    customId: string,
    values: string[],
    message: APIMessage = apiMessage(),
    overrides: Partial<APIMessageComponentSelectMenuInteraction> = {}
): APIMessageComponentSelectMenuInteraction {
    return selectInteraction({ custom_id: customId, component_type: ComponentType.StringSelect, values }, message, overrides);
}

export function modalSubmitInteraction(
    customId: string,
    fields: Record<string, string>,
    overrides: Partial<APIModalSubmitGuildInteraction> = {}
): APIModalSubmitGuildInteraction {
    return {
        ...interactionBase,
        id: SnowflakeUtil.generate().toString(),
        token: `token-${SnowflakeUtil.generate().toString()}`,
        type: InteractionType.ModalSubmit,
        data: {
            custom_id: customId,
            components: Object.entries(fields).map(([fieldId, value]) => ({
                type: ComponentType.ActionRow,
                components: [{ type: ComponentType.TextInput, custom_id: fieldId, value }],
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

// A member's message in the harness guild's channel, as delivered by the gateway's MESSAGE_CREATE event
export function messageCreate(content: string, overrides: Partial<GatewayMessageCreateDispatchData> = {}): GatewayMessageCreateDispatchData {
    const { user: _user, permissions: _permissions, ...member } = apiMember();
    return {
        ...apiMessage({ content, author: apiUser() }),
        guild_id: IDS.guild,
        member,
        mentions: [],
        ...overrides,
    };
}

// A file attached to a message, stored on Discord's CDN
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

// A member's message to the bot in their DMs, as delivered by the gateway's MESSAGE_CREATE event
export function directMessage(content: string, overrides: Partial<GatewayMessageCreateDispatchData> = {}): GatewayMessageCreateDispatchData {
    return {
        ...apiMessage({ content, author: apiUser(), channel_id: IDS.dm }),
        channel_type: ChannelType.DM,
        mentions: [],
        ...overrides,
    };
}
