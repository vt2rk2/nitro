/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import * as DataStore from "@api/DataStore";
import { Logger } from "@utils/Logger";

export type UserArchiveSource = "profile" | "dm";

export interface GuildArchiveEntry {
    id: string;
    name: string;
    joinedAt: number;
    vanityCode?: string;
}

export interface UserArchiveEntry {
    id: string;
    name: string;
    username?: string;
    firstOpenedAt: number;
    lastOpenedAt: number;
    sources: UserArchiveSource[];
}

export interface ArchiveData {
    guilds: GuildArchiveEntry[];
    users: UserArchiveEntry[];
}

export interface PruneOptions {
    /** افتراضيًا الحذف يشمل الحسابات فقط. فعّلها لو تبي تحذف السيرفرات حسب تاريخ الانضمام. */
    includeGuilds?: boolean;
}

const STORAGE_KEY = "server-dm-archive";
const BACKUP_KEY = `${STORAGE_KEY}-backup`;
const USER_OPEN_THROTTLE_MS = 60_000;
const MAX_GUILDS = 500;
const MAX_USERS = 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
const logger = new Logger("ServerDMArchive");

function createEmptyArchive(): ArchiveData {
    return { guilds: [], users: [] };
}

let archive: ArchiveData = createEmptyArchive();
let initialization: Promise<void> | undefined;
let initialized = false;
let writeQueue: Promise<void> = Promise.resolve();

const listeners = new Set<(next: ArchiveData) => void>();

function publish() {
    for (const listener of listeners) listener(archive);
}

function isGuildEntry(value: unknown): value is GuildArchiveEntry {
    if (!value || typeof value !== "object") return false;
    const guild = value as Partial<GuildArchiveEntry>;
    return typeof guild.id === "string"
        && typeof guild.name === "string"
        && Number.isFinite(guild.joinedAt)
        && (guild.vanityCode === undefined || typeof guild.vanityCode === "string");
}

function isUserEntry(value: unknown): value is UserArchiveEntry {
    if (!value || typeof value !== "object") return false;
    const user = value as Partial<UserArchiveEntry>;
    return typeof user.id === "string"
        && typeof user.name === "string"
        && (user.username === undefined || typeof user.username === "string")
        && Number.isFinite(user.firstOpenedAt)
        && Number.isFinite(user.lastOpenedAt)
        && Array.isArray(user.sources)
        && user.sources.every(source => source === "profile" || source === "dm");
}

/**
 * يفلتر العناصر التالفة بدل ما يرفض الأرشيف كله.
 * يرجّع null لو الشكل العام نفسه غلط (مو object أو guilds/users مو مصفوفات).
 */
function sanitizeArchive(value: unknown): { data: ArchiveData; dropped: number; } | null {
    if (!value || typeof value !== "object") return null;
    const candidate = value as Partial<ArchiveData>;
    if (!Array.isArray(candidate.guilds) || !Array.isArray(candidate.users)) return null;

    const guilds = candidate.guilds.filter(isGuildEntry);
    const users = candidate.users.filter(isUserEntry);
    const dropped = candidate.guilds.length - guilds.length + candidate.users.length - users.length;

    return { data: { guilds, users }, dropped };
}

async function loadArchive() {
    let saved: unknown;

    try {
        saved = await DataStore.get<unknown>(STORAGE_KEY);
    } catch (error) {
        // ما نعتبر الأرشيف فاضي: لو اعتبرناه فاضي أول كتابة بتمسح بياناتك الحقيقية.
        // العملية الجاية تعيد المحاولة.
        logger.error("Failed to read archive; will retry on the next operation", error);
        throw error;
    }

    if (saved == null) {
        archive = createEmptyArchive();
    } else {
        const sanitized = sanitizeArchive(saved);

        if (!sanitized) {
            // صيغة غلط بالكامل: نحفظ نسخة خام قبل ما نبدأ من فاضي.
            // لو فشل الحفظ الاحتياطي يرمي خطأ ولا نكمل (عشان ما نكتب فوق البيانات).
            await DataStore.set(BACKUP_KEY, saved);
            logger.error("Stored archive has an invalid format; raw copy saved to backup key and starting empty");
            archive = createEmptyArchive();
        } else {
            if (sanitized.dropped > 0) {
                await DataStore.set(BACKUP_KEY, saved);
                logger.warn(`Dropped ${sanitized.dropped} invalid archive entries; raw copy saved to backup key`);
            }
            archive = sanitized.data;
        }
    }

    initialized = true;
    publish();
}

