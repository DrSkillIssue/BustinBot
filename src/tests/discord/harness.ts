import { Client, GatewayIntentBits, type Interaction, type RESTOptions } from "discord.js";
import {
    GatewayDispatchEvents,
    InteractionResponseType,
    type APIInteraction,
    type APIMessage,
    type APIModalInteractionResponseCallbackData,
    type GatewayGuildCreateDispatchData,
    type RESTPostAPIInteractionCallbackJSONBody,
} from "discord-api-types/v10";
import { http, HttpResponse, type JsonBodyType } from "msw";
import { server } from "../setup.js";
import { IDS, apiGuild, apiMessage, apiUser } from "./payloads.js";

const API = "https://discord.com/api/v10";

export interface DiscordRequest {
    method: string;
    path: string;
    body: unknown;
}

// The parts of discord.js's gateway handling the harness drives directly. They are private in the typings,
// so they are reached in exactly one place here rather than throughout the tests.
interface GatewayInternals {
    handlePacket(packet: { t: GatewayDispatchEvents; d: unknown }, shard: { id: number; checkReady(): void }): boolean;
    triggerClientReady(): void;
}

const SHARD = { id: 0, checkReady() {} };

// A real discord.js client with no gateway connection: Discord events are fed in as raw gateway packets and every
// REST call is answered by msw handlers that behave like Discord's API and record what was sent.
export class DiscordHarness {
    readonly requests: DiscordRequest[] = [];
    private readonly acknowledged = new Set<string>();

    private constructor(readonly client: Client<true>) {}

    static start(guild: GatewayGuildCreateDispatchData = apiGuild()): DiscordHarness {
        const client = new Client({
            intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers, GatewayIntentBits.GuildMessages],
            // Send REST requests through the global fetch so msw can intercept them. Node's fetch is undici's
            // implementation, but its typings come from @types/node rather than the undici package REST expects.
            rest: { makeRequest: fetch as RESTOptions["makeRequest"] },
        });
        client.rest.setToken("test-token");

        const harness = new DiscordHarness(client as Client<true>);
        server.use(...harness.handlers());

        harness.gateway(GatewayDispatchEvents.Ready, {
            v: 10,
            user: apiUser({ id: IDS.bot, username: "BustinBot", bot: true }),
            guilds: [],
            session_id: "session",
            resume_gateway_url: "wss://gateway.discord.gg",
            application: { id: IDS.application, flags: 0 },
        });
        (client.ws as unknown as GatewayInternals).triggerClientReady();
        harness.gateway(GatewayDispatchEvents.GuildCreate, guild);
        return harness;
    }

    // Delivers an interaction the way the gateway does and returns the discord.js object created for it
    async dispatch<T extends Interaction>(payload: APIInteraction): Promise<T> {
        const created = new Promise<T>((resolve) => {
            this.client.once("interactionCreate", (interaction) => resolve(interaction as T));
        });
        this.gateway(GatewayDispatchEvents.InteractionCreate, payload);
        return created;
    }

    // Initial responses Discord received for an interaction (reply, defer, modal, update)
    callbacks(interaction: Interaction): RESTPostAPIInteractionCallbackJSONBody[] {
        return this.requests
            .filter((request) => request.path === `/interactions/${interaction.id}/${interaction.token}/callback`)
            .map((request) => request.body as RESTPostAPIInteractionCallbackJSONBody);
    }

    // The form Discord was asked to open for an interaction, if any
    modal(interaction: Interaction): APIModalInteractionResponseCallbackData | undefined {
        const response = this.callbacks(interaction).find((callback) => callback.type === InteractionResponseType.Modal);
        return response?.type === InteractionResponseType.Modal ? response.data : undefined;
    }

    // Edits to an interaction's original response (editReply)
    originalEdits(interaction: Interaction): unknown[] {
        return this.requests
            .filter((request) => request.method === "PATCH" && request.path === `/webhooks/${IDS.application}/${interaction.token}/messages/@original`)
            .map((request) => request.body);
    }

    messagesSentTo(channelId: string): unknown[] {
        return this.requests
            .filter((request) => request.method === "POST" && request.path === `/channels/${channelId}/messages`)
            .map((request) => request.body);
    }

    destroy(): Promise<void> {
        return this.client.destroy();
    }

    private gateway(event: GatewayDispatchEvents, data: unknown): void {
        (this.client.ws as unknown as GatewayInternals).handlePacket({ t: event, d: data }, SHARD);
    }

    private async record(request: Request): Promise<DiscordRequest> {
        const text = await request.text();
        const recorded = {
            method: request.method,
            path: new URL(request.url).pathname.replace("/api/v10", ""),
            body: text ? JSON.parse(text) : undefined,
        };
        this.requests.push(recorded);
        return recorded;
    }

    private messageFrom(body: unknown, overrides: Partial<APIMessage> = {}): JsonBodyType {
        const { content, embeds, components } = (body ?? {}) as Partial<APIMessage>;
        return apiMessage({ content: content ?? "", embeds: embeds ?? [], components: components ?? [], ...overrides }) as JsonBodyType;
    }

    private handlers() {
        return [
            // Discord accepts exactly one initial response per interaction (error 40060 otherwise)
            http.post(`${API}/interactions/:id/:token/callback`, async ({ request, params }) => {
                const { body } = await this.record(request);
                const id = String(params.id);
                if (this.acknowledged.has(id)) {
                    return HttpResponse.json({ code: 40060, message: "Interaction has already been acknowledged." }, { status: 400 });
                }
                this.acknowledged.add(id);

                if (new URL(request.url).searchParams.get("with_response") !== "true") {
                    return new HttpResponse(null, { status: 204 });
                }
                const type = (body as RESTPostAPIInteractionCallbackJSONBody).type;
                return HttpResponse.json({
                    interaction: { id, type, activity_instance_id: null, response_message_id: null, response_message_loading: false, response_message_ephemeral: false },
                    resource: type === InteractionResponseType.Modal ? undefined : { type },
                });
            }),
            http.patch(`${API}/webhooks/:applicationId/:token/messages/:messageId`, async ({ request }) => {
                const { body } = await this.record(request);
                return HttpResponse.json(this.messageFrom(body));
            }),
            http.post(`${API}/webhooks/:applicationId/:token`, async ({ request }) => {
                const { body } = await this.record(request);
                return HttpResponse.json(this.messageFrom(body));
            }),
            http.post(`${API}/channels/:channelId/messages`, async ({ request, params }) => {
                const { body } = await this.record(request);
                return HttpResponse.json(this.messageFrom(body, { channel_id: String(params.channelId) }));
            }),
        ];
    }
}
