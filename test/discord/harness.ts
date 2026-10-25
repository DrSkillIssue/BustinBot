import assert from "node:assert";
import { on, once } from "node:events";
import { vi } from "vitest";
import { Collection } from "@discordjs/collection";
import { Client, Events, type Interaction, type Message, type VoiceState, SnowflakeUtil } from "discord.js";
import {
    WebSocketShardEvents,
    WebSocketShardStatus,
    type IShardingStrategy,
    type WebSocketManager,
} from "@discordjs/ws";
import {
    ApplicationFlags,
    ChannelType,
    ComponentType,
    GatewayDispatchEvents,
    GatewayOpcodes,
    InteractionResponseType,
    MessageFlags,
    RESTJSONErrorCodes,
    type APIAttachment,
    type APIChannel,
    type APIDMChannel,
    type APIGuild,
    type APIGatewayBotInfo,
    type APIGuildMember,
    type APIRole,
    type APIUser,
    type APIInteraction,
    type APIMessage,
    type APIInteractionResponseCallbackData,
    type APIModalInteractionResponseCallbackData,
    type GatewayChannelCreateDispatchData,
    type GatewayVoiceStateUpdateDispatchData,
    type GatewayDispatchPayload,
    type GatewayGuildCreateDispatchData,
    type GatewayMessageCreateDispatchData,
    type GatewayReadyDispatchData,
    type RESTPostAPIInteractionCallbackJSONBody,
    type RESTPostAPIInteractionCallbackWithResponseResult,
    type RESTPutAPIApplicationGuildCommandsJSONBody,
    type RESTPostAPIChannelMessageJSONBody,
    type RESTPatchAPIWebhookWithTokenMessageJSONBody,
} from "discord-api-types/v10";
import type { Interceptable, MockAgent } from "undici";
import type { MockInterceptor } from "undici/types/mock-interceptor.js";
import { clientOptions } from "../../src/clientOptions.js";
import { IDS, apiGuild, apiMessage, apiUser } from "./payloads.js";

const API = "/api/v10";
export const DiscordError = {
    unknownChannel: { status: 404, body: { code: RESTJSONErrorCodes.UnknownChannel, message: "Unknown Channel" } },
    unknownMessage: { status: 404, body: { code: RESTJSONErrorCodes.UnknownMessage, message: "Unknown Message" } },
    missingAccess: { status: 403, body: { code: RESTJSONErrorCodes.MissingAccess, message: "Missing Access" } },
    missingPermissions: {
        status: 403,
        body: { code: RESTJSONErrorCodes.MissingPermissions, message: "Missing Permissions" },
    },
    cannotMessageUser: {
        status: 403,
        body: { code: RESTJSONErrorCodes.CannotSendMessagesToThisUser, message: "Cannot send messages to this user" },
    },
} as const;

export const PRIVATE_DEFERRAL = {
    type: InteractionResponseType.DeferredChannelMessageWithSource,
    data: { flags: MessageFlags.Ephemeral },
};

export interface ComponentSeen {
    customId: string;
    label?: string | undefined;
    placeholder?: string | undefined;
    options?: { label: string; value: string }[];
    disabled: boolean;
}

export function componentsIn(
    rows:
        | RESTPatchAPIWebhookWithTokenMessageJSONBody["components"]
        | APIInteractionResponseCallbackData["components"],
): ComponentSeen[] {
    const seen: ComponentSeen[] = [];
    for (const row of rows ?? []) {
        if (row.type !== ComponentType.ActionRow) continue;
        for (const component of row.components) {
            switch (component.type) {
                case ComponentType.Button:
                    if ("custom_id" in component) {
                        seen.push({
                            customId: component.custom_id,
                            label: component.label,
                            disabled: component.disabled ?? false,
                        });
                    }
                    break;
                case ComponentType.StringSelect:
                    seen.push({
                        customId: component.custom_id,
                        placeholder: component.placeholder,
                        options: component.options.map(({ label, value }) => ({ label, value })),
                        disabled: component.disabled ?? false,
                    });
                    break;
                case ComponentType.UserSelect:
                case ComponentType.RoleSelect:
                case ComponentType.MentionableSelect:
                case ComponentType.ChannelSelect:
                    seen.push({
                        customId: component.custom_id,
                        placeholder: component.placeholder,
                        disabled: component.disabled ?? false,
                    });
                    break;
            }
        }
    }
    return seen;
}

