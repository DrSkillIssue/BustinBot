import { DateTime } from "luxon";
import type { Client } from 'discord.js';
import type { Reminder } from "../../models/Reminder.js";
import type { MovieEvent } from "../../models/MovieEvent.js";
import type { ServiceContainer } from "../../core/services/ServiceContainer.js";
import { isMentionSuppressed, withSuppressedMentions } from "../../utils/MentionUtils.js";
import { resolveMovieChannel } from "./MovieChannel.js";

// The reminders sent before each movie night, by how long before the start
const MOVIE_REMINDERS = [
    { label: '2 hours before', offset: { hours: 2 } },
    { label: '30 mins before', offset: { minutes: 30 } },
    { label: 'start time', offset: { minutes: 0 } },
] as const;

// A reminder that comes due while the bot is down is still sent if the bot is back within this long; after that
// it would arrive too late to be useful
const REMINDER_GRACE_MS = 15 * 60 * 1000;

export function getPendingReminders(movieStart: DateTime, now: DateTime = DateTime.utc()): Reminder[] {
    return MOVIE_REMINDERS
        .map(({ label, offset }) => ({ sendAt: movieStart.minus(offset), label }))
        .filter(({ sendAt }) => sendAt > now);
}

function formatRemaining(totalMinutes: number): string {
    const hours = Math.floor(totalMinutes / 60);
    const minutes = totalMinutes % 60;
    const hourText = hours > 0 ? `${hours} hour${hours > 1 ? "s" : ""}` : "";
    const minuteText = minutes > 0 || hours === 0 ? `${minutes} minute${minutes !== 1 ? "s" : ""}` : "";
    return [hourText, minuteText].filter(Boolean).join(" and ");
}

// Sends the movie night's reminder that has come due, once. When several came due together (the bot was down),
// only the latest is sent, and only within the grace period.
export async function sendDueReminders(client: Client, services: ServiceContainer, event: MovieEvent, now: Date): Promise<void> {
    const movieRepo = services.repos.movieRepo;

    const start = DateTime.fromJSDate(event.startTime);
    const due = MOVIE_REMINDERS
        .map(({ label, offset }) => ({ label, sendAt: start.minus(offset).toJSDate() }))
        .filter(({ label, sendAt }) => sendAt <= now && !(event.remindersSent ?? []).includes(label));
    if (!due.length) return;

    // Without a channel the reminders stay unsent, to go out on a later sweep within the grace period
    const channel = await resolveMovieChannel(client, services);
    if (!channel) return;

    const claimed = await movieRepo.claimReminders(event.id, due.map(({ label }) => label));
    const latest = due.filter(({ label }) => claimed.includes(label)).at(-1);
    if (!latest) return;
    if (now.getTime() - latest.sendAt.getTime() > REMINDER_GRACE_MS) {
        console.warn(`[MovieReminders] Skipped the "${latest.label}" reminder for ${event.id}: it came due while the bot was down.`);
        return;
    }

    const guildConfig = await services.guilds.get(services.guildId);
    const mention = guildConfig?.roles?.movieUser ? `<@&${guildConfig.roles.movieUser}>` : "";
    const voiceChannelId = event.voiceChannelId ?? guildConfig?.channels?.movieVC;
    const voiceMention = voiceChannelId ? `<#${voiceChannelId}>` : "the movie voice channel";

    const activePoll = await movieRepo.getActivePoll();
    const title = event.movie.id !== 'TBD' ? event.movie.title : null;
    const stateLine = activePoll?.isActive
        ? `A movie poll is currently running! Go cast your vote before it closes.`
        : title
            ? `We will be watching **${title}**!`
            : `No movie has been selected yet — stay tuned!`;

    const remaining = formatRemaining(Math.max(Math.round((event.startTime.getTime() - now.getTime()) / 60000), 0));
    const content = latest.label === 'start time'
        ? `${mention} Movie night is starting **now**! Join us in ${voiceMention} 🎬\n${stateLine}`
        : `${mention} Movie night starts in **${remaining}** (at <t:${Math.floor(start.toSeconds())}:t>)! ${stateLine}`;

    const suppressMentions = await isMentionSuppressed(services.guilds, services.guildId);
    await channel.send(withSuppressedMentions({ content: content.trim() }, suppressMentions));
    console.log(`[MovieReminders] Sent "${latest.label}" reminder for ${event.id}.`);
}
