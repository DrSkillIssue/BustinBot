import { ButtonInteraction, StringSelectMenuInteraction, Message, Client, ModalSubmitInteraction, ModalBuilder, TextInputBuilder, TextInputStyle, ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags } from 'discord.js';
import { SubmissionStatus, TIERS, type SubmissionTier, type TaskSubmission } from '../../models/TaskSubmission.js';
import type { ServiceContainer } from '../../core/services/ServiceContainer.js';
import { getTaskDisplayName, getTierLabel } from './TaskEmbeds.js';
import { isMentionSuppressed, withSuppressedMentions } from '../../utils/MentionUtils.js';
import { raisedTier, type ReviewResult } from './TaskService.js';

const MAX_SCREENSHOTS = 10;

// STEP 1: "Submit Screenshot" button clicked on task embed
export async function handleSubmitButton(interaction: ButtonInteraction, services: ServiceContainer) {
    await interaction.deferReply({ flags: 1 << 6 });

    const parts = interaction.customId.split('-');
    const taskEventId = parts.slice(2).join('-');

    if (!taskEventId) {
        await interaction.editReply({ content: "Task ID missing from interaction." });
        return;
    }

    const taskRepo = services.repos.taskRepo;
    if (!taskRepo) {
        await interaction.editReply({ content: "Task repository unavailable." });
        return;
    }

    const taskEvent = await taskRepo.getTaskEventById(taskEventId);
    if (!taskEvent) {
        await interaction.editReply({
            content: "That task is no longer active. Please check the latest task announcement.",
        });
        return;
    }

    const taskName = getTaskDisplayName(taskEvent.task, taskEvent.selectedAmount);
    const userId = interaction.user.id;

    services.tasks.setPendingTask(userId, taskEventId);

    try {
        await interaction.user.send(
            `Please upload your screenshot(s) for **${taskName}** and include any notes/comments in the same message.`
        );
        await interaction.editReply({
            content: `Check your DMs to submit your screenshot(s) for **${taskName}**!`,
        });
    } catch {
        services.tasks.consumePendingTask(userId);
        await interaction.editReply({
            content: "I couldn't send you a DM. Please enable direct messages from server members and try again."
        });
    }
}

// STEP 2: User confirms task from select menu
export async function handleTaskSelect(interaction: StringSelectMenuInteraction, services: ServiceContainer) {
    const [, , userId] = interaction.customId.split('-');

    if (!userId) {
        await interaction.reply({
            content: "User ID missing from selection.",
            flags: 1 << 6
        });
        return;
    }

    const selectedTaskEventId = interaction.values[0];
    if (!selectedTaskEventId) {
        await interaction.reply({
            content: "No task selected.",
            flags: 1 << 6
        });
        return;
    }

    services.tasks.setPendingTask(userId, selectedTaskEventId);
    try {
        const submission = await services.tasks.createSubmission(userId, selectedTaskEventId);

        await interaction.reply({
            content: `Thank you for confirming. Now upload your screenshot for **${submission.taskName ?? 'your task'}** and include any notes/comments in the same message.`,
            flags: 64
        });
    } catch (error) {
        console.error('[TaskSelect] Failed to create submission:', error);
        await interaction.reply({
            content: "There was a problem creating your submission. Please try again or contact a Task Admin.",
            flags: 64
        });
    }
}

// STEP 3: User sends screenshot + notes in DM
export async function handleDirectMessage(message: Message, client: Client, services: ServiceContainer) {
    if (message.author.bot || message.channel.type !== 1) return;

    const taskEventId = services.tasks.consumePendingTask(message.author.id);
    const pending = taskEventId ? await services.tasks.getPendingSubmission(message.author.id, taskEventId) : undefined;
    if (!pending && !taskEventId) return;

    let submission = pending;
    if (!submission) {
        try {
            submission = await services.tasks.createSubmission(message.author.id, taskEventId!);
        } catch (error) {
            console.error('[TaskDM] Failed to create submission from DM:', error);
            await message.reply("Couldn't locate the task details. Please try submitting again or contact a Task Admin.");
            return;
        }
    }

    if (!submission) return;

    const attachments = message.attachments;

    const imageUrls: string[] = [];
    attachments.forEach((attachment) => {
        if (attachment.contentType?.startsWith("image/")) {
            imageUrls.push(attachment.url);
        }
    });

    if (imageUrls.length === 0) {
        await message.reply("Please attach at least one image for your submission.");
        return;
    }

    const notes = message.content.trim() || undefined;

    const limitedImages = imageUrls.slice(0, MAX_SCREENSHOTS);
    await services.tasks.completeSubmission(client, submission.id, limitedImages, services, notes);
    await message.reply(`✅ Submission for **${submission.taskName ?? 'your task'}** received with ${limitedImages.length} screenshot${limitedImages.length === 1 ? '' : 's'} and sent for review!`);
}