function commandsPath(guildId?: string): string {
    return guildId
        ? `/applications/${IDS.application}/guilds/${guildId}/commands`
        : `/applications/${IDS.application}/commands`;
}

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const JSON_RESPONSE: MockInterceptor.MockResponseOptions = { headers: { "content-type": "application/json" } };

function parseBody(body: unknown): unknown {
    if (typeof body === "string") return body ? JSON.parse(body) : undefined;
    const entries: [string, unknown][] | null =
        body instanceof FormData
            ? [...body.entries()]
            : Array.isArray(body) && body.every((entry) => Array.isArray(entry) && typeof entry[0] === "string")
              ? body
              : null;
    if (!entries) return undefined;
    const payload = entries.find(([name]) => name === "payload_json")?.[1];
    const files = entries
        .filter(([name]) => name.startsWith("files["))
        .map(([, file]) => (file instanceof File ? file.name : String(file)));
    return { ...(typeof payload === "string" ? JSON.parse(payload) : {}), files };
}

function toDiscordRequest(method: string, path: string, body: unknown): DiscordRequest {
    return {
        method,
        path: decodeURIComponent(path.split("?")[0] ?? "").replace(API, ""),
        body: parseBody(body),
    };
}

function startingWith(prefix: string): RegExp {
    return new RegExp(`^${RegExp.escape(prefix)}`);
}

export type SentMessage = RESTPostAPIChannelMessageJSONBody & { files?: string[] };

export interface DiscordRequest {
    method: string;
    path: string;
    body: unknown;
}

class TestGateway implements IShardingStrategy {
    private sequence = 0;

    constructor(
        private readonly manager: WebSocketManager,
        private readonly guild: GatewayGuildCreateDispatchData,
    ) {}

    connect(): void {
        const ready: GatewayReadyDispatchData = {
            v: 10,
            user: apiUser({ id: IDS.bot, username: "BustinBot", bot: true }),
            guilds: [{ id: this.guild.id, unavailable: true }],
            session_id: "session",
            resume_gateway_url: "wss://gateway.discord.gg",
            application: {
                id: IDS.application,
                flags: ApplicationFlags.ApplicationCommandBadge,
                flags_new: String(ApplicationFlags.ApplicationCommandBadge),
            },
        };
        this.manager.emit(WebSocketShardEvents.Ready, { data: ready, shardId: 0 });
        this.dispatch({ op: GatewayOpcodes.Dispatch, t: GatewayDispatchEvents.Ready, s: 0, d: ready });
        this.dispatch({ op: GatewayOpcodes.Dispatch, t: GatewayDispatchEvents.GuildCreate, s: 0, d: this.guild });
    }

    dispatch(payload: GatewayDispatchPayload): void {
        this.sequence += 1;
        this.manager.emit(WebSocketShardEvents.Dispatch, { data: { ...payload, s: this.sequence }, shardId: 0 });
    }

    spawn(): void {}

    destroy(): void {}

    send(): void {}

    fetchStatus(): Collection<number, WebSocketShardStatus> {
        return new Collection([[0, WebSocketShardStatus.Ready]]);
    }
}

export class DiscordHarness {
    readonly api: Interceptable;
    private gateway: TestGateway | undefined;

    private constructor(
        readonly client: Client,
        private readonly http: MockAgent,
        private readonly guildPayload: GatewayGuildCreateDispatchData,
    ) {
        this.api = http.get("https://discord.com");
    }

