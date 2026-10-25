import { ButtonInteraction, Message, Client, ModalSubmitInteraction, ModalBuilder, LabelBuilder, TextInputBuilder, TextInputStyle, ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags } from 'discord.js';
import { SubmissionStatus, TIERS, type SubmissionTier, type TaskSubmission } from '../../models/TaskSubmission.js';
import type { ServiceContainer } from '../../core/services/ServiceContainer.js';
import { getTaskDisplayName, getTierLabel } from './TaskEmbeds.js';
import { isMentionSuppressed, withSuppressedMentions } from '../../utils/MentionUtils.js';
import { raisedTier, type ReviewResult } from './TaskService.js';

// STEP 1: "Submit Screenshot" button clicked on task embed
export async function handleSubmitButton(interaction: ButtonInteraction, services: ServiceContainer) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const parts = interaction.customId.split('-');
    const taskEventId = parts.slice(2).join('-');

    if (!taskEventId) {
        await interaction.editReply({ content: "Task ID missing from interaction." });
        return;
    }

    const taskRepo = services.repos.taskRepo;

    const taskEvent = await taskRepo.getTaskEventById(taskEventId);
    if (!taskEvent) {
        await interaction.editReply({
            content: "That task is no longer active. Please check the latest task announcement.",
        });
        return;
    }

    const taskName = getTaskDisplayName(taskEvent.task, taskEvent.selectedAmount);

    await services.tasks.startSubmission(interaction.user.id, taskEventId);

    try {
        await interaction.user.send(
            `Please upload your screenshot(s) for **${taskName}** and include any notes/comments in the same message.`
        );
        await interaction.editReply({
            content: `Check your DMs to submit your screenshot(s) for **${taskName}**!`,
        });
    } catch {
        await interaction.editReply({
            content: "I couldn't send you a DM. Please enable direct messages from server members and try again."
        });
    }
}

// STEP 2: Member DMs their screenshots and notes
export async function handleDirectMessage(message: Message, client: Client, guildServices: ServiceContainer[]) {
    if (message.author.bot) return;

    const drafts = await Promise.all(guildServices.map(async (services) => ({
        services,
        draft: await services.tasks.getSubmissionDraft(message.author.id),
    })));
    const latest = drafts
        .flatMap(({ services, draft }) => (draft ? [{ services, draft }] : []))
        .sort((a, b) => b.draft.createdAt.getTime() - a.draft.createdAt.getTime())[0];
    if (!latest) return;
    const { services, draft } = latest;

    const imageUrls = message.attachments
        .filter((attachment) => attachment.contentType?.startsWith("image/"))
        .map((attachment) => attachment.url);
    if (imageUrls.length === 0) {
        await message.reply("Please attach at least one image for your submission.");
        return;
    }

    try {
        const outcome = await services.tasks.submit(client, draft, imageUrls, message.content.trim() || undefined, services);
        switch (outcome.result) {
            case 'submitted': {
                const { taskName, screenshotUrls } = outcome.submission;
                await message.reply(`✅ Submission for **${taskName ?? 'your task'}** received with ${screenshotUrls.length} screenshot${screenshotUrls.length === 1 ? '' : 's'} and sent for review!`);
                break;
            }
            case 'taskNotFound':
                await message.reply("Couldn't locate the task details. Please try submitting again or contact a Task Admin.");
                break;
            case 'adminsUnreachable':
                await message.reply("I couldn't pass your submission on to the Task Admins just now. Please send it again later, or contact a Task Admin.");
                break;
            case 'alreadySubmitted':
                await message.reply("I've already received your submission for this task. To send another, click Submit on the task again.");
                break;
        }
    } catch (err) {
        console.error('[TaskDM] Failed to store submission:', err);
        await message.reply("Something went wrong saving your submission. Please send it again.");
    }
}

function alreadyReviewedMessage(submission: TaskSubmission): string {
    return `⚠️ This submission has already been reviewed (${submission.status}). Another admin may have processed it.`;
}

function archivedEnding(archived: boolean): string {
    return archived ? ' and archived.' : ". It couldn't be archived; check the logs.";
}

function formatTier(tier: SubmissionTier): string {
    return tier.charAt(0).toUpperCase() + tier.slice(1);
}

// STEP 3: An admin approves at a tier or rejects
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
                .addLabelComponents(
                    new LabelBuilder()
                        .setLabel('Rejection Reason')
                        .setTextInputComponent(
                            new TextInputBuilder()
                                .setCustomId('reason')
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

// STEP 4: The admin sends the rejection reason form
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
    // Update the ephemeral reply
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
