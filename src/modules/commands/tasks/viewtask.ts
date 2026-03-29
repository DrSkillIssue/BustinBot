import { SlashCommandBuilder, ChatInputCommandInteraction } from 'discord.js';
import Fuse from 'fuse.js';
import type { Command } from '../../../models/Command.js';
import { CommandModule, CommandRole } from '../../../models/Command.js';
import type { ServiceContainer } from '../../../core/services/ServiceContainer.js';
import type { Task } from '../../../models/Task.js';
import { buildTaskInfoEmbed } from '../../tasks/TaskEmbeds.js';

type SearchableTask = Task & { searchTaskName: string; searchShortName: string };

function normalise(value: string): string {
    return value.trim().toLowerCase();
}

function resolveBestTaskMatch(tasks: Task[], query: string): Task | null {
    const q = normalise(query);
    if (!q) return null;

    const searchable: SearchableTask[] = tasks.map((task) => ({
        ...task,
        searchTaskName: normalise(task.taskName),
        searchShortName: normalise(task.shortName ?? ''),
    }));

    const exactId = searchable.find((task) => normalise(task.id) === q);
    if (exactId) return exactId;

    const exactName = searchable.find(
        (task) => task.searchTaskName === q || (task.searchShortName && task.searchShortName === q)
    );
    if (exactName) return exactName;

    const idPrefix = searchable.find((task) => normalise(task.id).startsWith(q));
    if (idPrefix) return idPrefix;

    const fuse = new Fuse(searchable, {
        keys: [
            { name: 'id', weight: 0.5 },
            { name: 'taskName', weight: 0.35 },
            { name: 'shortName', weight: 0.15 },
        ],
        threshold: 0.35,
        ignoreLocation: true,
        includeScore: true,
    });

    const result = fuse.search(query, { limit: 1 })[0];
    return result?.item ?? null;
}

const viewtask: Command = {
    name: 'viewtask',
    description: 'View details for a specific task by ID or name.',
    module: CommandModule.Task,
    allowedRoles: [CommandRole.Everyone],

    slashData: new SlashCommandBuilder()
        .setName('viewtask')
        .setDescription('View details for a specific task by ID or name.')
        .addStringOption((option) =>
            option
                .setName('search')
                .setDescription('Task ID or task name.')
                .setRequired(true)
        ),

    async execute({ interaction, services }: { interaction?: ChatInputCommandInteraction; services: ServiceContainer }) {
        if (!interaction) return;

        await interaction.deferReply({ flags: 1 << 6 });

        const taskRepo = services.repos.taskRepo;
        if (!taskRepo) {
            await interaction.editReply('Task repository not available.');
            return;
        }

        const query = interaction.options.getString('search', true);
        const tasks = await taskRepo.getAllTasks();
        if (!tasks.length) {
            await interaction.editReply('No tasks were found in the database.');
            return;
        }

        const bestMatch = resolveBestTaskMatch(tasks, query);
        if (!bestMatch) {
            await interaction.editReply(`No task found matching \`${query}\`.`);
            return;
        }

        const embedData = buildTaskInfoEmbed(bestMatch);
        await interaction.editReply({
            embeds: embedData.embeds,
            files: embedData.files,
        });
    },
};

export default viewtask;
