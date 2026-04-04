import type { Movie } from '../../models/Movie.js';
import type { MovieEvent } from '../../models/MovieEvent.js';
import { DateTime } from 'luxon';
import type { ServiceContainer } from '../../core/services/ServiceContainer.js';
import { Client } from 'discord.js';
import { initAttendanceTracking, finaliseAttendance, getActiveVoiceMemberIds } from './MovieAttendance.js';
import { SchedulerStatusReporter } from '../../core/services/SchedulerStatusReporter.js';
import { resolveGuildContext } from './MovieLocalSelector.js';
import { normaliseFirestoreDates } from '../../utils/DateUtils.js';

const autoEndTimeouts = new Map<string, NodeJS.Timeout>();

function getAutoEndTimerKey(guildId: string | null | undefined): string {
    return guildId && guildId.trim() ? guildId : 'global';
}

function getDateValue(value: unknown): Date | null {
    if (value instanceof Date) return value;
    if (!value) return null;

    const maybeTimestamp = value as { toDate?: () => Date };
    if (typeof maybeTimestamp.toDate === 'function') {
        return maybeTimestamp.toDate();
    }

    if (typeof value === 'string') {
        const parsed = new Date(value);
        return Number.isNaN(parsed.getTime()) ? null : parsed;
    }

    return null;
}

function getStartMillis(event: MovieEvent): number {
    const start = getDateValue(event.startTime);
    return start ? start.getTime() : 0;
}

function isPlaceholderMovie(movie: Movie | null | undefined): boolean {
    if (!movie) return true;
    const id = (movie.id || '').trim().toLowerCase();
    const title = (movie.title || '').trim().toLowerCase();
    if (title && title !== 'tbd') return false;
    if (id && id !== 'tbd') return false;
    return title === '' || title === 'tbd' || id === 'tbd';
}

function getMostRecentlySelectedUnwatchedMovie(movies: Movie[]): Movie | null {
    const selectedUnwatched = movies
        .filter((movie) => !movie.watched && movie.selectedAt)
        .map((movie) => {
            const selectedAt = getDateValue(movie.selectedAt);
            return selectedAt ? { movie, selectedAt } : null;
        })
        .filter((entry): entry is { movie: Movie; selectedAt: Date } => entry !== null)
        .sort((a, b) => b.selectedAt.getTime() - a.selectedAt.getTime());

    return selectedUnwatched[0]?.movie ?? null;
}

async function resolveEventToFinish(
    services: ServiceContainer,
    targetEventId?: string
): Promise<MovieEvent | null> {
    const movieRepo = services.repos.movieRepo;
    if (!movieRepo) return null;

    if (typeof movieRepo.getAllEvents !== 'function') {
        return movieRepo.getActiveEvent();
    }

    const allEvents = await movieRepo.getAllEvents();
    const activeEvents = allEvents.filter((event) => !event.completed);
    if (!activeEvents.length) return null;

    if (targetEventId) {
        const matched = activeEvents.find((event) => event.id === targetEventId);
        if (matched) return matched;
    }

    const now = Date.now();
    const startedEvents = activeEvents.filter((event) => getStartMillis(event) <= now);
    const candidates = startedEvents.length ? startedEvents : activeEvents;

    candidates.sort((a, b) => getStartMillis(b) - getStartMillis(a));
    return candidates[0] ?? null;
}

export function clearScheduledMovieAutoEnd(guildId?: string): void {
    if (!guildId) {
        for (const timeout of autoEndTimeouts.values()) {
            clearTimeout(timeout);
        }
        autoEndTimeouts.clear();
        return;
    }

    const key = getAutoEndTimerKey(guildId);
    const timeout = autoEndTimeouts.get(key);
    if (timeout) {
        clearTimeout(timeout);
        autoEndTimeouts.delete(key);
    }
}

