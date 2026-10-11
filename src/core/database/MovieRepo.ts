import type { Firestore } from "firebase-admin/firestore";
import { GuildScopedRepository } from "./CoreRepo.js";
import type { IMovieRepository } from "./interfaces/IMovieRepo.js";
import type { Movie } from "../../models/Movie.js";
import type { MoviePoll } from "../../models/MoviePoll.js";
import type { MovieEvent } from "../../models/MovieEvent.js";
import { movieConverter, movieEventConverter, moviePollConverter } from "./converters.js";

export class MovieRepository extends GuildScopedRepository<Movie> implements IMovieRepository {
    constructor(db: Firestore, guildId: string) {
        super(db, guildId, 'movies', movieConverter);
    }

    async getAllMovies(): Promise<Movie[]> {
        const snapshot = await this.collection.get();
        return snapshot.docs.map((doc) => doc.data());
    }

    async getMovieById(id: string): Promise<Movie | null> {
        const doc = await this.collection.doc(id).get();
        return doc.data() ?? null;
    }

    async upsertMovie(movie: Movie): Promise<void> {
        await this.collection.doc(movie.id).set(movie);
    }

    async deleteMovie(id: string): Promise<void> {
        await this.collection.doc(id).delete();
    }

    private get pollsCollection() {
        return this.guildCollection('moviePolls', moviePollConverter);
    }

    async createPoll(poll: MoviePoll): Promise<void> {
        await this.pollsCollection.doc(poll.id).set(poll);
    }

    async getActivePoll(): Promise<MoviePoll | null> {
        const snapshot = await this.pollsCollection.where('isActive', '==', true).get();

        // The most recently created active poll
        const polls = snapshot.docs
            .map((doc) => doc.data())
            .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());

        return polls[0] ?? null;
    }

    // Closes a poll if it is still open and returns it as it was closed, votes included, or null if it was already
    // closed. In one transaction, so a poll closed by an admin and by the scheduler at once is closed once.
    async closePoll(pollId: string): Promise<MoviePoll | null> {
        const docRef = this.pollsCollection.doc(pollId);
        return this.db.runTransaction(async (transaction) => {
            const poll = (await transaction.get(docRef)).data();
            if (!poll?.isActive) return null;
            transaction.update(docRef, { isActive: false, closedAt: new Date() });
            return poll;
        });
    }

    async clearPolls(): Promise<void> {
        const snapshot = await this.pollsCollection.get();
        const batch = this.db.batch();
        snapshot.docs.forEach((doc) => batch.delete(doc.ref));
        await batch.commit();
    }

    private get eventsCollection() {
        return this.guildCollection('movieEvents', movieEventConverter);
    }

    async createMovieEvent(event: MovieEvent): Promise<void> {
        const payload: MovieEvent = {
            ...event,
            createdAt: event.createdAt ?? new Date(),
        };
        await this.eventsCollection.doc(payload.id).set(payload);
    }

    // Marks a movie night completed, with any changes given, if it isn't already, and returns it as completed, or
    // null if it had already ended. In one transaction, so a night ended by an admin and by the scheduler at once
    // ends once.
    async completeEvent(eventId: string, changes: Partial<MovieEvent> = {}): Promise<MovieEvent | null> {
        const docRef = this.eventsCollection.doc(eventId);
        return this.db.runTransaction(async (transaction) => {
            const event = (await transaction.get(docRef)).data();
            if (!event || event.completed) return null;
            const completed: MovieEvent = { ...event, ...changes, completed: true, completedAt: changes.completedAt ?? new Date() };
            transaction.set(docRef, completed);
            return completed;
        });
    }

    // Records reminders as sent for a movie night that is still on and returns those not sent before, so each
    // reminder goes out once however many sweeps see it due
    async claimReminders(eventId: string, labels: string[]): Promise<string[]> {
        const docRef = this.eventsCollection.doc(eventId);
        return this.db.runTransaction(async (transaction) => {
            const event = (await transaction.get(docRef)).data();
            if (!event || event.completed) return [];
            const sent = event.remindersSent ?? [];
            const unsent = labels.filter((label) => !sent.includes(label));
            if (unsent.length) transaction.update(docRef, { remindersSent: [...sent, ...unsent] });
            return unsent;
        });
    }

    async getActiveEvent(): Promise<MovieEvent | null> {
        const snapshot = await this.eventsCollection
            .where('completed', '==', false)
            .get();

        if (snapshot.empty) return null;

        const events = snapshot.docs
            .map((doc) => doc.data())
            .sort((a, b) => b.startTime.getTime() - a.startTime.getTime());

        return events[0] ?? null;
    }

    async getLatestEvent(): Promise<MovieEvent | null> {
        const snapshot = await this.eventsCollection
        .orderBy('createdAt', 'desc')
        .limit(1)
        .get();

        if (snapshot.empty) return null;
        return snapshot.docs[0]?.data() ?? null;
    }

    async getAllEvents(): Promise<MovieEvent[]> {
        const snapshot = await this.eventsCollection.orderBy('createdAt', 'desc').get();
        return snapshot.docs.map((doc) => doc.data());
    }

    async clearEvents(): Promise<void> {
        const snapshot = await this.eventsCollection.get();
        const batch = this.db.batch();
        snapshot.docs.forEach((doc) => batch.delete(doc.ref));
        await batch.commit();
    }

    async voteInPollOnce(pollId: string, userId: string, optionId: string): Promise<{ firstTime: boolean, updatedPoll: MoviePoll; }> {
        const pollRef = this.pollsCollection.doc(pollId);
        return this.db.runTransaction(async (tx) => {
            const snap = await tx.get(pollRef);
            const poll = snap.data();
            if (!poll) throw new Error("Poll not found.");

            poll.votes = poll.votes ?? {};
            const firstTime = !poll.votes[userId];

            poll.votes[userId] = optionId;
            tx.set(pollRef, poll, { merge: true });

            return { firstTime, updatedPoll: poll };
        });
    }
}
