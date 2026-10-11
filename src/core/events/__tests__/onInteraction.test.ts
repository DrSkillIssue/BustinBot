import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CommandModule, CommandRole } from '../../../models/Command.js';
import { handleInteraction } from '../onInteraction.js';

const createBaseInteraction = () => {
    const reply = vi.fn().mockResolvedValue(undefined);
    const followUp = vi.fn().mockResolvedValue(undefined);

    return {
        isChatInputCommand: () => true,
        isButton: () => false,
        commandName: 'ping',
        guildId: 'guild-123',
        member: {
            user: { id: 'user-1' },
            roles: ['role-1'],
            permissions: '0',
        },
        user: { id: 'user-1', username: 'Tester' },
        reply,
        followUp,
        deferred: false,
        replied: false,
    } as any;
};

describe('handleInteraction', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('handles slash command when member is APIInteractionGuildMember', async () => {
        const commandExecute = vi.fn().mockResolvedValue(undefined);
        const commandMap = new Map([
            [
                'ping',
                {
                    name: 'ping',
                    description: 'Ping command',
                    module: CommandModule.Core,
                    allowedRoles: [CommandRole.Everyone],
                    execute: commandExecute,
                },
            ],
        ]);

        const services: any = {
            guilds: {
                requireConfig: vi.fn().mockResolvedValue({
                    roles: {},
                    channels: {},
                    setupComplete: { core: true },
                }),
                get: vi.fn().mockResolvedValue({
                    setupComplete: { core: true },
                }),
            },
            repos: { userRepo: null },
        };

        const interaction = createBaseInteraction();

        await expect(handleInteraction(interaction, commandMap, services)).resolves.toBeUndefined();
        expect(commandExecute).toHaveBeenCalled();
        expect(interaction.reply).not.toHaveBeenCalledWith(
            expect.objectContaining({ content: expect.stringContaining('Unable to determine') }),
        );
    });

    it('runs the command without waiting for the commandsRun stat write', async () => {
        const commandExecute = vi.fn().mockResolvedValue(undefined);
        const commandMap = new Map([
            [
                'ping',
                {
                    name: 'ping',
                    description: 'Ping command',
                    module: CommandModule.Core,
                    allowedRoles: [CommandRole.Everyone],
                    execute: commandExecute,
                },
            ],
        ]);

        const services: any = {
            guilds: {
                requireConfig: vi.fn(),
                get: vi.fn().mockResolvedValue({
                    setupComplete: { core: true },
                }),
            },
            repos: {
                userRepo: { incrementStat: vi.fn(() => new Promise(() => {})) },
            },
        };

        const interaction = createBaseInteraction();

        await handleInteraction(interaction, commandMap, services);

        expect(services.repos.userRepo.incrementStat).toHaveBeenCalledWith('user-1', 'commandsRun', 1);
        expect(commandExecute).toHaveBeenCalled();
    });

    it('lets a command open a modal as its first response', async () => {
        const commandExecute = vi.fn(async ({ interaction }) => {
            await interaction.showModal({});
        });
        const commandMap = new Map([
            [
                'ping',
                {
                    name: 'ping',
                    description: 'Ping command',
                    module: CommandModule.Core,
                    allowedRoles: [CommandRole.Everyone],
                    execute: commandExecute,
                },
            ],
        ]);

        const services: any = {
            guilds: {
                requireConfig: vi.fn(),
                get: vi.fn().mockResolvedValue({
                    setupComplete: { core: true },
                }),
            },
            repos: { userRepo: null },
        };

        const interaction = createBaseInteraction();
        interaction.showModal = vi.fn().mockImplementation(async () => {
            if (interaction.deferred || interaction.replied) throw new Error('InteractionAlreadyReplied');
        });

        await handleInteraction(interaction, commandMap, services);

        expect(interaction.showModal).toHaveBeenCalled();
        expect(interaction.reply).not.toHaveBeenCalled();
        expect(interaction.followUp).not.toHaveBeenCalled();
    });
});
