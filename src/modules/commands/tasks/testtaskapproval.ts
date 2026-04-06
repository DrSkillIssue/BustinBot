import { SlashCommandBuilder, ChatInputCommandInteraction } from "discord.js";
import type { Command } from "../../../models/Command.js";
import { CommandModule, CommandRole } from "../../../models/Command.js";
import type { ServiceContainer } from "../../../core/services/ServiceContainer.js";
import { SubmissionStatus } from "../../../models/TaskSubmission.js";
import { getTaskDisplayName } from "../../tasks/TaskEmbeds.js";

const testtaskapproval: Command = {
    name: 'testtaskapproval',
    description: 'Spawn a fake submission in the verification channel for testing the approval flow.',
    module: CommandModule.Task,
    allowedRoles: [CommandRole.BotAdmin],

    slashData: new SlashCommandBuilder()
        .setName('testtaskapproval')
        .setDescription('Spawn a fake submission for testing the approval flow.')
        .addStringOption(opt =>
            opt.setName('tier')
                .setDescription('Pre-select a tier (bronze/silver/gold). Omit for random.')
                .setRequired(false)
                .addChoices(
                    { name: 'Bronze', value: SubmissionStatus.Bronze },
                    { name: 'Silver', value: SubmissionStatus.Silver },
                    { name: 'Gold', value: SubmissionStatus.Gold },
                ))
        .addStringOption(opt =>
            opt.setName('taskid')
                .setDescription('Task event ID (e.g. test-PVM001-123456). Omit for latest.')
                .setRequired(false))
        .addUserOption(opt =>
            opt.setName('user')
                .setDescription('User to attribute the submission to. Omit for yourself.')
                .setRequired(false)),

    async execute({ interaction, services }: { interaction?: ChatInputCommandInteraction, services: ServiceContainer }) {
        if (!interaction) return;

        const taskRepo = services.repos.taskRepo;
        if (!taskRepo) {
            await interaction.reply({ content: '❌ Task repository unavailable.', flags: 1 << 6 });
            return;
        }

        if (!services.tasks) {
            await interaction.reply({ content: '❌ Task service unavailable.', flags: 1 << 6 });
            return;
        }

        // Resolve tier
        const tierArg = interaction.options.getString('tier');
        const tiers = Object.values(SubmissionStatus).filter(s => s === 'bronze' || s === 'silver' || s === 'gold');
        const tier = tiers.find(t => t === tierArg) ?? tiers[Math.floor(Math.random() * tiers.length)];

        // Resolve task event
        const taskIdArg = interaction.options.getString('taskid');
        let taskEvent;
        if (taskIdArg) {
            taskEvent = await taskRepo.getTaskEventById(taskIdArg);
            if (!taskEvent) {
                await interaction.reply({ content: `❌ Task event \`${taskIdArg}\` not found. This expects an event ID (e.g. \`test-PVM001-123456\`), not a task ID. Run \`/testtask\` first, then use the ID from the embed footer.`, flags: 1 << 6 });
                return;
            }
        } else {
            taskEvent = await taskRepo.getLatestTaskEvent();
            if (!taskEvent) {
                await interaction.reply({ content: '❌ No task events found. Run `/testtask` first to create one.', flags: 1 << 6 });
                return;
            }
        }

        // Resolve user
        const userArg = interaction.options.getUser('user');
        const userId = userArg?.id ?? interaction.user.id;

        const taskName = getTaskDisplayName(taskEvent.task, taskEvent.selectedAmount);

        // Use the real submission flow: create → complete
        const submission = await services.tasks.createSubmission(userId, taskEvent.id);
        await services.tasks.completeSubmission(interaction.client, submission.id, [], services, `[Test] Tier hint: ${tier}`);

        const guildConfig = await services.guilds.get(services.guildId);
        const verificationChannelId = guildConfig?.channels?.taskVerification;

        await interaction.reply({
            content: `✅ Test submission posted to <#${verificationChannelId ?? 'unknown'}>.\n` +
                `**Task:** ${taskName}\n` +
                `**User:** <@${userId}>\n` +
                `**Tier hint:** ${tier}\n` +
                `**Submission ID:** \`${submission.id}\``,
            flags: 1 << 6,
        });
    },
};

export default testtaskapproval;
