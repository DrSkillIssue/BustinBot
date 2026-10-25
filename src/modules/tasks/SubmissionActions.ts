import { TextChannel, ButtonBuilder, ButtonStyle, ActionRowBuilder, Client, type Message } from 'discord.js';
import type { SubmissionTier, TaskSubmission } from '../../models/TaskSubmission.js';
import { isTier, tierRank } from '../../models/TaskSubmission.js';
import type { TaskEvent } from '../../models/TaskEvent.js';
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

export interface ReviewPost {
    message: string;
    screenshotMessage?: string;
}

export async function postToAdminChannel(
    client: Client,
    submission: TaskSubmission,
    event: TaskEvent,
    heldTier: SubmissionTier | null,
    services: ServiceContainer
): Promise<ReviewPost> {
    const channel = await resolveVerificationChannel(client, services);
    if (!channel) {
        throw new Error(`The task verification channel for guild ${services.guildId} is not configured or can't be reached.`);
    }

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

    const details = await channel.send({ embeds: [buildSubmissionEmbed(submission, event, heldTier)], components: [buttons] });
    if (submission.screenshotUrls.length === 0) return { message: details.id };

    try {
        const suppressMentions = await isMentionSuppressed(services.guilds, services.guildId);
        const screenshots = await channel.send({
            ...withSuppressedMentions({ content: `Submission screenshots for <@${submission.userId}> — ${submission.taskName ?? `Task ${submission.taskEventId}`}:` }, suppressMentions),
            files: submission.screenshotUrls.slice(0, MAX_SCREENSHOTS),
        });
        return { message: details.id, screenshotMessage: screenshots.id };
    } catch (err) {
        await details.delete().catch((deleteErr: unknown) => console.warn(`[SubmissionActions] Failed to remove the partly posted submission ${submission.id}:`, deleteErr));
        throw err;
    }
}

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
