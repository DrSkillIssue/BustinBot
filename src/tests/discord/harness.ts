import { EventEmitter, once } from "node:events";
import { Collection } from "@discordjs/collection";
import { Client, Events, GatewayIntentBits, type Interaction, type Message } from "discord.js";
import {
    WebSocketShardEvents,
    WebSocketShardStatus,
    type IShardingStrategy,
    type WebSocketManager,
} from "@discordjs/ws";
import {
    ApplicationFlags,
    ChannelType,
    GatewayDispatchEvents,
    GatewayOpcodes,
    InteractionResponseType,
    type APIDMChannel,
    type APIGatewayBotInfo,
    type APIGuildMember,
    type APIRole,
    type APIUser,
    type APIInteraction,
    type APIMessage,
    type APIModalInteractionResponseCallbackData,
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
import type { Interceptable } from "undici";
import type { MockInterceptor } from "undici/types/mock-interceptor.js";
import { mockAgent } from "../http.js";
import { IDS, apiGuild, apiMessage, apiUser, nextId } from "./payloads.js";

const API = "/api/v10";
const JSON_RESPONSE: MockInterceptor.MockResponseOptions = { headers: { "content-type": "application/json" } };

// A request body as Discord reads it. JSON bodies are parsed; multipart bodies (messages with attachments) carry
// their JSON in the payload_json field beside files[n], and are read as that JSON plus the attached file names.
// undici hands reply callbacks a multipart body's [name, value] entries and keeps the FormData in its call history.
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- parsed JSON, typed by the accessor that reads it
function parseBody(body: unknown): any {
    if (typeof body === "string") return body ? JSON.parse(body) : undefined;
    const entries: [string, unknown][] | null = body instanceof FormData
        ? [...body.entries()]
        : Array.isArray(body) && body.every((entry) => Array.isArray(entry) && typeof entry[0] === "string") ? body : null;
    if (!entries) return undefined;
    const payload = entries.find(([name]) => name === "payload_json")?.[1];
    const files = entries.filter(([name]) => name.startsWith("files[")).map(([, file]) => (file instanceof File ? file.name : String(file)));
    return { ...(typeof payload === "string" ? JSON.parse(payload) : {}), files };
}

function toDiscordRequest(method: string, path: string, body: unknown): DiscordRequest {
    return {
        method,
        path: decodeURIComponent(path.split("?")[0] ?? "").replace(API, ""),
        body: parseBody(body),
    };
}

// A route matcher for a path prefix, written as a regular expression so a failed expectation names the route
function startingWith(prefix: string): RegExp {
    return new RegExp(`^${prefix.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`);
}

// A Discord REST request with its route decoded (e.g. messages/@original) and its JSON body parsed
export interface DiscordRequest {
    method: string;
    path: string;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- parsed JSON, typed by the accessor that reads it
    body: any;
}

// Stands in for @discordjs/ws's sharding strategy, the documented extension point discord.js offers through
// `ws.buildStrategy` (the same seam @discordjs/ws's own tests use). Instead of opening sockets it emits gateway
// events on discord.js's WebSocketManager, which handles them exactly as it handles events from a real connection.
class TestGateway implements IShardingStrategy {
    private sequence = 0;

    constructor(private readonly manager: WebSocketManager, private readonly guild: GatewayGuildCreateDispatchData) {}

    // Discord answers IDENTIFY with READY, listing the bot's guilds as unavailable, then sends GUILD_CREATE for each
    connect(): void {
        const ready: GatewayReadyDispatchData = {
            v: 10,
            user: apiUser({ id: IDS.bot, username: "BustinBot", bot: true }),
            guilds: [{ id: this.guild.id, unavailable: true }],
            session_id: "session",
            resume_gateway_url: "wss://gateway.discord.gg",
            // BustinBot registers global slash commands, which Discord reports with this flag
            application: { id: IDS.application, flags: ApplicationFlags.ApplicationCommandBadge, flags_new: String(ApplicationFlags.ApplicationCommandBadge) },
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

// A real discord.js client that logs in through a test gateway, with Discord's REST API answered by the test's
// MockAgent. Each interaction gets the routes Discord provides for it; any other request a test expects the bot to
// make is declared on `api`, undici's interceptor for discord.com.
export class DiscordHarness {
    readonly api: Interceptable;
    private gateway: TestGateway | undefined;
    private readonly arrivals = new EventEmitter<{ request: [DiscordRequest] }>();

    private constructor(readonly client: Client) {
        this.api = mockAgent().get("https://discord.com");
    }

    // A client logged in to its guild, ready to receive events
    static async start(guild: GatewayGuildCreateDispatchData = apiGuild()): Promise<DiscordHarness> {
        const harness = DiscordHarness.create(guild);
        await harness.connect();
        return harness;
    }

    // A client that has not logged in yet, for wiring the bot's event handlers before READY arrives
    static create(guild: GatewayGuildCreateDispatchData = apiGuild()): DiscordHarness {
        let harness: DiscordHarness | undefined;
        const client = new Client({
            intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers, GatewayIntentBits.GuildMessages],
            ws: {
                buildStrategy: (manager) => {
                    const gateway = new TestGateway(manager, guild);
                    if (harness) harness.gateway = gateway;
                    return gateway;
                },
            },
        });
        harness = new DiscordHarness(client);
        return harness;
    }

    // Logs in the way the bot does: discord.js fetches the gateway address, connects, and becomes ready once the
    // guild has arrived
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
        // Only requests the bot makes from here on are of interest to tests
        mockAgent().clearCallHistory();
    }

    // The bot joining another guild after it is ready
    async addGuild(guild: GatewayGuildCreateDispatchData): Promise<void> {
        const created = once(this.client, Events.GuildCreate);
        this.send({ op: GatewayOpcodes.Dispatch, t: GatewayDispatchEvents.GuildCreate, s: 0, d: guild });
        await created;
    }

    // A role being created in a guild, as the gateway announces it, so discord.js has it cached
    async addRole(guildId: string, role: APIRole): Promise<void> {
        const created = once(this.client, Events.GuildRoleCreate);
        this.send({ op: GatewayOpcodes.Dispatch, t: GatewayDispatchEvents.GuildRoleCreate, s: 0, d: { guild_id: guildId, role } });
        await created;
    }

    // Delivers an interaction the way the gateway does and returns the discord.js object created for it.
    // Discord accepts exactly one initial response per interaction, so its callback route answers once: a second
    // response fails the request, and an interaction left unanswered fails the test.
    async dispatch(payload: APIInteraction): Promise<Interaction> {
        this.api
            .intercept({ path: startingWith(`${API}/interactions/${payload.id}/${payload.token}/callback`), method: "POST" })
            .reply(this.answered(({ path, body }) => {
                if (!new URL(path, "https://discord.com").searchParams.has("with_response")) {
                    return { statusCode: 204 };
                }
                const callback: RESTPostAPIInteractionCallbackJSONBody = parseBody(body);
                const { type } = callback;
                const response: RESTPostAPIInteractionCallbackWithResponseResult = {
                    interaction: { id: payload.id, type: payload.type, response_message_loading: false, response_message_ephemeral: false },
                };
                return { statusCode: 200, data: type === InteractionResponseType.Modal ? response : { ...response, resource: { type } }, responseOptions: JSON_RESPONSE };
            }));
        // Edits and follow-ups go to the interaction's webhook for as long as its token is valid
        const webhook = `${API}/webhooks/${IDS.application}/${payload.token}`;
        this.api
            .intercept({ path: startingWith(`${webhook}/messages/`), method: "PATCH" })
            .reply(this.answered(({ body }) => ({ statusCode: 200, data: this.messageFrom(body), responseOptions: JSON_RESPONSE })))
            .persist();
        this.api
            .intercept({ path: new RegExp(`${startingWith(webhook).source}(\\?|$)`), method: "POST" })
            .reply(this.answered(({ body }) => ({ statusCode: 200, data: this.messageFrom(body), responseOptions: JSON_RESPONSE })))
            .persist();

        const created = new Promise<Interaction>((resolve) => {
            const listener = (interaction: Interaction) => {
                if (interaction.id !== payload.id) return;
                this.client.off(Events.InteractionCreate, listener);
                resolve(interaction);
            };
            this.client.on(Events.InteractionCreate, listener);
        });
        this.send({ op: GatewayOpcodes.Dispatch, t: GatewayDispatchEvents.InteractionCreate, s: 0, d: payload });
        return created;
    }

    // Delivers a message the way the gateway does and returns the discord.js Message created for it
    async sendMessage(payload: GatewayMessageCreateDispatchData): Promise<Message> {
        const created = new Promise<Message>((resolve) => {
            const listener = (message: Message) => {
                if (message.id !== payload.id) return;
                this.client.off(Events.MessageCreate, listener);
                resolve(message);
            };
            this.client.on(Events.MessageCreate, listener);
        });
        this.send({ op: GatewayOpcodes.Dispatch, t: GatewayDispatchEvents.MessageCreate, s: 0, d: payload });
        return created;
    }

    // Discord accepting messages the bot posts in a channel, answering with the created message
    acceptMessages(channelId: string): void {
        this.api
            .intercept({ path: `${API}/channels/${channelId}/messages`, method: "POST" })
            .reply(this.answered(({ body }) => ({ statusCode: 200, data: this.messageFrom(body, { channel_id: channelId }), responseOptions: JSON_RESPONSE })))
            .persist();
    }

    // Discord accepting a bulk overwrite of a guild's slash commands, answering with the stored commands
    acceptCommandSync(guildId: string): void {
        this.api
            .intercept({ path: `${API}/applications/${IDS.application}/guilds/${guildId}/commands`, method: "PUT" })
            .reply(this.answered(({ body }) => {
                const commands: object[] = parseBody(body);
                const stored = commands.map((command) => ({ ...command, id: nextId(), application_id: IDS.application, guild_id: guildId, version: nextId() }));
                return { statusCode: 200, data: stored, responseOptions: JSON_RESPONSE };
            }))
            .persist();
    }

    // Discord opening a DM with a user and accepting messages in it; returns the DM channel's id
    acceptDirectMessages(userId: string): string {
        const dmChannelId = nextId();
        const dm: APIDMChannel = { id: dmChannelId, type: ChannelType.DM, name: null, last_message_id: null, recipients: [apiUser({ id: userId })] };
        this.api
            .intercept({
                path: `${API}/users/@me/channels`,
                method: "POST",
                body: (body) => {
                    const request: { recipient_id?: string } = JSON.parse(body);
                    return request.recipient_id === userId;
                },
            })
            .reply(this.answered(() => ({ statusCode: 200, data: dm, responseOptions: JSON_RESPONSE })))
            .persist();
        this.acceptMessages(dmChannelId);
        return dmChannelId;
    }

    // Discord listing a guild's roles
    guildRoles(guildId: string, roles: APIRole[]): void {
        this.api
            .intercept({ path: `${API}/guilds/${guildId}/roles`, method: "GET" })
            .reply(this.answered(() => ({ statusCode: 200, data: roles, responseOptions: JSON_RESPONSE })))
            .persist();
    }

    // Discord creating one role in a guild, answering with the role it made
    roleCreated(guildId: string, role: APIRole): void {
        this.api
            .intercept({ path: `${API}/guilds/${guildId}/roles`, method: "POST" })
            .reply(this.answered(() => ({ statusCode: 200, data: role, responseOptions: JSON_RESPONSE })));
    }

    // Discord editing one role, answering with the role as it now is
    roleEdited(guildId: string, role: APIRole): void {
        this.api
            .intercept({ path: `${API}/guilds/${guildId}/roles/${role.id}`, method: "PATCH" })
            .reply(this.answered(() => ({ statusCode: 200, data: role, responseOptions: JSON_RESPONSE })));
    }

    // Discord deleting one role
    roleDeleted(guildId: string, roleId: string): void {
        this.api
            .intercept({ path: `${API}/guilds/${guildId}/roles/${roleId}`, method: "DELETE" })
            .reply(this.answered(() => ({ statusCode: 204 })));
    }

    // A user Discord knows about
    user(user: APIUser): void {
        this.api
            .intercept({ path: `${API}/users/${user.id}`, method: "GET" })
            .reply(this.answered(() => ({ statusCode: 200, data: user, responseOptions: JSON_RESPONSE })))
            .persist();
    }

    // A member Discord knows about; members a test doesn't declare get no answer
    member(guildId: string, member: APIGuildMember): void {
        this.api
            .intercept({ path: `${API}/guilds/${guildId}/members/${member.user.id}`, method: "GET" })
            .reply(this.answered(() => ({ statusCode: 200, data: member, responseOptions: JSON_RESPONSE })))
            .persist();
    }

    // Discord accepting roles being added to and removed from a member
    acceptMemberRoleChanges(guildId: string, userId: string): void {
        for (const method of ["PUT", "DELETE"]) {
            this.api
                .intercept({ path: startingWith(`${API}/guilds/${guildId}/members/${userId}/roles/`), method })
                .reply(this.answered(() => ({ statusCode: 204 })))
                .persist();
        }
    }

    // Roles added to (PUT) or removed from (DELETE) members, as "userId:roleId"
    memberRoleChanges(method: "PUT" | "DELETE"): string[] {
        const prefix = /^\/guilds\/\d+\/members\/(\d+)\/roles\/(\d+)$/;
        return this.requests()
            .filter((request) => request.method === method)
            .flatMap((request) => {
                const match = prefix.exec(request.path);
                return match ? [`${match[1]}:${match[2]}`] : [];
            });
    }

    // Every Discord REST request the bot made since it became ready
    requests(): DiscordRequest[] {
        return (mockAgent().getCallHistory()?.calls() ?? [])
            .filter((call) => call.origin === "https://discord.com")
            .map((call) => toDiscordRequest(call.method, call.path, call.body));
    }

    // The first request to a route, whether it already reached Discord or arrives later. For work the bot does in
    // its own event handlers, which a test cannot await: the request arriving is the event to wait for.
    request(method: string, path: string): Promise<DiscordRequest> {
        const matches = (request: DiscordRequest) => request.method === method && request.path === path;
        const seen = this.requests().find(matches);
        if (seen) return Promise.resolve(seen);
        return new Promise((resolve) => {
            const listener = (request: DiscordRequest) => {
                if (!matches(request)) return;
                this.arrivals.off("request", listener);
                resolve(request);
            };
            this.arrivals.on("request", listener);
        });
    }

    // The first edit to an interaction's original response, once it arrives
    async originalEdit(interaction: Interaction): Promise<RESTPatchAPIWebhookWithTokenMessageJSONBody> {
        const { body } = await this.request("PATCH", `/webhooks/${IDS.application}/${interaction.token}/messages/@original`);
        return body;
    }

    // Initial responses Discord received for an interaction (reply, defer, modal, update)
    callbacks(interaction: Interaction): RESTPostAPIInteractionCallbackJSONBody[] {
        return this.bodies("POST", `/interactions/${interaction.id}/${interaction.token}/callback`);
    }

    // The form Discord was asked to open for an interaction, if any
    modal(interaction: Interaction): APIModalInteractionResponseCallbackData | undefined {
        const response = this.callbacks(interaction).find((callback) => callback.type === InteractionResponseType.Modal);
        return response?.type === InteractionResponseType.Modal ? response.data : undefined;
    }

    // Edits to an interaction's original response (editReply)
    originalEdits(interaction: Interaction): RESTPatchAPIWebhookWithTokenMessageJSONBody[] {
        return this.bodies("PATCH", `/webhooks/${IDS.application}/${interaction.token}/messages/@original`);
    }

    // Slash command lists sent to Discord for a guild
    guildCommandUpdates(guildId: string): RESTPutAPIApplicationGuildCommandsJSONBody[] {
        return this.bodies("PUT", `/applications/${IDS.application}/guilds/${guildId}/commands`);
    }

    messagesSentTo(channelId: string): RESTPostAPIChannelMessageJSONBody[] {
        return this.bodies("POST", `/channels/${channelId}/messages`);
    }

    destroy(): Promise<void> {
        return this.client.destroy();
    }

    private bodies(method: string, path: string) {
        return this.requests()
            .filter((request) => request.method === method && request.path === path)
            .map((request) => request.body);
    }

    // Wraps a route's reply so each request it answers is announced to tests waiting for it
    private answered<T>(reply: (options: MockInterceptor.MockResponseCallbackOptions) => T) {
        return (options: MockInterceptor.MockResponseCallbackOptions): T => {
            this.arrivals.emit("request", toDiscordRequest(options.method, options.path, options.body));
            return reply(options);
        };
    }

    private send(payload: GatewayDispatchPayload): void {
        if (!this.gateway) throw new Error("The client has not connected to the gateway yet.");
        this.gateway.dispatch(payload);
    }

    private messageFrom(body: unknown, overrides: Partial<APIMessage> = {}): APIMessage {
        const sent: Partial<APIMessage> = parseBody(body);
        const { content, embeds, components } = sent;
        return apiMessage({ content: content ?? "", embeds: embeds ?? [], components: components ?? [], ...overrides });
    }
}
