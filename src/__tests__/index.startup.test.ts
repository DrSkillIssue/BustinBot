import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

async function waitForAssertion(assertion: () => void, attempts = 50, delayMs = 5) {
    let lastError: unknown;
    for (let i = 0; i < attempts; i++) {
        try {
            assertion();
            return;
        } catch (err) {
            lastError = err;
            await new Promise((resolve) => setTimeout(resolve, delayMs));
        }
    }
    throw lastError;
}

const mockConfig = vi.fn();
vi.mock('dotenv', () => ({ config: mockConfig }));

const mockSlashToJSON = vi.fn(() => ({ name: 'slash-cmd' }));
const mockCommands = new Map<string, any>();
const loadCommands = vi.fn(async () => mockCommands);
vi.mock('../core/services/CommandService.js', () => ({ loadCommands }));

const registerGuildCommands = vi.fn().mockResolvedValue(undefined);
vi.mock('../utils/registerCommands.js', () => ({ registerGuildCommands }));

const scheduleActivePollClosure = vi.fn().mockResolvedValue(undefined);
vi.mock('../modules/movies/MoviePollScheduler.js', () => ({ scheduleActivePollClosure }));

const initTaskScheduler = vi.fn();
vi.mock('../modules/tasks/TaskScheduler.js', () => ({ initTaskScheduler }));

const initMovieScheduler = vi.fn();
vi.mock('../modules/movies/MovieScheduler.js', () => ({ initMovieScheduler }));

const handleMessage = vi.fn().mockResolvedValue(undefined);
vi.mock('../core/events/onMessage.js', () => ({ handleMessage }));

const handleInteraction = vi.fn().mockResolvedValue(undefined);
vi.mock('../core/events/onInteraction.js', () => ({ handleInteraction }));

const handleDirectMessage = vi.fn().mockResolvedValue(undefined);
vi.mock('../modules/tasks/TaskInteractions.js', () => ({ handleDirectMessage }));

const handleTaskInteraction = vi.fn().mockResolvedValue(undefined);
vi.mock('../modules/tasks/TaskInteractionHandler.js', () => ({ handleTaskInteraction }));

const handleMovieInteraction = vi.fn().mockResolvedValue(undefined);
vi.mock('../modules/movies/MovieInteractionHandler.js', () => ({ handleMovieInteraction }));

const guildConfigs = [
    { id: 'guild-1', toggles: { taskScheduler: true } },
    { id: 'guild-2', toggles: { taskScheduler: false } },
];
const getAllGuilds = vi.fn(async () => guildConfigs);
vi.mock('../core/database/GuildRepo.js', () => ({
    GuildRepository: vi.fn().mockImplementation(() => ({ getAllGuilds })),
}));

const createServiceContainer = vi.fn(async (guildId: string) => ({ guildId, repos: {} }));
vi.mock('../core/services/ServiceFactory.js', () => ({ createServiceContainer }));

const Routes = {
    applicationGuildCommands: vi.fn((clientId: string, guildId: string) => `route:${clientId}:${guildId}`),
};
const restPut = vi.fn().mockResolvedValue(undefined);
class MockREST {
    static latest: MockREST | null = null;
    constructor() {
        MockREST.latest = this;
    }
    public token: string | null = null;
    setToken(token: string) {
        this.token = token;
        return this;
    }
    put = restPut;
}

const messageHandlers = new Map<string, (...args: any[]) => unknown>();
const onceHandlers = new Map<string, (...args: any[]) => unknown>();
class MockClient {
    static latest: MockClient | null = null;
    public login = vi.fn().mockResolvedValue(undefined);
    public user = { tag: 'MockBot#0001' };
    constructor() {
        MockClient.latest = this;
    }
    on(event: string, handler: (...args: any[]) => unknown) {
        messageHandlers.set(event, handler);
        return this;
    }
    once(event: string, handler: (...args: any[]) => unknown) {
        onceHandlers.set(event, handler);
        return this;
    }
}

const GatewayIntentBits = { Guilds: 1, GuildMessages: 2, MessageContent: 3, DirectMessages: 4 };
const Partials = { Channel: 'channel' };

vi.mock('discord.js', () => ({
    REST: MockREST,
    Routes,
    Client: MockClient,
    GatewayIntentBits,
    Partials,
}));

const originalEnv = { ...process.env };
const originalArgv = [...process.argv];

describe('index startup script', () => {
    beforeEach(() => {
        process.argv = originalArgv.filter((arg) => arg !== '--dryrun' && arg !== '--dry-run');

        process.env.BOT_MODE = 'dev';
        process.env.DISCORD_TOKEN_DEV = 'dev-token';
        process.env.DISCORD_CLIENT_ID = 'client-id';
        process.env.DISCORD_CLIENT_ID_DEV = 'client-id';
        process.env.DISCORD_GUILD_ID = 'env-guild';

        mockConfig.mockClear();
        loadCommands.mockClear();
        mockCommands.clear();
        mockCommands.set('primary', {
            name: 'primary',
            description: 'Primary Command',
            slashData: { toJSON: mockSlashToJSON },
        });
        mockCommands.set('alias-primary', {
            name: 'primary',
            alias: true,
            slashData: { toJSON: mockSlashToJSON },
        });

        restPut.mockClear();
        Routes.applicationGuildCommands.mockClear();
        createServiceContainer.mockClear();
        handleMessage.mockClear();
        handleDirectMessage.mockClear();
        handleInteraction.mockClear();
        handleTaskInteraction.mockClear();
        handleMovieInteraction.mockClear();
        scheduleActivePollClosure.mockClear();
        initTaskScheduler.mockClear();
        initMovieScheduler.mockClear();
        getAllGuilds.mockClear();
        messageHandlers.clear();
        onceHandlers.clear();

    });

    afterEach(() => {
        process.argv = [...originalArgv];
        Object.assign(process.env, originalEnv);
    });

    it('supports dryrun mode by loading commands and skipping runtime wiring', async () => {
        process.argv.push('--dryrun');
        await import('../index.js');

        await waitForAssertion(() => {
            expect(loadCommands).toHaveBeenCalled();
            expect((loadCommands.mock.calls as any)[0]?.[0]).toMatch(/modules[\\/]+commands$/);
        });

        // In dryrun mode, startup should not touch DB, login, or runtime event wiring.
        expect(getAllGuilds).not.toHaveBeenCalled();
        expect(registerGuildCommands).not.toHaveBeenCalled();
        expect(createServiceContainer).not.toHaveBeenCalled();
        expect(scheduleActivePollClosure).not.toHaveBeenCalled();
        expect(initTaskScheduler).not.toHaveBeenCalled();
        expect(initMovieScheduler).not.toHaveBeenCalled();
        expect(handleMessage).not.toHaveBeenCalled();
        expect(handleDirectMessage).not.toHaveBeenCalled();
        expect(handleInteraction).not.toHaveBeenCalled();
        expect(handleTaskInteraction).not.toHaveBeenCalled();
        expect(handleMovieInteraction).not.toHaveBeenCalled();
        expect(MockClient.latest?.login).not.toHaveBeenCalled();
        expect(messageHandlers.get('messageCreate')).toBeUndefined();
        expect(messageHandlers.get('interactionCreate')).toBeUndefined();
        expect(onceHandlers.get('clientReady')).toBeUndefined();
    });
});
