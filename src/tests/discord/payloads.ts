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
    type APIChatInputApplicationCommandGuildInteraction,
    type APIGuildTextChannel,
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
    channel: "100000000000000020",
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
let sequence = 0;

// Unique, increasing snowflake-shaped ids so separate payloads never collide
export function nextId(): string {
    sequence += 1;
    return (200000000000000000n + BigInt(sequence)).toString();
}

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
        id: nextId(),
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
    overrides: Partial<APIGuildTextChannel<ChannelType.GuildText>> = {}
): APIGuildTextChannel<ChannelType.GuildText> {
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

// The payload of a GUILD_CREATE gateway event; the @everyone role shares the guild's id
export function apiGuild(overrides: Partial<GatewayGuildCreateDispatchData> = {}): GatewayGuildCreateDispatchData {
    const id = overrides.id ?? IDS.guild;
    return {
        id,
        name: "Test Guild",
        icon: null,
        splash: null,
        discovery_splash: null,
        owner_id: IDS.user,
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

export function apiMember(overrides: Partial<APIInteractionGuildMember> = {}): APIInteractionGuildMember {
    return {
        user: apiUser(),
        roles: [],
        joined_at: EPOCH,
        deaf: false,
        mute: false,
        flags: NO_MEMBER_FLAGS,
        permissions: "0",
        avatar: null,
        banner: null,
        ...overrides,
    };
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

export function chatInputInteraction(
    name: string,
    options: APIApplicationCommandInteractionDataOption[] = [],
    overrides: Partial<APIChatInputApplicationCommandGuildInteraction> = {}
): APIChatInputApplicationCommandGuildInteraction {
    return {
        ...interactionBase,
        id: nextId(),
        token: `token-${nextId()}`,
        type: InteractionType.ApplicationCommand,
        data: { id: nextId(), name, type: ApplicationCommandType.ChatInput, options },
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
        id: nextId(),
        token: `token-${nextId()}`,
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
        id: nextId(),
        token: `token-${nextId()}`,
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
        id: nextId(),
        token: `token-${nextId()}`,
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
        id: nextId(),
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