    static async start(http: MockAgent, guild: GatewayGuildCreateDispatchData = apiGuild()): Promise<DiscordHarness> {
        const harness = DiscordHarness.create(http, guild);
        await harness.connect();
        return harness;
    }

    static create(http: MockAgent, guild: GatewayGuildCreateDispatchData = apiGuild()): DiscordHarness {
        let harness: DiscordHarness | undefined;
        const client = new Client({
            ...clientOptions,
            ws: {
                buildStrategy: (manager) => {
                    const gateway = new TestGateway(manager, guild);
                    if (harness) harness.gateway = gateway;
                    return gateway;
                },
            },
        });
        harness = new DiscordHarness(client, http, guild);
        return harness;
    }

    async connect(): Promise<void> {
        const gatewayBot: APIGatewayBotInfo = {
            url: "wss://gateway.discord.gg",
            shards: 1,
            session_start_limit: { total: 1000, remaining: 1000, reset_after: 0, max_concurrency: 1 },
        };
        this.api.intercept({ path: `${API}/gateway/bot`, method: "GET" }).reply(200, gatewayBot, JSON_RESPONSE);

        const ready = once(this.client, Events.ClientReady);
        await this.client.login("test-token");
        await ready;
        this.http.clearCallHistory();
    }

    async addGuild(guild: GatewayGuildCreateDispatchData): Promise<void> {
        const created = once(this.client, Events.GuildCreate);
        this.send({ op: GatewayOpcodes.Dispatch, t: GatewayDispatchEvents.GuildCreate, s: 0, d: guild });
        await created;
    }

    async addRole(guildId: string, role: APIRole): Promise<void> {
        const created = once(this.client, Events.GuildRoleCreate);
        this.send({
            op: GatewayOpcodes.Dispatch,
            t: GatewayDispatchEvents.GuildRoleCreate,
            s: 0,
            d: { guild_id: guildId, role },
        });
        await created;
    }

    refuse(
        method: string,
        path: string,
        error: (typeof DiscordError)[keyof typeof DiscordError],
        { persist = false } = {},
    ): void {
        const route = this.api
            .intercept({ path: `${API}${path}`, method })
            .reply(() => ({ statusCode: error.status, data: error.body, responseOptions: JSON_RESPONSE }));
        if (persist) route.persist();
    }

    channel(channel: APIChannel): void {
        this.api
            .intercept({ path: `${API}/channels/${channel.id}`, method: "GET" })
            .reply(() => ({ statusCode: 200, data: channel, responseOptions: JSON_RESPONSE }))
            .persist();
    }

    async addChannel(channel: GatewayChannelCreateDispatchData): Promise<void> {
        const created = once(this.client, Events.ChannelCreate);
        this.send({ op: GatewayOpcodes.Dispatch, t: GatewayDispatchEvents.ChannelCreate, s: 0, d: channel });
        await created;
    }

    async voiceStateUpdate(state: GatewayVoiceStateUpdateDispatchData): Promise<[VoiceState, VoiceState]> {
        const updated = once(this.client, Events.VoiceStateUpdate);
        this.send({ op: GatewayOpcodes.Dispatch, t: GatewayDispatchEvents.VoiceStateUpdate, s: 0, d: state });
        const [oldState, newState] = await updated;
        return [oldState, newState];
    }