function alreadyReviewedMessage(submission: TaskSubmission): string {
    return `⚠️ This submission has already been reviewed (${submission.status}). Another admin may have processed it.`;
}

// How an admin's reply ends: whether the reviewed submission reached the archive channel
function archivedEnding(archived: boolean): string {
    return archived ? ' and archived.' : ". It couldn't be archived; check the logs.";
}

function formatTier(tier: SubmissionTier): string {
    return tier.charAt(0).toUpperCase() + tier.slice(1);
}

// STEP 4: Admin clicks Approve/Reject
export async function handleAdminButton(interaction: ButtonInteraction, services: ServiceContainer) {
    const customId = interaction.customId;

    // Second-step cancel action from confirmation prompt
    if (customId.startsWith('review-cancel|')) {
        await interaction.update({
            content: 'Review action cancelled. No changes were made.',
            components: [],
        });
        return;
    }

    // Second-step confirm action from confirmation prompt
    if (customId.startsWith('review-confirm|')) {
        const parts = customId.split('|');
        const confirmAction = parts[1];
        const maybeTier = parts[2];
        const submissionId = parts.slice(3).join('|').trim();

        if (!confirmAction || !submissionId) {
            await interaction.update({
                content: 'Invalid confirmation payload. Please try again.',
                components: [],
            });
            return;
        }

        if (confirmAction === 'reject') {
            const modal = new ModalBuilder()
                .setCustomId(`reject_reason_${submissionId}`)
                .setTitle('Reject Submission')
                .addComponents(
                    new ActionRowBuilder<TextInputBuilder>().addComponents(
                        new TextInputBuilder()
                            .setCustomId('reason')
                            .setLabel('Rejection Reason')
                            .setStyle(TextInputStyle.Paragraph)
                            .setRequired(false)
                    )
                );
            await interaction.showModal(modal);
            return;
        }

        const tier = TIERS.find((candidate) => candidate === maybeTier);
        if (!tier) {
            await interaction.update({
                content: 'Invalid tier selected for approval.',
                components: [],
            });
            return;
        }

        await interaction.deferUpdate();
        await interaction.editReply({
            content: `⏳ Processing approval...`,
            components: [],
        });

        const reviewerId = interaction.user.id;
        let outcome: ReviewResult;
        try {
            outcome = await services.tasks.review(interaction.client, { submissionId, reviewedBy: reviewerId, decision: tier }, services);
        } catch (err) {
            console.error('[TaskInteractions] Tier approval failed:', err);
            await interaction.editReply({ content: "❌ Failed to process tier approval. Check logs for details." });
            return;
        }

        if (outcome.result === 'notFound') {
            await interaction.editReply({ content: 'Submission not found.' });
            return;
        }
        if (outcome.result === 'alreadyReviewed') {
            await interaction.editReply({ content: alreadyReviewedMessage(outcome.submission) });
            return;
        }

        const { submission, heldTier, archived } = outcome;
        const taskLabel = submission.taskName ?? `Task ${submission.taskEventId}`;
        const rolls = `${submission.prizeRolls ?? 0} roll${(submission.prizeRolls ?? 0) === 1 ? '' : 's'}`;
        // Approving below the tier the member already holds resolves the submission without changing their tier
        const keptTier = raisedTier(outcome) ? null : heldTier;
        const approvalMessage = keptTier
            ? `✅ <@${reviewerId}> approved **${formatTier(tier)} tier** for submission by <@${submission.userId}> on **${taskLabel}**. They already hold ${getTierLabel(keptTier)} for this task, so nothing changed.`
            : `✅ <@${reviewerId}> approved **${formatTier(tier)} tier** for submission by <@${submission.userId}> on **${taskLabel}** (${rolls}).`;

        if (interaction.channel?.isSendable()) {
            const suppressMentions = await isMentionSuppressed(services.guilds, interaction.guildId);
            await interaction.channel.send(withSuppressedMentions({ content: approvalMessage }, suppressMentions));
        }

        await interaction.editReply({
            content: keptTier
                ? `✅ Submission approved for **${formatTier(tier)} tier**${archivedEnding(archived)} The member already holds ${getTierLabel(keptTier)} for this task, so their tier is unchanged.`
                : `✅ Submission approved for **${formatTier(tier)} tier** (${rolls})${archivedEnding(archived)}`,
            components: []
        });
        return;
    }

    let action: string | undefined;
    let submissionId: string | undefined;
    let maybeTier: string | undefined;

    if (customId.startsWith('reject_')) {
        action = 'reject';
        submissionId = customId.slice('reject_'.length).trim();
    } else if (customId.startsWith('approve_')) {
        action = 'approve';
        const parts = customId.split('_');
        maybeTier = parts[1];
        submissionId = parts.slice(2).join('_').trim();
    }

    if (!submissionId) {
        await interaction.reply({ content: "Submission ID missing from interaction.", flags: MessageFlags.Ephemeral });
        return;
    }
    if (!action) {
        await interaction.reply({ content: "Unknown task action.", flags: MessageFlags.Ephemeral });
        return;
    }

    if (action === 'reject') {
        const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
            new ButtonBuilder()
                .setCustomId(`review-confirm|reject||${submissionId}`)
                .setLabel('Confirm Reject')
                .setStyle(ButtonStyle.Danger),
            new ButtonBuilder()
                .setCustomId(`review-cancel|${submissionId}`)
                .setLabel('Cancel')
                .setStyle(ButtonStyle.Secondary)
        );

        await interaction.reply({
            content: 'Are you sure you want to reject this submission?',
            components: [row],
            flags: MessageFlags.Ephemeral,
        });
        return;
    }

    // Handle tier approvals
    const tier = TIERS.find((candidate) => candidate === maybeTier);
    if (!tier) {
        await interaction.reply({ content: "Unknown task action.", flags: MessageFlags.Ephemeral });
        return;
    }

    const formattedTier = formatTier(tier);
    const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder()
            .setCustomId(`review-confirm|approve|${tier}|${submissionId}`)
            .setLabel(`Confirm ${formattedTier}`)
            .setStyle(ButtonStyle.Primary),
        new ButtonBuilder()
            .setCustomId(`review-cancel|${submissionId}`)
            .setLabel('Cancel')
            .setStyle(ButtonStyle.Secondary)
    );

    await interaction.reply({
        content: `Are you sure you want to approve this submission for **${formattedTier}** tier?`,
        components: [row],
        flags: MessageFlags.Ephemeral,
    });
}

