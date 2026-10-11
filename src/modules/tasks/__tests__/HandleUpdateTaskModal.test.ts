import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const buildTaskEventEmbedMock = vi.hoisted(() =>
    vi.fn(() => ({
        embeds: ['embed'],
        components: [],
        files: [],
    }))
);

vi.mock('../TaskEmbeds', () => ({
    buildTaskEventEmbed: buildTaskEventEmbedMock,
}));

import { handleUpdateTaskModal } from '../HandleUpdateTaskModal.js';
import { TaskCategory, TaskType } from '../../../models/Task.js';

describe('handleUpdateTaskModal', () => {
    const task = {
        id: 'SKL243',
        taskName: 'Gain {amount} Sailing XP',
        category: TaskCategory.Skilling,
        type: TaskType.XP,
        amtBronze: 150000,
        amtSilver: 400000,
        amtGold: 800000,
    };

    const fields: Record<string, string> = {
        taskName: 'Gain {amount} Sailing XP',
        type: 'XP',
        bronze: '100',
        silver: '200',
        gold: '300',
    };

    const buildInteraction = (callOrder: string[], messageEdit = vi.fn().mockResolvedValue(undefined)) => {
        const channel = {
            name: 'weekly-tasks',
            isTextBased: () => true,
            messages: { fetch: vi.fn().mockResolvedValue({ edit: messageEdit }) },
        };

        return {
            customId: 'update_task_modal_SKL243',
            fields: { getTextInputValue: (name: string) => fields[name] },
            client: {
                channels: {
                    cache: { get: vi.fn().mockReturnValue(channel) },
                    fetch: vi.fn(),
                },
            },
            deferReply: vi.fn().mockImplementation(async () => {
                callOrder.push('deferReply');
            }),
            editReply: vi.fn().mockResolvedValue(undefined),
            reply: vi.fn().mockResolvedValue(undefined),
        } as any;
    };

    beforeEach(() => {
        buildTaskEventEmbedMock.mockClear();
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2025-03-04T00:00:00.000Z'));
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it('defers before saving and refreshes the active event even when another category was created later', async () => {
        const callOrder: string[] = [];
        const skillingEvent = {
            id: 'SKL243-20250303',
            task: { ...task },
            category: TaskCategory.Skilling,
            amounts: { bronze: 150000, silver: 400000, gold: 800000 },
            startTime: new Date('2025-03-03T00:00:00.000Z'),
            endTime: new Date('2025-03-10T00:00:00.000Z'),
            createdAt: new Date('2025-03-03T00:00:01.000Z'),
            channelId: 'channel-1',
            messageId: 'message-1',
        };
        const pvmEvent = {
            id: 'PVM001-20250303',
            task: { id: 'PVM001' },
            category: TaskCategory.PvM,
            amounts: { bronze: 1, silver: 2, gold: 3 },
            startTime: new Date('2025-03-03T00:00:00.000Z'),
            endTime: new Date('2025-03-10T00:00:00.000Z'),
            createdAt: new Date('2025-03-03T00:00:02.000Z'),
            channelId: 'channel-1',
            messageId: 'message-2',
        };

        const taskRepo = {
            getTaskById: vi.fn().mockImplementation(async () => {
                callOrder.push('getTaskById');
                return { ...task };
            }),
            createTask: vi.fn().mockResolvedValue(undefined),
            getTaskEventsBetween: vi.fn().mockResolvedValue([pvmEvent, skillingEvent]),
            createTaskEvent: vi.fn().mockResolvedValue(undefined),
            getActiveTaskPollByCategory: vi.fn().mockResolvedValue(null),
        };

        const messageEdit = vi.fn().mockResolvedValue(undefined);
        const interaction = buildInteraction(callOrder, messageEdit);

        await handleUpdateTaskModal(interaction, { repos: { taskRepo } } as any);

        expect(callOrder).toEqual(['deferReply', 'getTaskById']);
        expect(taskRepo.createTask).toHaveBeenCalledWith(
            expect.objectContaining({ id: 'SKL243', amtBronze: 100, amtSilver: 200, amtGold: 300 })
        );
        expect(taskRepo.createTaskEvent).toHaveBeenCalledTimes(1);
        expect(taskRepo.createTaskEvent).toHaveBeenCalledWith(
            expect.objectContaining({
                id: 'SKL243-20250303',
                amounts: { bronze: 100, silver: 200, gold: 300 },
            })
        );
        expect(messageEdit).toHaveBeenCalledWith({ embeds: ['embed'], components: [], files: [] });
        expect(interaction.reply).not.toHaveBeenCalled();
        expect(interaction.editReply).toHaveBeenCalledWith({ content: 'Task **SKL243** updated successfully.' });
    });

    it('leaves events that have not started yet untouched', async () => {
        const taskRepo = {
            getTaskById: vi.fn().mockResolvedValue({ ...task }),
            createTask: vi.fn().mockResolvedValue(undefined),
            getTaskEventsBetween: vi.fn().mockResolvedValue([
                {
                    id: 'SKL243-20250310',
                    task: { ...task },
                    startTime: new Date('2025-03-10T00:00:00.000Z'),
                    endTime: new Date('2025-03-17T00:00:00.000Z'),
                    channelId: 'channel-1',
                    messageId: 'message-1',
                },
            ]),
            createTaskEvent: vi.fn().mockResolvedValue(undefined),
            getActiveTaskPollByCategory: vi.fn().mockResolvedValue(null),
        };

        const interaction = buildInteraction([]);

        await handleUpdateTaskModal(interaction, { repos: { taskRepo } } as any);

        expect(taskRepo.createTask).toHaveBeenCalled();
        expect(taskRepo.createTaskEvent).not.toHaveBeenCalled();
        expect(buildTaskEventEmbedMock).not.toHaveBeenCalled();
        expect(interaction.editReply).toHaveBeenCalledWith({ content: 'Task **SKL243** updated successfully.' });
    });

    it('edits the deferred reply when the task no longer exists', async () => {
        const taskRepo = {
            getTaskById: vi.fn().mockResolvedValue(null),
            createTask: vi.fn(),
        };

        const interaction = buildInteraction([]);

        await handleUpdateTaskModal(interaction, { repos: { taskRepo } } as any);

        expect(interaction.deferReply).toHaveBeenCalledWith({ flags: 1 << 6 });
        expect(taskRepo.createTask).not.toHaveBeenCalled();
        expect(interaction.reply).not.toHaveBeenCalled();
        expect(interaction.editReply).toHaveBeenCalledWith({ content: 'Could not find task with ID **SKL243**.' });
    });
});