    async dispatch(payload: APIInteraction): Promise<Interaction> {
        this.api
            .intercept({
                path: startingWith(`${API}/interactions/${payload.id}/${payload.token}/callback`),
                method: "POST",
            })
            .reply(({ path, body }) => {
                if (!new URL(path, "https://discord.com").searchParams.has("with_response")) {
                    return { statusCode: 204 };
                }
                const callback = parseBody(body) as RESTPostAPIInteractionCallbackJSONBody;
                const { type } = callback;
                const response: RESTPostAPIInteractionCallbackWithResponseResult = {
                    interaction: {
                        id: payload.id,
                        type: payload.type,
                        response_message_loading: false,
                        response_message_ephemeral: false,
                    },
                };
                return {
                    statusCode: 200,
                    data: type === InteractionResponseType.Modal ? response : { ...response, resource: { type } },
                    responseOptions: JSON_RESPONSE,
                };
            });
        const webhook = `${API}/webhooks/${IDS.application}/${payload.token}`;
        this.api
            .intercept({ path: startingWith(`${webhook}/messages/`), method: "PATCH" })
            .reply(({ body }) => ({
                statusCode: 200,
                data: this.messageFrom(body),
                responseOptions: JSON_RESPONSE,
            }))
            .persist();
        this.api
            .intercept({ path: new RegExp(`${startingWith(webhook).source}(\\?|$)`), method: "POST" })
            .reply(({ body }) => ({
                statusCode: 200,
                data: this.messageFrom(body),
                responseOptions: JSON_RESPONSE,
            }))
            .persist();

        const created = on(this.client, Events.InteractionCreate);
        this.send({ op: GatewayOpcodes.Dispatch, t: GatewayDispatchEvents.InteractionCreate, s: 0, d: payload });
        for await (const [interaction] of created) {
            if (interaction.id === payload.id) return interaction;
        }
        throw new Error(`Interaction ${payload.id} was never created.`);
    }

    async sendMessage(payload: GatewayMessageCreateDispatchData): Promise<Message> {
        const created = on(this.client, Events.MessageCreate);
        this.send({ op: GatewayOpcodes.Dispatch, t: GatewayDispatchEvents.MessageCreate, s: 0, d: payload });
        for await (const [message] of created) {
            if (message.id === payload.id) return message;
        }
        throw new Error(`Message ${payload.id} was never created.`);
    }

    acceptMessages(channelId: string): void {
        this.api
            .intercept({ path: `${API}/channels/${channelId}/messages`, method: "POST" })
            .reply(({ body }) => ({
                statusCode: 200,
                data: this.messageFrom(body, { channel_id: channelId }),
                responseOptions: JSON_RESPONSE,
            }))
            .persist();
    }

    acceptMessageEdits(channelId: string): void {
        this.api
            .intercept({ path: startingWith(`${API}/channels/${channelId}/messages/`), method: "PATCH" })
            .reply(({ path, body }) => {
                const [, messageId] = /\/messages\/(\d+)/.exec(path) ?? [];
                assert(messageId);
                return {
                    statusCode: 200,
                    data: this.messageFrom(body, { id: messageId, channel_id: channelId }),
                    responseOptions: JSON_RESPONSE,
                };
            })
            .persist();
    }

    message(message: APIMessage): void {
        this.api
            .intercept({ path: `${API}/channels/${message.channel_id}/messages/${message.id}`, method: "GET" })
            .reply(() => ({ statusCode: 200, data: message, responseOptions: JSON_RESPONSE }))
            .persist();
    }

    acceptMessageDeletions(channelId: string): void {
        this.api
            .intercept({ path: startingWith(`${API}/channels/${channelId}/messages/`), method: "DELETE" })
            .reply(() => ({ statusCode: 204 }))
            .persist();
    }

    messageDeletions(channelId: string): string[] {
        const prefix = `/channels/${channelId}/messages/`;
        return this.requests()
            .filter((request) => request.method === "DELETE" && request.path.startsWith(prefix))
            .map((request) => request.path.slice(prefix.length));
    }

    messageEdits(channelId: string, messageId: string): SentMessage[] {
        return this.bodies("PATCH", `/channels/${channelId}/messages/${messageId}`);
    }

    acceptCommandSync(guildId?: string): void {
        this.api
            .intercept({ path: `${API}${commandsPath(guildId)}`, method: "PUT" })
            .reply(({ body }) => {
                const commands = parseBody(body) as RESTPutAPIApplicationGuildCommandsJSONBody;
                const stored = commands.map((command) => ({
                    ...command,
                    id: SnowflakeUtil.generate().toString(),
                    application_id: IDS.application,
                    ...(guildId ? { guild_id: guildId } : {}),
                    version: SnowflakeUtil.generate().toString(),
                }));
                return { statusCode: 200, data: stored, responseOptions: JSON_RESPONSE };
            })
            .persist();
    }