async function notifySubmitterMovieEnded(client: Client, addedBy: string, finishedMovie: Movie, remainingSlots: number, services: ServiceContainer) {
    try {
        const { guildName } = await resolveGuildContext(client, services);

        const user = await client.users.fetch(addedBy);
        if (!user) return;

        const plural = remainingSlots === 1 ? "movie" : "movies";
        const message =
            `Hey <@${addedBy}>, your movie **${finishedMovie.title}** has been watched as part of a movie night in **${guildName}**. You can now add **${remainingSlots} more ${plural}** to the list!`;

        await user.send(message);
        console.log(`[MovieLifecycle] Sent DM to ${user.tag} about ended movie: ${finishedMovie.title}`);
    } catch (err) {
        console.warn(`[MovieLifecycle] Could not DM ${addedBy} - likely has DMs disabled.`, err);
    }
}

// Marks the current movie night as completed and archives it
export async function finishMovieNight(
    endedBy: string,
    services: ServiceContainer,
    client: Client,
    targetEventId?: string
): Promise<{ success: boolean; message: string; finishedMovie?: Movie }> {
    const movieRepo = services.repos.movieRepo;
    if (!movieRepo) {
        console.error('[MovieLifecycle] Movie repository not found.');
        return { success: false, message: 'Internal error: repository missing.' };
    }

    try {
        clearScheduledMovieAutoEnd(services.guildId);

        const latestEvent = await resolveEventToFinish(services, targetEventId);
        if (!latestEvent) {
            return { success: false, message: 'No active movie event found to end.' };
        }

        const allMovies = (await movieRepo.getAllMovies()).map((movie) => normaliseFirestoreDates(movie));
        const eventMovie = latestEvent.movie ? normaliseFirestoreDates(latestEvent.movie) : null;
        const movieFromDb =
            eventMovie?.id
                ? allMovies.find((movie) => movie.id === eventMovie.id) ?? null
                : null;
        const selectedMovie = getMostRecentlySelectedUnwatchedMovie(allMovies);
        const resolvedMovie = movieFromDb ?? selectedMovie ?? (!isPlaceholderMovie(eventMovie) ? eventMovie : null);

        let finishedMovie: Movie | undefined;
        if (resolvedMovie) {
            finishedMovie = {
                ...resolvedMovie,
                watched: true,
                watchedAt: new Date(),
                selectedAt: undefined,
                selectedBy: undefined,
            };
            await movieRepo.upsertMovie(finishedMovie);
            console.log(`[MovieLifecycle] Movie night ended by ${endedBy}: ${finishedMovie.title}`);
        } else {
            console.warn(
                `[MovieLifecycle] Movie night ended by ${endedBy}, but no selected movie record could be resolved for event ${latestEvent.id}.`
            );
        }

        await movieRepo.createMovieEvent({
            ...latestEvent,
            completed: true,
            completedAt: new Date(),
            hostedBy: latestEvent.hostedBy,
            movie: finishedMovie ?? latestEvent.movie,
        });

        if (finishedMovie?.addedBy) {
            try {
                const refreshedMovies = await movieRepo.getAllMovies();
                const userMovies = refreshedMovies.filter(m => m.addedBy === finishedMovie.addedBy && !m.watched);
                const remainingSlots = Math.max(0, 3 - userMovies.length);

                await notifySubmitterMovieEnded(client, finishedMovie.addedBy, finishedMovie, remainingSlots, services);
            } catch (err) {
                console.warn(`[MovieLifecycle] Failed to calculate remaining slots or send DM:`, err);
            }
        }

        const attendees = await finaliseAttendance(services);
        console.log(`[MovieLifecycle] Attendance tracking complete: ${attendees.length} attendees.`);

        const message = finishedMovie
            ? `The movie night for **${finishedMovie.title}** has ended and been archived.`
            : 'The movie night has ended, but no selected movie was found to archive.';

        if (finishedMovie) {
            return {
                success: true,
                message,
                finishedMovie,
            };
        }

        return {
            success: true,
            message,
        };
    } catch (error) {
        console.error('[MovieLifecycle] Failed to finish movie night:', error);
        return { success: false, message: 'Failed to end movie night.' };
    }
}

