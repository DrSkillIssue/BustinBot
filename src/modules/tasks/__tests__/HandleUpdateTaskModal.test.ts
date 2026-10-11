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
