import {
    SlashCommandBuilder,
    ChatInputCommandInteraction,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    ComponentType,
    Message,
    EmbedBuilder,
} from 'discord.js';
import type { Command } from '../../../models/Command.js';
import { CommandModule, CommandRole } from '../../../models/Command.js';
import type { ServiceContainer } from '../../../core/services/ServiceContainer.js';
import type { Task } from '../../../models/Task.js';
import { TaskCategory } from '../../../models/Task.js';

const TASKS_PER_PAGE = 8;
const CATEGORY_ALL = 'all';

type CategoryFilter = TaskCategory | typeof CATEGORY_ALL;

function buildNavButtons(currentPage: number, totalPages: number) {
    return new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder()
            .setCustomId('listtasks_page_start')
            .setEmoji('⏮️')
            .setStyle(ButtonStyle.Secondary)
            .setDisabled(currentPage === 0),
        new ButtonBuilder()
            .setCustomId('listtasks_page_prev')
            .setEmoji('◀️')
            .setStyle(ButtonStyle.Primary)
            .setDisabled(currentPage === 0),
        new ButtonBuilder()
            .setCustomId('listtasks_page_next')
            .setEmoji('▶️')
            .setStyle(ButtonStyle.Primary)
            .setDisabled(currentPage >= totalPages - 1),
        new ButtonBuilder()
            .setCustomId('listtasks_page_end')
            .setEmoji('⏭️')
            .setStyle(ButtonStyle.Secondary)
            .setDisabled(currentPage >= totalPages - 1),
    );
}

function truncate(text: string, maxLength: number): string {
    if (text.length <= maxLength) return text;
    if (maxLength <= 3) return text.slice(0, maxLength);
    return `${text.slice(0, maxLength - 3)}...`;
}

function formatTaskTable(tasks: Task[]): string {
    const formattedRows = tasks.map((task) => ({
        id: truncate(task.id, 14),
        name: truncate(task.shortName?.trim() || task.taskName, 40),
        bronze: String(task.amtBronze),
        silver: String(task.amtSilver),
        gold: String(task.amtGold),
    }));

    const idWidth = Math.max('ID'.length, ...formattedRows.map((row) => row.id.length));
    const nameWidth = Math.max('Task Name'.length, ...formattedRows.map((row) => row.name.length));
    const bronzeWidth = Math.max('B'.length, ...formattedRows.map((row) => row.bronze.length));
    const silverWidth = Math.max('S'.length, ...formattedRows.map((row) => row.silver.length));
    const goldWidth = Math.max('G'.length, ...formattedRows.map((row) => row.gold.length));

    const header = `${'ID'.padEnd(idWidth)}  ${'Task Name'.padEnd(nameWidth)}  ${'B'.padStart(bronzeWidth)}  ${'S'.padStart(silverWidth)}  ${'G'.padStart(goldWidth)}`;
    const rows = formattedRows.map(
        (row) =>
            `${row.id.padEnd(idWidth)}  ${row.name.padEnd(nameWidth)}  ${row.bronze.padStart(bronzeWidth)}  ${row.silver.padStart(silverWidth)}  ${row.gold.padStart(goldWidth)}`
    );

    return ['```', header, ...rows, '```'].join('\n');
}

function paginateTasks(tasks: Task[], page: number): Task[] {
    const start = page * TASKS_PER_PAGE;
    return tasks.slice(start, start + TASKS_PER_PAGE);
}

function categoryLabel(category: CategoryFilter): string {
    return category === CATEGORY_ALL ? 'All Categories' : category;
}

const listtasks: Command = {
    name: 'listtasks',
    description: 'View the full task list with optional category filtering.',
    module: CommandModule.Task,
    allowedRoles: [CommandRole.Everyone],

    slashData: new SlashCommandBuilder()
        .setName('listtasks')
        .setDescription('View the full task list with optional category filtering.')
        .addStringOption((option) =>
            option
                .setName('category')
                .setDescription('Filter tasks by category.')
                .setRequired(false)
                .addChoices(
                    { name: 'All', value: CATEGORY_ALL },
                    { name: TaskCategory.PvM, value: TaskCategory.PvM },
                    { name: TaskCategory.Skilling, value: TaskCategory.Skilling },
                    { name: TaskCategory.MinigameMisc, value: TaskCategory.MinigameMisc },
                    { name: TaskCategory.Leagues, value: TaskCategory.Leagues },
                )
        ),

    async execute({ interaction, services }: { interaction?: ChatInputCommandInteraction; services: ServiceContainer }) {
        if (!interaction) return;

        await interaction.deferReply({ flags: 1 << 6 });

        const taskRepo = services.repos.taskRepo;
        if (!taskRepo) {
            await interaction.editReply('Task repository not available.');
            return;
        }

        const category = (interaction.options.getString('category') as CategoryFilter | null) ?? CATEGORY_ALL;

        const allTasks = await taskRepo.getAllTasks();
        const filteredTasks = allTasks
            .filter((task) => category === CATEGORY_ALL || task.category === category)
            .sort((a, b) => a.id.localeCompare(b.id, undefined, { numeric: true, sensitivity: 'base' }));

        if (!filteredTasks.length) {
            await interaction.editReply(
                category === CATEGORY_ALL
                    ? 'No tasks were found in the database.'
                    : `No tasks were found for **${category}**.`
            );
            return;
        }

        let currentPage = 0;
        const totalPages = Math.ceil(filteredTasks.length / TASKS_PER_PAGE);

        const buildEmbed = (page: number) => {
            const pageTasks = paginateTasks(filteredTasks, page);
            return new EmbedBuilder()
                .setColor(0xa60000)
                .setTitle(`📋 Task List - ${categoryLabel(category)}`)
                .setDescription(formatTaskTable(pageTasks))
                .setFooter({
                    text: `Page ${page + 1}/${totalPages} • ${filteredTasks.length} task${filteredTasks.length === 1 ? '' : 's'}`,
                });
        };

        const components = totalPages > 1 ? [buildNavButtons(currentPage, totalPages)] : [];
        const reply = (await interaction.editReply({
            embeds: [buildEmbed(currentPage)],
            components,
        })) as Message;

        if (totalPages <= 1) return;

        const collector = reply.createMessageComponentCollector({
            componentType: ComponentType.Button,
            time: 180000,
            filter: (btnInt) => btnInt.user.id === interaction.user.id,
        });

        collector.on('collect', async (btnInt) => {
            switch (btnInt.customId) {
                case 'listtasks_page_start':
                    currentPage = 0;
                    break;
                case 'listtasks_page_prev':
                    currentPage = Math.max(0, currentPage - 1);
                    break;
                case 'listtasks_page_next':
                    currentPage = Math.min(totalPages - 1, currentPage + 1);
                    break;
                case 'listtasks_page_end':
                    currentPage = totalPages - 1;
                    break;
                default:
                    break;
            }

            await btnInt.deferUpdate();
            await interaction.editReply({
                embeds: [buildEmbed(currentPage)],
                components: [buildNavButtons(currentPage, totalPages)],
            });
        });

        collector.on('end', async () => {
            await interaction.editReply({ components: [] }).catch(() => undefined);
        });
    },
};

export default listtasks;