    acceptDirectMessages(user: APIUser): string {
        this.user(user);
        const dmChannelId = this.openDirectMessages(user);
        this.acceptMessages(dmChannelId);
        return dmChannelId;
    }

    serveAttachment(attachment: APIAttachment, contents: Uint8Array = PNG): void {
        const { origin, pathname } = new URL(attachment.url);
        this.http
            .get(origin)
            .intercept({ path: startingWith(pathname), method: "GET" })
            .reply(200, Buffer.from(contents), {
                headers: { "content-type": attachment.content_type ?? "application/octet-stream" },
            })
            .persist();
    }

    guild(guild: APIGuild): void {
        this.api
            .intercept({ path: startingWith(`${API}/guilds/${guild.id}?`), method: "GET" })
            .reply(() => ({ statusCode: 200, data: guild, responseOptions: JSON_RESPONSE }))
            .persist();
    }

    guildChannels(guildId: string, channels: APIChannel[]): void {
        this.api
            .intercept({ path: `${API}/guilds/${guildId}/channels`, method: "GET" })
            .reply(() => ({ statusCode: 200, data: channels, responseOptions: JSON_RESPONSE }))
            .persist();
    }

    refuseDirectMessages(user: APIUser): void {
        this.user(user);
        const dmChannelId = this.openDirectMessages(user);
        this.refuse("POST", `/channels/${dmChannelId}/messages`, DiscordError.cannotMessageUser, { persist: true });
    }

    guildRoles(extra: APIRole[] = []): void {
        this.api
            .intercept({ path: `${API}/guilds/${this.guildPayload.id}/roles`, method: "GET" })
            .reply(() => ({
                statusCode: 200,
                data: [...this.guildPayload.roles, ...extra],
                responseOptions: JSON_RESPONSE,
            }))
            .persist();
    }

    roleCreated(guildId: string, role: APIRole): void {
        this.api
            .intercept({ path: `${API}/guilds/${guildId}/roles`, method: "POST" })
            .reply(() => ({ statusCode: 200, data: role, responseOptions: JSON_RESPONSE }));
    }

    rolesCreated(guildId: string): Partial<APIRole>[] {
        return this.bodies("POST", `/guilds/${guildId}/roles`);
    }

    roleEdited(guildId: string, role: APIRole): void {
        this.api
            .intercept({ path: `${API}/guilds/${guildId}/roles/${role.id}`, method: "PATCH" })
            .reply(() => ({ statusCode: 200, data: role, responseOptions: JSON_RESPONSE }));
    }

    roleDeleted(guildId: string, roleId: string): void {
        this.api
            .intercept({ path: `${API}/guilds/${guildId}/roles/${roleId}`, method: "DELETE" })
            .reply(() => ({ statusCode: 204 }));
    }

    user(user: APIUser): void {
        this.api
            .intercept({ path: `${API}/users/${user.id}`, method: "GET" })
            .reply(() => ({ statusCode: 200, data: user, responseOptions: JSON_RESPONSE }))
            .persist();
    }

    member(guildId: string, member: APIGuildMember): void {
        this.api
            .intercept({ path: `${API}/guilds/${guildId}/members/${member.user.id}`, method: "GET" })
            .reply(() => ({ statusCode: 200, data: member, responseOptions: JSON_RESPONSE }))
            .persist();
        for (const method of ["PUT", "DELETE"]) {
            this.api
                .intercept({ path: startingWith(`${API}/guilds/${guildId}/members/${member.user.id}/roles/`), method })
                .reply(() => ({ statusCode: 204 }))
                .persist();
        }
    }

    memberRoleChanges(method: "PUT" | "DELETE"): string[] {
        const prefix = /^\/guilds\/\d+\/members\/(\d+)\/roles\/(\d+)$/;
        return this.requests()
            .filter((request) => request.method === method)
            .flatMap((request) => {
                const match = prefix.exec(request.path);
                return match ? [`${match[1]}:${match[2]}`] : [];
            });
    }

