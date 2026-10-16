/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { RenderModalProps } from "@vencord/discord-types";
import { Forms, Modal, openModal, useEffect, useState } from "@webpack/common";
import type { ReactNode } from "react";

import { lookupDiscordUser, OathNetLookupResult } from "./api";

export interface OathNetModalProps extends RenderModalProps {
    userId: string;
    includeRobloxLink: boolean;
}

function firstValue(value?: string[] | string | null) {
    if (Array.isArray(value)) return value[0];
    return value ?? undefined;
}

function formatDate(value?: string | null) {
    if (!value) return undefined;
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

function Row({ label, children }: { label: string; children?: ReactNode; }) {
    if (children == null || children === "") return null;

    return (
        <div style={{ display: "flex", gap: 12, padding: "6px 0", borderBottom: "1px solid var(--background-modifier-accent)" }}>
            <Forms.FormText style={{ minWidth: 130, color: "var(--text-muted)" }}>{label}</Forms.FormText>
            <div style={{ flex: 1, color: "var(--text-normal)", wordBreak: "break-word" }}>{children}</div>
        </div>
    );
}

function Badge({ children }: { children: ReactNode; }) {
    return (
        <span style={{
            display: "inline-block",
            padding: "2px 8px",
            marginRight: 6,
            borderRadius: 4,
            backgroundColor: "var(--background-modifier-selected)",
            color: "var(--text-normal)",
            fontSize: 12
        }}>
            {children}
        </span>
    );
}

export function OathNetModal({ userId, includeRobloxLink, ...modalProps }: OathNetModalProps) {
    const [result, setResult] = useState<OathNetLookupResult | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [pending, setPending] = useState(true);
    const [attempt, setAttempt] = useState(0);

    useEffect(() => {
        let cancelled = false;

        setPending(true);
        setError(null);

        lookupDiscordUser(userId, includeRobloxLink)
            .then(data => { if (!cancelled) setResult(data); })
            .catch((e: unknown) => { if (!cancelled) setError(e instanceof Error ? e.message : String(e)); })
            .finally(() => { if (!cancelled) setPending(false); });

        return () => { cancelled = true; };
    }, [userId, includeRobloxLink, attempt]);

    const user = result?.user;
    const displayName = user?.global_name || user?.username;
    const badges = user?.badges ?? [];
    const leftToday = user?._meta?.lookups?.left_today;

    return (
        <Modal
            {...modalProps}
            size="lg"
            title="OathNet Lookup"
            subtitle={`Discord ID ${userId}`}
            actions={[
                {
                    text: "Open on OathNet",
                    variant: "secondary",
                    onClick: () => VencordNative.native.openExternal(`https://oathnet.org/?q=${encodeURIComponent(userId)}`)
                },
                {
                    text: pending ? "Loading..." : "Retry",
                    variant: "secondary",
                    disabled: pending,
                    onClick: () => {
                        setResult(null);
                        setAttempt(a => a + 1);
                    }
                },
                { text: "Close", variant: "primary", onClick: modalProps.onClose }
            ]}
        >
            {pending && <Forms.FormText>Querying OathNet...</Forms.FormText>}

            {error != null && !pending && (
                <div style={{ padding: 8, borderRadius: 4, borderLeft: "4px solid var(--status-danger)" }}>
                    <Forms.FormText style={{ color: "var(--status-danger)" }}>{error}</Forms.FormText>
                </div>
            )}

            {user != null && !pending && (
                <div>
                    <div style={{ display: "flex", alignItems: "center", gap: 16, marginBottom: 16 }}>
                        {user.avatar_url
                            ? <img src={user.avatar_url} alt="" style={{ width: 64, height: 64, borderRadius: "50%" }} />
                            : (
                                <div style={{
                                    width: 64,
                                    height: 64,
                                    borderRadius: "50%",
                                    display: "flex",
                                    alignItems: "center",
                                    justifyContent: "center",
                                    backgroundColor: "var(--background-accent)",
                                    fontSize: 24
                                }}>
                                    {displayName?.charAt(0)?.toUpperCase() ?? "?"}
                                </div>
                            )}
                        <div>
                            <Forms.FormText style={{ fontSize: 18, fontWeight: 600 }}>{displayName ?? "Unknown"}</Forms.FormText>
                            <Forms.FormText style={{ color: "var(--text-muted)" }}>{user.username ? `@${user.username}` : ""}</Forms.FormText>
                        </div>
                    </div>

                    <Row label="Username">{user.username}</Row>
                    <Row label="Display name">{user.global_name}</Row>
                    <Row label="User ID">{user.id}</Row>
                    <Row label="Account created">{formatDate(user.creation_date)}</Row>
                    <Row label="Badges">
                        {badges.length ? badges.map(badge => <Badge key={badge}>{badge}</Badge>) : "None"}
                    </Row>
                    <Row label="Linked accounts">
                        {!includeRobloxLink
                            ? "Not queried (disabled in settings)"
                            : result?.robloxId
                                ? <Badge>Roblox: {result.robloxId}</Badge>
                                : "None found"}
                    </Row>
                    <Row label="Username history">
                        {result?.usernameHistory.length
                            ? result.usernameHistory.map((entry, index) => (
                                <div key={index} style={{ fontSize: 13 }}>
                                    {firstValue(entry.name) ?? "Unknown"}
                                    {formatDate(firstValue(entry.time)) ? ` — ${formatDate(firstValue(entry.time))}` : ""}
                                </div>
                            ))
                            : "No previous usernames"}
                    </Row>
                    <Row label="Remaining quota">
                        {leftToday != null ? `${leftToday.toLocaleString()} lookups left today` : undefined}
                    </Row>
                </div>
            )}
        </Modal>
    );
}

export function openOathNetModal(userId: string, includeRobloxLink: boolean) {
    openModal(props => (
        <OathNetModal
            {...props}
            userId={userId}
            includeRobloxLink={includeRobloxLink}
        />
    ));
}
