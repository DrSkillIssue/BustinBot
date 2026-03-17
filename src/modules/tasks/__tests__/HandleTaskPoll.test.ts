import { beforeEach, describe, expect, it, vi } from 'vitest';

const selectTasksForCategoryMock = vi.hoisted(() => vi.fn());

vi.mock('../TaskSelector', () => ({
    selectTasksForCategory: selectTasksForCategoryMock,
}));

import { handleTaskPollVoteInteraction, postTaskPollForCategory } from '../HandleTaskPoll.js';
import { TaskCategory, TaskType } from '../../../models/Task.js';

describe('HandleTaskPoll collector behaviour', () => {
    beforeEach(() => {
        selectTasksForCategoryMock.mockReset();
    });

    it('tracks vote changes, persists updates, and closes cleanly', async () => {
        const tasks = [
            {
                id: 'task-1',
                taskName: 'Task One {amount}',
                category: TaskCategory.PvM,
                type: TaskType.KC,
                amtBronze: 120000,
                amtSilver: 23000,
                amtGold: 9000,
            },
            {
                id: 'task-2',
                taskName: 'Task Two {amount}',
                category: TaskCategory.PvM,
                type: TaskType.KC,
                amtBronze: 4,
                amtSilver: 5,
                amtGold: 6,
            },
            {
                id: 'task-3',
                taskName: 'Task Three {amount}',
                category: TaskCategory.PvM,
                type: TaskType.KC,
                amtBronze: 7,
                amtSilver: 8,
                amtGold: 9,
            },
        ];

        selectTasksForCategoryMock.mockReturnValue(tasks);

        const firstTimeResults = [true, false];
        let storedPoll: any;

        const taskRepo = {
            getAllTasks: vi.fn().mockResolvedValue(tasks),
            createTaskPoll: vi.fn().mockImplementation(async (poll) => {
                storedPoll = poll;
            }),
            voteInPollOnce: vi.fn().mockImplementation(async () => ({
                firstTime: firstTimeResults.shift() ?? false,
                updatedPoll: storedPoll,
            })),
            closeTaskPoll: vi.fn().mockResolvedValue(undefined),
        };

        const userRepo = {
            incrementStat: vi.fn().mockResolvedValue(undefined),
        };

        const services = {
            guildId: 'guild-1',
            guilds: {
                get: vi.fn().mockResolvedValue({
                    channels: { taskChannel: 'channel-1' },
                    roles: {},
                }),
            },
            repos: {
                taskRepo,
                userRepo,
            },
        };

        const collectors: Record<string, (payload?: any) => Promise<void> | void> = {};

        const message = {
            id: 'message-1',
            edit: vi.fn().mockResolvedValue(undefined),
            createMessageComponentCollector: vi
                .fn()
                .mockReturnValue({
                    on: vi.fn((event: string, handler: (arg?: any) => void) => {
                        collectors[event] = handler;
                    }),
                }),
        };

        const channel = {
            id: 'channel-override',
            send: vi.fn().mockResolvedValue(message),
        };

        await postTaskPollForCategory({} as any, services as any, TaskCategory.PvM, channel as any);

        expect(taskRepo.getAllTasks).toHaveBeenCalled();
        expect(taskRepo.createTaskPoll).toHaveBeenCalledTimes(1);
        expect(storedPoll).toBeDefined();

        const collectHandler = collectors['collect'];
        const endHandler = collectors['end'];
        expect(typeof collectHandler).toBe('function');
        expect(typeof endHandler).toBe('function');

        const interaction = {
            user: { id: 'user-1', username: 'Alice' },
            customId: `vote_${TaskCategory.PvM}_task-1`,
            deferred: false,
            replied: false,
            deferUpdate: vi.fn().mockResolvedValue(undefined),
            editReply: vi.fn().mockResolvedValue(undefined),
            followUp: vi.fn().mockResolvedValue(undefined),
        };

        await collectHandler?.(interaction as any);

        expect(taskRepo.voteInPollOnce).toHaveBeenCalledWith(
            storedPoll.id,
            'user-1',
            'task-1'
        );
        expect(userRepo.incrementStat).toHaveBeenCalledWith('user-1', 'taskPollsVoted', 1);
        expect(storedPoll.votes['user-1']).toBe('task-1');
        expect(interaction.followUp).toHaveBeenCalledWith({ content: 'Thank you for your vote!', flags: 1 << 6 });

        const firstUpdateDescription =
            interaction.editReply.mock.calls[0]?.[0]?.embeds?.[0]?.data?.description;
        expect(firstUpdateDescription).toContain('**1 vote**');
        expect(firstUpdateDescription).toContain('🥉 **120k**');
        expect(firstUpdateDescription).toContain('🥈 **23k**');
        expect(firstUpdateDescription).toContain('🥇 **9000**');

        interaction.customId = `vote_${TaskCategory.PvM}_task-2`;

        await collectHandler?.(interaction as any);

        expect(userRepo.incrementStat).toHaveBeenCalledTimes(1);
        expect(storedPoll.votes['user-1']).toBe('task-2');
        expect(taskRepo.createTaskPoll).toHaveBeenCalledTimes(3); // initial + two updates
        expect(interaction.followUp).toHaveBeenCalledTimes(2);

        const secondUpdateDescription =
            interaction.editReply.mock.calls[1]?.[0]?.embeds?.[0]?.data?.description;
        expect(secondUpdateDescription).toContain('**1 vote**');
        expect(secondUpdateDescription).toContain('**0 votes**');

        await endHandler?.();

        expect(message.edit).toHaveBeenCalled();
        expect(taskRepo.closeTaskPoll).toHaveBeenCalledWith(storedPoll.id);
    });

    it('handles persisted vote by matching poll message id after restart', async () => {
        const taskRepo = {
            getTaskPollById: vi.fn().mockResolvedValue({
                id: 'message-1',
                messageId: 'message-1',
                category: TaskCategory.PvM,
                isActive: true,
                options: [{ id: 'task-1' }, { id: 'task-2' }, { id: 'task-3' }],
                votes: {},
            }),
            voteInPollOnce: vi.fn().mockResolvedValue({
                firstTime: true,
                updatedPoll: {
                    id: 'message-1',
                    messageId: 'message-1',
                    category: TaskCategory.PvM,
                    isActive: true,
                    options: [{ id: 'task-1' }, { id: 'task-2' }, { id: 'task-3' }],
                    votes: { 'user-1': 'task-1' },
                    channelId: 'channel-1',
                    endsAt: new Date(),
                },
            }),
        };

        const services = {
            repos: {
                taskRepo,
                userRepo: { incrementStat: vi.fn().mockResolvedValue(undefined) },
            },
        } as any;

        const interaction = {
            customId: `vote_${TaskCategory.PvM}_task-1`,
            message: { id: 'message-1' },
            user: { id: 'user-1', username: 'Alice' },
            client: { channels: { fetch: vi.fn().mockResolvedValue(null) } },
            deferReply: vi.fn().mockResolvedValue(undefined),
            editReply: vi.fn().mockResolvedValue(undefined),
            reply: vi.fn().mockResolvedValue(undefined),
        } as any;

        await handleTaskPollVoteInteraction(interaction, services);

        expect(taskRepo.getTaskPollById).toHaveBeenCalledWith('message-1');
        expect(taskRepo.voteInPollOnce).toHaveBeenCalledWith('message-1', 'user-1', 'task-1');
        expect(interaction.editReply).toHaveBeenCalledWith({ content: 'Thank you for your vote!' });
    });

    it('returns outdated when button category does not match poll category', async () => {
        const taskRepo = {
            getTaskPollById: vi.fn().mockResolvedValue({
                id: 'message-1',
                messageId: 'message-1',
                category: TaskCategory.Skilling,
                isActive: true,
                options: [{ id: 'task-1' }],
                votes: {},
            }),
        };

        const interaction = {
            customId: `vote_${TaskCategory.PvM}_task-1`,
            message: { id: 'message-1' },
            deferReply: vi.fn().mockResolvedValue(undefined),
            editReply: vi.fn().mockResolvedValue(undefined),
            reply: vi.fn().mockResolvedValue(undefined),
        } as any;

        await handleTaskPollVoteInteraction(interaction, { repos: { taskRepo } } as any);

        expect(interaction.editReply).toHaveBeenCalledWith({ content: 'This poll message is outdated.' });
    });
});