    requests(): DiscordRequest[] {
        return (this.http.getCallHistory()?.calls() ?? [])
            .filter((call) => call.origin === "https://discord.com")
            .map((call) => toDiscordRequest(call.method, call.path, call.body));
    }

    request(method: string, path: string): Promise<DiscordRequest> {
        return vi.waitFor(() => {
            const request = this.requests().find((seen) => seen.method === method && seen.path === path);
            assert(request, `No ${method} ${path} yet`);
            return request;
        });
    }

    async originalEdit(interaction: Interaction): Promise<RESTPatchAPIWebhookWithTokenMessageJSONBody> {
        const { body } = await this.request(
            "PATCH",
            `/webhooks/${IDS.application}/${interaction.token}/messages/@original`,
        );
        return body as RESTPatchAPIWebhookWithTokenMessageJSONBody;
    }

    callbacks(interaction: Interaction): RESTPostAPIInteractionCallbackJSONBody[] {
        return this.bodies("POST", `/interactions/${interaction.id}/${interaction.token}/callback`);
    }

    reply(interaction: Interaction): APIInteractionResponseCallbackData | undefined {
        const response = this.callbacks(interaction).find(
            (callback) => callback.type === InteractionResponseType.ChannelMessageWithSource,
        );
        return response?.type === InteractionResponseType.ChannelMessageWithSource ? response.data : undefined;
    }

    modal(interaction: Interaction): APIModalInteractionResponseCallbackData | undefined {
        const response = this.callbacks(interaction).find(
            (callback) => callback.type === InteractionResponseType.Modal,
        );
        return response?.type === InteractionResponseType.Modal ? response.data : undefined;
    }

    originalEdits(interaction: Interaction): RESTPatchAPIWebhookWithTokenMessageJSONBody[] {
        return this.bodies("PATCH", `/webhooks/${IDS.application}/${interaction.token}/messages/@original`);
    }

    followUps(interaction: Interaction): SentMessage[] {
        return this.bodies("POST", `/webhooks/${IDS.application}/${interaction.token}`);
    }

    commandUpdates(guildId?: string): RESTPutAPIApplicationGuildCommandsJSONBody[] {
        return this.bodies("PUT", commandsPath(guildId));
    }

    messagesSentTo(channelId: string): SentMessage[] {
        return this.bodies("POST", `/channels/${channelId}/messages`);
    }

    destroy(): Promise<void> {
        return this.client.destroy();
    }

    private bodies<Body>(method: string, path: string): Body[] {
        return this.requests()
            .filter((request) => request.method === method && request.path === path)
            .map((request) => request.body as Body);
    }

    private openDirectMessages(user: APIUser): string {
        const dmChannelId = SnowflakeUtil.generate().toString();
        const dm: APIDMChannel = {
            id: dmChannelId,
            type: ChannelType.DM,
            name: null,
            last_message_id: null,
            recipients: [user],
        };
        this.api
            .intercept({
                path: `${API}/users/@me/channels`,
                method: "POST",
                body: (body) => {
                    const request = JSON.parse(body) as { recipient_id?: string };
                    return request.recipient_id === user.id;
                },
            })
            .reply(() => ({ statusCode: 200, data: dm, responseOptions: JSON_RESPONSE }))
            .persist();
        return dmChannelId;
    }

    private send(payload: GatewayDispatchPayload): void {
        if (!this.gateway) throw new Error("The client has not connected to the gateway yet.");
        this.gateway.dispatch(payload);
    }

    private messageFrom(body: unknown, overrides: Partial<APIMessage> = {}): APIMessage {
        const sent = parseBody(body) as Partial<APIMessage>;
        const { content, embeds, components } = sent;
        return apiMessage({ content: content ?? "", embeds: embeds ?? [], components: components ?? [], ...overrides });
    }
}
