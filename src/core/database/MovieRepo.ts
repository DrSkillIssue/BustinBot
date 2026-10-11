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

    async closePoll(pollId: string): Promise<void> {
        const docRef = this.pollsCollection.doc(pollId);
        await docRef.update({ isActive: false, closedAt: new Date() });
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
