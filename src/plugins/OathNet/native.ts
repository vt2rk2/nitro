/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { IpcMainInvokeEvent } from "electron";

export interface NativeFetchResult {
    status: number;
    data: string;
}

/**
 * ينفَّذ داخل عملية Electron الرئيسية حيث لا تُطبَّق قيود CORS الخاصة بالمتصفح.
 */
export async function fetchJson(_: IpcMainInvokeEvent, url: string, headers: Record<string, string>, timeoutMs = 20_000): Promise<NativeFetchResult> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    try {
        const response = await fetch(url, { headers, signal: controller.signal });
        return { status: response.status, data: await response.text() };
    } catch (error) {
        return { status: -1, data: error instanceof Error ? error.message : String(error) };
    } finally {
        clearTimeout(timeout);
    }
}
