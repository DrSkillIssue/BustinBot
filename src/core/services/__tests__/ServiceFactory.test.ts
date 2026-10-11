import { describe, expect, it, vi } from 'vitest';

const botRepoInstance = { name: 'botRepo' };
const taskRepoInstance = { name: 'taskRepo' };
const prizeRepoInstance = { name: 'prizeRepo' };
const keywordRepoInstance = { name: 'keywordRepo' };
const movieRepoInstance = { name: 'movieRepo' };
const guildRepoInstance = { name: 'guildRepo' };
const userRepoInstance = { name: 'userRepo' };

const BotRepository = vi.fn(function () { return botRepoInstance; });
const TaskRepository = vi.fn(function () { return taskRepoInstance; });
const PrizeDrawRepository = vi.fn(function () { return prizeRepoInstance; });
const KeywordRepository = vi.fn(function () { return keywordRepoInstance; });
const MovieRepository = vi.fn(function () { return movieRepoInstance; });
const GuildRepository = vi.fn(function () { return guildRepoInstance; });
const UserRepository = vi.fn(function () { return userRepoInstance; });

vi.mock('../../database/BotRepo', () => ({ BotRepository }));
vi.mock('../../database/TaskRepo', () => ({ TaskRepository }));
vi.mock('../../database/PrizeDrawRepo', () => ({ PrizeDrawRepository }));
vi.mock('../../database/KeywordRepo', () => ({ KeywordRepository }));
vi.mock('../../database/MovieRepo', () => ({ MovieRepository }));
vi.mock('../../database/GuildRepo', () => ({ GuildRepository }));
vi.mock('core/database/UserRepo', () => ({ UserRepository }));

const botStatsInit = vi.fn().mockResolvedValue(undefined);
const BotStatsService = vi.fn(function () { return { init: botStatsInit }; });
vi.mock('../BotStatsService', () => ({ BotStatsService }));

const TaskService = vi.fn(function (repo: unknown) { return { kind: 'TaskService', repo }; });
vi.mock('../../../modules/tasks/TaskService', () => ({ TaskService }));

const TaskEventStore = vi.fn(function (repo: unknown) { return { kind: 'TaskEventStore', repo }; });
vi.mock('../../../modules/tasks/TaskEventStore', () => ({ TaskEventStore }));

const KeywordSelector = vi.fn(function (repo: unknown) { return { kind: 'KeywordSelector', repo }; });
vi.mock('../../../modules/tasks/KeywordSelector', () => ({ KeywordSelector }));

const GuildService = vi.fn(function (repo: unknown) { return { kind: 'GuildService', repo }; });
vi.mock('../GuildService', () => ({ GuildService }));

describe('createServiceContainer', () => {
    it('constructs repositories and services with initialised bot stats', async () => {
        const { createServiceContainer } = await import('../ServiceFactory.js');

        const services = await createServiceContainer('guild-42');

        expect(BotRepository).toHaveBeenCalledTimes(1);
        expect(GuildRepository).toHaveBeenCalledTimes(1);
        expect(TaskRepository).toHaveBeenCalledWith('guild-42');
        expect(PrizeDrawRepository).toHaveBeenCalledWith('guild-42');
        expect(keywordRepoInstance).toBeDefined();

        expect(BotStatsService).toHaveBeenCalledWith(botRepoInstance);
        expect(botStatsInit).toHaveBeenCalled();

        expect(TaskService).toHaveBeenCalledWith(taskRepoInstance);
        expect(TaskEventStore).toHaveBeenCalledWith(taskRepoInstance);
        expect(KeywordSelector).toHaveBeenCalledWith(keywordRepoInstance);
        expect(GuildService).toHaveBeenCalledWith(guildRepoInstance);

        expect(services).toEqual(expect.objectContaining({
            guildId: 'guild-42',
            tasks: expect.objectContaining({ kind: 'TaskService', repo: taskRepoInstance }),
            taskEvents: expect.objectContaining({ kind: 'TaskEventStore', repo: taskRepoInstance }),
            keywords: expect.objectContaining({ kind: 'KeywordSelector', repo: keywordRepoInstance }),
            guilds: expect.objectContaining({ kind: 'GuildService', repo: guildRepoInstance }),
            repos: expect.objectContaining({
                taskRepo: taskRepoInstance,
                prizeRepo: prizeRepoInstance,
                movieRepo: movieRepoInstance,
                keywordRepo: keywordRepoInstance,
                guildRepo: guildRepoInstance,
                userRepo: userRepoInstance,
            }),
        }));
    });
});