export async function scheduleMovieAutoEnd(services: ServiceContainer, startTimeISO: string, runtimeMinutes: number, client: Client) {
    const movieRepo = services.repos.movieRepo;
    if (!movieRepo) {
        console.error("[MovieLifecycle] Movie repository not found; cannot shcedule auto-end.");
        return;
    }

    const startDateTime = DateTime.fromISO(startTimeISO);
    const latestEvent = await movieRepo.getActiveEvent();
    const scheduledEventId = latestEvent?.id;
    if (!latestEvent) {
        console.warn("[MovieLifecycle] No active movie event found; skipping attendance tracking init.");
    } else {
        const guildConfig = services.guildId ? await services.guilds.get(services.guildId) : null;
        const voiceChannelId = latestEvent.voiceChannelId ?? guildConfig?.channels?.movieVC ?? null;

        if (!voiceChannelId) {
            console.warn(`[MovieLifecycle] Active movie event ${latestEvent.id} has no voice channel configured; attendance tracking disabled.`);
        } else {
            const initialMembers = await getActiveVoiceMemberIds(client, voiceChannelId);
            initAttendanceTracking({
                channelId: voiceChannelId,
                startTime: startDateTime.toJSDate(),
                client,
                initialUserIds: initialMembers,
            });
        }
    }

    const bufferMinutes = 30;
    const endTime = startDateTime.plus({ minutes: runtimeMinutes + bufferMinutes });
    const now = DateTime.utc();
    const msUntilEnd = endTime.diff(now).as('milliseconds');
    const timerKey = getAutoEndTimerKey(services.guildId);

    if (msUntilEnd <= 0) {
        console.warn("[MovieLifecycle] Movie auto-end time is in the past. Skipping.");
        return;
    }

    const existingTimeout = autoEndTimeouts.get(timerKey);
    if (existingTimeout) {
        clearTimeout(existingTimeout);
        autoEndTimeouts.delete(timerKey);
    }

    const timeout = setTimeout(async () => {
        console.log("[MovieLifecycle] Auto-ending movie night based on runtime.");
        const result = await finishMovieNight('auto', services, client, scheduledEventId);

        if (result.success && result.finishedMovie) {
            try {
                const { guildId } = await resolveGuildContext(client, services);
                if (!guildId) {
                    console.warn("[MovieLifecycle] Could not identify guild for movie night end message.");
                    return;
                }

                const guildConfig = await services.guilds.get(guildId);
                const movieChannelId = guildConfig?.channels?.movieNight;

                if (movieChannelId) {
                    const guildObj = await client.guilds.fetch(guildId);
                    const channel = await guildObj.channels.fetch(movieChannelId);
                    if (channel?.isTextBased()) {
                        await channel.send({
                            content: `🎞️ **${result.finishedMovie.title}** has finished and has now been archived from the active list. Thanks for watching!`
                        });
                        console.log(`[MovieLifecycle] Sent end-of-night message for ${result.finishedMovie.title}`);
                    } else {
                        console.warn(`[MovieLifecycle] Configured movie night channel is not text-based: ${movieChannelId}`);
                    }
                } else {
                    console.warn("[MovieLifecycle] No movieNight channel configured; skipping end message.");
                }
            } catch (err) {
                console.warn("[MovieLifecycle] Failed to send end-of-night message:", err);
            }
        }

        autoEndTimeouts.delete(timerKey);
    }, msUntilEnd);
    autoEndTimeouts.set(timerKey, timeout);

    console.log(`[MovieLifecycle] Auto-end scheduled in ${Math.round(msUntilEnd / 1000)}s at ${endTime.toISO()}`);
    SchedulerStatusReporter.onNewTrigger('Movie Auto-End', endTime.toJSDate());
}
