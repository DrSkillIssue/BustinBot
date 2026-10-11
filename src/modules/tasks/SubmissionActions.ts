import { TextChannel, ButtonBuilder, ButtonStyle, ActionRowBuilder, Client, type Message } from 'discord.js';
import type { SubmissionTier, TaskSubmission } from '../../models/TaskSubmission.js';
import { isTier, tierRank } from '../../models/TaskSubmission.js';
import { buildSubmissionEmbed, buildArchiveEmbed, getTierLabel } from './TaskEmbeds.js';
import { isTextChannel } from '../../utils/ChannelUtils.js';
import type { ServiceContainer } from '../../core/services/ServiceContainer.js';
import { isMentionSuppressed, withSuppressedMentions } from '../../utils/MentionUtils.js';

export const MAX_SCREENSHOTS = 10;

async function resolveTextChannel(client: Client, channelId?: string | null): Promise<TextChannel | null> {
    if (!channelId) return null;
    try {
        const channel = await client.channels.fetch(channelId);
        return channel && isTextChannel(channel) ? channel : null;
    } catch (err) {
        console.warn(`[SubmissionActions] Failed to resolve channel ${channelId}:`, err);
        return null;
    }
}

async function resolveVerificationChannel(client: Client, services: ServiceContainer): Promise<TextChannel | null> {
    const guildConfig = await services.guilds.get(services.guildId);
    return resolveTextChannel(client, guildConfig?.channels?.taskVerification);
}

export async function postToAdminChannel(client: Client, submission: TaskSubmission, services: ServiceContainer) {
    const guildConfig = await services.guilds.get(services.guildId);
    const verificationChannelId = guildConfig?.channels?.taskVerification;
    if (!verificationChannelId) {
        console.warn(`[SubmissionActions] Task verification channel not configured for guild ${services.guildId}.`);
        return;
    }

    const channel = await resolveTextChannel(client, verificationChannelId);
    if (!channel) {
        console.warn(`[SubmissionActions] Unable to resolve task verification channel ${verificationChannelId}.`);
        return;
    }

    const taskEvent = await services.repos.taskRepo?.getTaskEventById(submission.taskEventId);
    if (!taskEvent) return;

    const taskLabel = submission.taskName ?? `Task ${submission.taskEventId}`;
    const embed = buildSubmissionEmbed(submission, taskLabel, taskEvent);

    const buttons = new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder()
            .setCustomId(`approve_bronze_${submission.id}`)
            .setLabel('🥉 Bronze')
            .setStyle(ButtonStyle.Primary),
        new ButtonBuilder()
            .setCustomId(`approve_silver_${submission.id}`)
            .setLabel('🥈 Silver')
            .setStyle(ButtonStyle.Primary),
        new ButtonBuilder()
            .setCustomId(`approve_gold_${submission.id}`)
            .setLabel('🥇 Gold')
            .setStyle(ButtonStyle.Primary),
        new ButtonBuilder()
            .setCustomId(`reject_${submission.id}`)
            .setLabel('Reject')
            .setStyle(ButtonStyle.Danger)
    );

    // First message: embed with info and buttons
    const sentMessage = await channel.send({ embeds: [embed], components: [buttons] });
    submission.message = sentMessage.id;

    // Second message: screenshots as file uploads
    if (submission.screenshotUrls?.length > 0) {
        const filesToSend = submission.screenshotUrls.slice(0, 10);
        const suppressMentions = await isMentionSuppressed(services.guilds, services.guildId);
        const sentScreens = await channel.send({
            ...withSuppressedMentions({ content: `Submission screenshots for <@${submission.userId}> — ${taskLabel}:` }, suppressMentions),
            files: filesToSend
        });
        submission.screenshotMessage = sentScreens.id;
    }
}

// Removes a submission's review posts once it is reviewed
export async function removeReviewPost(client: Client, submission: Pick<TaskSubmission, 'id' | 'message' | 'screenshotMessage'>, services: ServiceContainer): Promise<void> {
    const channel = await resolveVerificationChannel(client, services);
    if (!channel) return;

    for (const messageId of [submission.message, submission.screenshotMessage]) {
        if (!messageId) continue;
        try {
            await channel.messages.delete(messageId);
        } catch (err) {
            console.warn(`[SubmissionActions] Failed to remove review message ${messageId} of submission ${submission.id}:`, err);
        }
    }
}

// Tells the member the outcome of their submission. heldTier is the tier they held for the task before this review.
export async function notifyUser(client: Client, submission: TaskSubmission, heldTier: SubmissionTier | null, streakLine?: string): Promise<Message> {
    const user = await client.users.fetch(submission.userId);
    const taskLabel = submission.taskName ?? `Task ${submission.taskEventId}`;

    if (isTier(submission.status)) {
        const tierLabel = getTierLabel(submission.status);
        if (heldTier && tierRank(submission.status) <= tierRank(heldTier)) {
            return user.send(
                `✅ Your submission for **${taskLabel}** has been approved for ${tierLabel} tier. You already hold ${getTierLabel(heldTier)} for this task, so your tier is unchanged.`
            );
        }
        return user.send(`✅ Your submission for **${taskLabel}** has been approved for ${tierLabel} tier!${streakLine ?? ""}`);
    }

    const reason = submission.rejectionReason || 'No reason provided.';
    return user.send(`❌ Your submission for **${taskLabel}** was rejected.\n**Reason:** ${reason}`);
}

// Copies a reviewed submission to the archive channel and returns whether it did. Its screenshots are taken from its
// review post, because Discord's attachment links expire and the post is fetched with fresh ones; so this runs
// before the post is removed.
export async function archiveSubmission(client: Client, submission: TaskSubmission, services: ServiceContainer): Promise<boolean> {
    const guildConfig = await services.guilds.get(services.guildId);
    const archiveChannelId = guildConfig?.channels?.botArchive;
    if (!archiveChannelId) {
        console.warn(`[SubmissionActions] Bot archive channel not configured for guild ${services.guildId}.`);
        return false;
    }

    const archive = await resolveTextChannel(client, archiveChannelId);
    if (!archive) {
        console.warn(`[SubmissionActions] Unable to resolve archive channel ${archiveChannelId}.`);
        return false;
    }

    await archive.send({ embeds: [buildArchiveEmbed(submission)] });

    const verification = await resolveVerificationChannel(client, services);
    const screenshots = submission.screenshotMessage
        ? await verification?.messages.fetch(submission.screenshotMessage).catch(() => null)
        : null;
    if (!screenshots?.attachments.size) {
        console.warn(`[SubmissionActions] Screenshots of submission ${submission.id} are no longer posted; archived without them.`);
        return true;
    }

    const suppressMentions = await isMentionSuppressed(services.guilds, services.guildId);
    await archive.send(withSuppressedMentions({
        content: `Archived screenshots for <@${submission.userId}>:`,
        files: screenshots.attachments.map((attachment) => attachment.url),
    }, suppressMentions));
    return true;
}
