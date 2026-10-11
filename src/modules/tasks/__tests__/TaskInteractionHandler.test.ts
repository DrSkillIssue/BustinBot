import { beforeEach, describe, expect, it, vi } from 'vitest';

const handleTaskFeedback = vi.fn();
const handleSubmitButton = vi.fn().mockResolvedValue(undefined);
const handleAdminButton = vi.fn().mockResolvedValue(undefined);
const handleTaskSelect = vi.fn().mockResolvedValue(undefined);
const handleRejectionModal = vi.fn().mockResolvedValue(undefined);
const handleUpdateTaskModal = vi.fn().mockResolvedValue(undefined);
const handleTaskPollVoteInteraction = vi.fn().mockResolvedValue(undefined);

vi.mock('../HandleTaskFeedback', () => ({ handleTaskFeedback }));
vi.mock('../TaskInteractions', () => ({
    handleSubmitButton,
    handleAdminButton,
    handleTaskSelect,
    handleRejectionModal,
}));
vi.mock('../HandleUpdateTaskModal', () => ({
    handleUpdateTaskModal,
}));
vi.mock('../HandleTaskPoll.js', () => ({
    handleTaskPollVoteInteraction,
}));

const services: any = {
    tasks: { repository: { name: 'taskRepo' } },
    guilds: { name: 'guildService' },
};

const { handleTaskInteraction } = await import('../TaskInteractionHandler.js');

const baseInteraction = () => ({
    user: { id: 'user-1' },
    guildId: 'guild-1',
    isButton: () => false,
    isStringSelectMenu: () => false,
    isModalSubmit: () => false,
    isRoleSelectMenu: () => false,
    isChannelSelectMenu: () => false,
    isChatInputCommand: () => false,
    deferUpdate: vi.fn().mockResolvedValue(undefined),
    reply: vi.fn().mockResolvedValue(undefined),
    update: vi.fn().mockResolvedValue(undefined),
});

beforeEach(() => {
    vi.clearAllMocks();
});

describe('handleTaskInteraction', () => {
    it('routes task feedback button', async () => {
        const interaction: any = {
            ...baseInteraction(),
            isButton: () => true,
            customId: 'task-feedback|up|task-1|event-1',
        };

        await handleTaskInteraction(interaction, {} as any, services);
        expect(handleTaskFeedback).toHaveBeenCalledWith(interaction, services.tasks.repository);
    });

    it('routes review-confirm buttons to admin handler', async () => {
        const interaction: any = {
            ...baseInteraction(),
            isButton: () => true,
            customId: 'review-confirm|approve|bronze|submission-1',
        };

        await handleTaskInteraction(interaction, {} as any, services);

        expect(handleAdminButton).toHaveBeenCalledWith(interaction, services);
    });

    it('routes review-cancel buttons to admin handler', async () => {
        const interaction: any = {
            ...baseInteraction(),
            isButton: () => true,
            customId: 'review-cancel|submission-1',
        };

        await handleTaskInteraction(interaction, {} as any, services);

        expect(handleAdminButton).toHaveBeenCalledWith(interaction, services);
    });
});
