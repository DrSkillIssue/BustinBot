import { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } from 'discord.js';
import type { ServiceContainer } from '../../core/services/ServiceContainer.js';
import type { Task, TaskCategory } from '../../models/Task.js';

const TASKS_PER_PAGE = 8;
export const CATEGORY_ALL = 'all';

export type CategoryFilter = TaskCategory | typeof CATEGORY_ALL;

export const TASK_LIST_BUTTON = 'listtasks|';

export type TaskListPage = { content: string; embeds: EmbedBuilder[]; components: ActionRowBuilder<ButtonBuilder>[] };

function pageButton(category: CategoryFilter, action: string, page: number, emoji: string, style: ButtonStyle, disabled: boolean): ButtonBuilder {
    return new ButtonBuilder()
        .setCustomId(`${TASK_LIST_BUTTON}${category}|${action}|${page}`)
        .setEmoji(emoji)
        .setStyle(style)
        .setDisabled(disabled);
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

function categoryLabel(category: CategoryFilter): string {
    return category === CATEGORY_ALL ? 'All Categories' : category;
}

export async function buildTaskListPage(services: ServiceContainer, category: CategoryFilter, requestedPage: number): Promise<TaskListPage> {
    const tasks = (await services.repos.taskRepo.getAllTasks())
        .filter((task) => category === CATEGORY_ALL || task.category === category)
        .sort((a, b) => a.id.localeCompare(b.id, undefined, { numeric: true, sensitivity: 'base' }));

    if (!tasks.length) {
        const content = category === CATEGORY_ALL ? 'No tasks were found in the database.' : `No tasks were found for **${category}**.`;
        return { content, embeds: [], components: [] };
    }

    const lastPage = Math.ceil(tasks.length / TASKS_PER_PAGE) - 1;
    const page = Math.min(Math.max(requestedPage, 0), lastPage);
    const embed = new EmbedBuilder()
        .setColor(0xa60000)
        .setTitle(`📋 Task List - ${categoryLabel(category)}`)
        .setDescription(formatTaskTable(tasks.slice(page * TASKS_PER_PAGE, (page + 1) * TASKS_PER_PAGE)))
        .setFooter({ text: `Page ${page + 1}/${lastPage + 1} • ${tasks.length} task${tasks.length === 1 ? '' : 's'}` });
    if (lastPage === 0) return { content: '', embeds: [embed], components: [] };

    const buttons = new ActionRowBuilder<ButtonBuilder>().addComponents(
        pageButton(category, 'start', 0, '⏮️', ButtonStyle.Secondary, page === 0),
        pageButton(category, 'prev', page - 1, '◀️', ButtonStyle.Primary, page === 0),
        pageButton(category, 'next', page + 1, '▶️', ButtonStyle.Primary, page >= lastPage),
        pageButton(category, 'end', lastPage, '⏭️', ButtonStyle.Secondary, page >= lastPage),
    );
    return { content: '', embeds: [embed], components: [buttons] };
}

export function taskListButtonPage(customId: string): { category: CategoryFilter; page: number } {
    const [, category, , page] = customId.split('|');
    return { category: (category ?? CATEGORY_ALL) as CategoryFilter, page: Number.parseInt(page ?? '0', 10) || 0 };
}