// STEP 5: Modal submit for rejection reason
export async function handleRejectionModal(interaction: ModalSubmitInteraction, services: ServiceContainer) {
    // Acknowledge the modal submission ephemerally
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const reviewerId = interaction.user.id;
    const reason = interaction.fields.getTextInputValue('reason');
    const submissionId = interaction.customId.slice('reject_reason_'.length);
    if (!submissionId) {
        await interaction.editReply({ content: "Submission ID missing from interaction." });
        return;
    }

    let outcome: ReviewResult;
    try {
        outcome = await services.tasks.review(
            interaction.client,
            { submissionId, reviewedBy: reviewerId, decision: SubmissionStatus.Rejected, rejectionReason: reason },
            services
        );
    } catch (err) {
        console.error('[TaskInteractions] Rejection failed:', err);
        await interaction.editReply({ content: "❌ Failed to reject the submission. Check logs for details." });
        return;
    }

    if (outcome.result === 'notFound') {
        await interaction.editReply({ content: 'Submission not found.' });
        return;
    }
    if (outcome.result === 'alreadyReviewed') {
        await interaction.editReply({ content: alreadyReviewedMessage(outcome.submission) });
        return;
    }

    const { submission, archived } = outcome;
    await interaction.editReply({
        content: `❌ Submission rejected${archivedEnding(archived)}`
    });

    // Post a visible message in the admin channel
    const guildConfig = await services.guilds.get(services.guildId);
    const verificationChannelId = guildConfig?.channels?.taskVerification;
    if (!verificationChannelId) {
        console.warn(`[TaskInteractions] Task verification channel not configured for guild ${services.guildId}.`);
        return;
    }
    try {
        const adminChannel = await interaction.client.channels.fetch(verificationChannelId);
        if (adminChannel?.isSendable()) {
            const suppressMentions = await isMentionSuppressed(services.guilds, interaction.guildId);
            const rejectionMessage = `❌ <@${reviewerId}> rejected submission for **${submission.taskName ?? `Task ${submission.taskEventId}`}** by <@${submission.userId}>. Reason: ${reason || "No reason provided"}.${archived ? " Submission moved to archive channel." : ""}`;
            await adminChannel.send(withSuppressedMentions({ content: rejectionMessage }, suppressMentions));
        }
    } catch (err) {
        console.warn(`[TaskInteractions] Failed to notify task admins in channel ${verificationChannelId}:`, err);
    }
}