export function initializeArchive(): Promise<void> {
    if (initialized) return Promise.resolve();

    if (!initialization) {
        const pending: Promise<void> = loadArchive().finally(() => {
            // نصفّر عند الفشل (وعند النجاح ما يهم لأن initialized = true)
            if (initialization === pending) initialization = undefined;
        });
        initialization = pending;
    }

    return initialization;
}

export function getArchive() {
    return archive;
}

export function subscribeToArchive(listener: (next: ArchiveData) => void) {
    listeners.add(listener);
    return () => {
        listeners.delete(listener);
    };
}

function enqueueArchiveOperation<T>(operation: () => Promise<T>) {
    const task = writeQueue.then(async () => {
        await initializeArchive();
        return operation();
    });

    writeQueue = task.then(
        () => undefined,
        error => {
            logger.error("Failed to update archive", error);
        }
    );

    return task;
}

function updateArchive(update: (current: ArchiveData) => ArchiveData) {
    return enqueueArchiveOperation(async () => {
        const next = update(archive);
        if (next === archive) return;
        await DataStore.set(STORAGE_KEY, next);
        archive = next;
        publish();
    });
}

export function recordGuild(entry: GuildArchiveEntry) {
    void updateArchive(current => ({
        ...current,
        guilds: [entry, ...current.guilds.filter(guild => guild.id !== entry.id)].slice(0, MAX_GUILDS)
    }));
}

export function recordUser(id: string, name: string, source: UserArchiveSource, username?: string, timestamp = Date.now()) {
    void updateArchive(current => {
        const existing = current.users.find(user => user.id === id);
        if (
            existing?.sources.includes(source)
            && timestamp >= existing.lastOpenedAt
            && timestamp - existing.lastOpenedAt < USER_OPEN_THROTTLE_MS
        ) {
            return current;
        }

        const updated: UserArchiveEntry = existing
            ? {
                ...existing,
                name: name || existing.name,
                username: username || existing.username,
                lastOpenedAt: timestamp,
                sources: existing.sources.includes(source) ? existing.sources : [...existing.sources, source]
            }
            : {
                id,
                name: name || id,
                username,
                firstOpenedAt: timestamp,
                lastOpenedAt: timestamp,
                sources: [source]
            };

        return {
            ...current,
            users: [updated, ...current.users.filter(user => user.id !== id)].slice(0, MAX_USERS)
        };
    });
}

export function clearArchive() {
    return enqueueArchiveOperation(async () => {
        await DataStore.del(STORAGE_KEY);
        await DataStore.del(BACKUP_KEY);
        archive = createEmptyArchive();
        publish();
    });
}

export function clearGuilds() {
    return updateArchive(current => ({ ...current, guilds: [] }));
}

export function clearUsers() {
    return updateArchive(current => ({ ...current, users: [] }));
}

export function removeGuild(id: string) {
    return updateArchive(current => ({
        ...current,
        guilds: current.guilds.filter(guild => guild.id !== id)
    }));
}

export function removeUser(id: string) {
    return updateArchive(current => ({
        ...current,
        users: current.users.filter(user => user.id !== id)
    }));
}

export function pruneArchive(maxAgeDays: number, options: PruneOptions = {}) {
    if (!Number.isFinite(maxAgeDays) || maxAgeDays <= 0)
        return Promise.reject(new Error("Archive age must be a positive number of days"));

    return pruneArchiveByAge(age => age >= maxAgeDays, options);
}

export function pruneArchiveRange(minAgeDays: number, maxAgeDays: number, options: PruneOptions = {}) {
    if (!Number.isFinite(minAgeDays) || minAgeDays <= 0 || !Number.isFinite(maxAgeDays) || maxAgeDays < minAgeDays)
        return Promise.reject(new Error("Archive age range must contain positive days in ascending order"));

    return pruneArchiveByAge(age => age >= minAgeDays && age <= maxAgeDays, options);
}

function pruneArchiveByAge(matchesAge: (ageDays: number) => boolean, options: PruneOptions) {
    return enqueueArchiveOperation(async () => {
        const now = Date.now();
        const users = archive.users.filter(user => !matchesAge((now - user.lastOpenedAt) / DAY_MS));
        const guilds = options.includeGuilds
            ? archive.guilds.filter(guild => !matchesAge((now - guild.joinedAt) / DAY_MS))
            : archive.guilds;
        const removed = archive.guilds.length - guilds.length + archive.users.length - users.length;

        if (removed > 0) {
            const next = { guilds, users };
            await DataStore.set(STORAGE_KEY, next);
            archive = next;
            publish();
        }

        return removed;
    });
}

export function exportArchive() {
    return JSON.stringify(archive, null, 4);
}
