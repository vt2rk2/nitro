/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import type { PluginNative } from "@utils/types";

import type { NativeFetchResult } from "./native";

const API_BASE = "https://oathnet.org/api/service/";
const REQUEST_TIMEOUT_MS = 20_000;
const DISCORD_ID_REGEX = /^\d{14,19}$/;

const Native = (globalThis as any).VencordNative?.pluginHelpers?.OathNet as PluginNative<typeof import("./native")> | undefined;

export interface OathNetUserInfo {
    id: string;
    username: string;
    global_name?: string | null;
    avatar_url?: string | null;
    banner_url?: string | null;
    creation_date?: string | null;
    badges?: string[] | null;
    _meta?: {
        user?: { plan?: string | null; is_plan_active?: boolean; };
        lookups?: { used_today?: number; left_today?: number; daily_limit?: number; is_unlimited?: boolean; };
    };
}

export interface OathNetUsernameHistoryEntry {
    name?: string[] | string | null;
    time?: string[] | string | null;
}

export interface OathNetLookupResult {
    user: OathNetUserInfo;
    usernameHistory: OathNetUsernameHistoryEntry[];
    robloxId: string | null;
}

interface OathNetEnvelope<T> {
    success?: boolean;
    message?: string;
    data?: T;
}

async function rawRequest(url: string, headers: Record<string, string>) {
    if (Native?.fetchJson) {
        const { status, data }: NativeFetchResult = await Native.fetchJson(url, headers, REQUEST_TIMEOUT_MS);
        return { status, body: data };
    }

    // مسار احتياطي لبيئة الويب/المتصفح (قد يفشل بسبب CORS)
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

    try {
        const response = await fetch(url, { headers, signal: controller.signal });
        return { status: response.status, body: await response.text() };
    } catch (error) {
        throw new Error(`Network/CORS error: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
        clearTimeout(timeout);
    }
}

async function request<T>(endpoint: string, params: Record<string, string>): Promise<T | null> {
    const url = new URL(endpoint, API_BASE);
    for (const [name, value] of Object.entries(params)) url.searchParams.set(name, value);

    const { status, body } = await rawRequest(url.toString(), {
        Accept: "application/json"
    });

    let json: OathNetEnvelope<T>;
    try {
        json = JSON.parse(body);
    } catch {
        throw new Error(`OathNet returned an unreadable response (HTTP ${status})`);
    }

    if (json.success === false || (json.data == null && status !== 200))
        throw new Error(json.message || `OathNet request failed (HTTP ${status})`);

    return json.data ?? null;
}

export async function lookupDiscordUser(discordId: string, includeRobloxLink: boolean): Promise<OathNetLookupResult> {
    if (!DISCORD_ID_REGEX.test(discordId)) throw new Error(`"${discordId}" is not a valid Discord ID`);

    const user = await request<OathNetUserInfo>("discord-userinfo", { discord_id: discordId });
    if (!user) throw new Error("OathNet returned no data for this user.");

    // الطلبات الثانوية اختيارية: فشل أي منها لا يُبطل النتيجة الأساسية
    const [history, roblox] = await Promise.all([
        request<{ history?: OathNetUsernameHistoryEntry[]; }>("discord-username-history", { discord_id: discordId })
            .catch(() => null),
        includeRobloxLink
            ? request<{ roblox_id?: string | number | null; }>("discord-to-roblox", { discord_id: discordId })
                .catch(() => null)
            : Promise.resolve(null)
    ]);

    return {
        user,
        usernameHistory: history?.history ?? [],
        robloxId: roblox?.roblox_id != null ? String(roblox.roblox_id) : null
    };
}
