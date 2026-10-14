/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { Button } from "@components/Button";
import { Logger } from "@utils/Logger";
import { RenderModalProps } from "@vencord/discord-types";
import { Forms, Modal, useEffect, useState } from "@webpack/common";

import {
    ArchiveData,
    clearArchive,
    clearGuilds,
    clearUsers,
    exportArchive,
    getArchive,
    pruneArchive,
    pruneArchiveRange,
    removeGuild,
    removeUser,
    subscribeToArchive
} from "./store";

enum ArchiveTab {
    Servers,
    Accounts
}

type Confirmation = "all" | "tab" | "prune" | null;
type PruneMode = "older" | "range";

const logger = new Logger("Archive");

function formatDate(timestamp: number) {
    return new Date(timestamp).toLocaleString();
}

function GuildList({ guilds, onRemove }: {
    guilds: ArchiveData["guilds"];
    onRemove(id: string): void;
}) {
    if (guilds.length === 0) return <Forms.FormText>لا توجد سيرفرات محفوظة حتى الآن.</Forms.FormText>;

    return (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            {guilds.map(guild => (
                <section key={guild.id} style={{ borderBottom: "1px solid var(--border-subtle)", paddingBottom: 12 }}>
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
                        <Forms.FormTitle tag="h5">{guild.name}</Forms.FormTitle>
                        <Button size="small" variant="dangerSecondary" onClick={() => onRemove(guild.id)}>حذف</Button>
                    </div>
                    <Forms.FormText>المعرّف: <code dir="ltr">{guild.id}</code></Forms.FormText>
                    <Forms.FormText>تاريخ الانضمام: {formatDate(guild.joinedAt)}</Forms.FormText>
                    {guild.vanityCode && (
                        <Forms.FormText>
                            الرابط: <a dir="ltr" href={`https://discord.gg/${guild.vanityCode}`} target="_blank" rel="noreferrer">discord.gg/{guild.vanityCode}</a>
                        </Forms.FormText>
                    )}
                </section>
            ))}
        </div>
    );
}

function UserList({ users, onRemove }: {
    users: ArchiveData["users"];
    onRemove(id: string): void;
}) {
    if (users.length === 0) return <Forms.FormText>لا توجد حسابات محفوظة حتى الآن.</Forms.FormText>;

    return (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            {users.map(user => (
                <section key={user.id} style={{ borderBottom: "1px solid var(--border-subtle)", paddingBottom: 12 }}>
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
                        <Forms.FormTitle tag="h5">{user.name}</Forms.FormTitle>
                        <Button size="small" variant="dangerSecondary" onClick={() => onRemove(user.id)}>حذف</Button>
                    </div>
                    {user.username && <Forms.FormText>اسم المستخدم: <code dir="ltr">@{user.username}</code></Forms.FormText>}
                    <Forms.FormText>المعرّف: <code dir="ltr">{user.id}</code></Forms.FormText>
                    <Forms.FormText>أول فتح: {formatDate(user.firstOpenedAt)}</Forms.FormText>
                    <Forms.FormText>آخر فتح: {formatDate(user.lastOpenedAt)}</Forms.FormText>
                    <Forms.FormText>
                        تم الفتح عبر: {user.sources.map(source => source === "profile" ? "الملف الشخصي" : "الخاص").join("، ")}
                    </Forms.FormText>
                </section>
            ))}
        </div>
    );
}

export function ArchiveModal(props: RenderModalProps & { initialConfirmation?: Confirmation; }) {
    const { onClose, initialConfirmation } = props;
    const [archive, setArchive] = useState(getArchive());
    const [tab, setTab] = useState(ArchiveTab.Servers);
    const [confirmation, setConfirmation] = useState<Confirmation>(() =>
        initialConfirmation && (getArchive().guilds.length > 0 || getArchive().users.length > 0)
            ? initialConfirmation
            : null
    );
    const [pruneMode, setPruneMode] = useState<PruneMode>("older");
    const [pruneDays, setPruneDays] = useState("30");
    const [rangeStartDays, setRangeStartDays] = useState("3");
    const [rangeEndDays, setRangeEndDays] = useState("10");
    const [statusMessage, setStatusMessage] = useState("");

    useEffect(() => {
        const unsubscribe = subscribeToArchive(setArchive);
        setArchive(getArchive());
        return unsubscribe;
    }, []);

    const hasGuilds = archive.guilds.length > 0;
    const hasUsers = archive.users.length > 0;
    const hasCurrentTabEntries = tab === ArchiveTab.Servers ? hasGuilds : hasUsers;
    const olderDays = Number(pruneDays);
    const rangeStart = Number(rangeStartDays);
    const rangeEnd = Number(rangeEndDays);
    const isPruneInputValid = pruneMode === "older"
        ? Number.isInteger(olderDays) && olderDays > 0
        : Number.isInteger(rangeStart) && rangeStart > 0 && Number.isInteger(rangeEnd) && rangeEnd >= rangeStart;

    async function runConfirmedAction() {
        try {
            if (confirmation === "all") {
                await clearArchive();
                setStatusMessage("تم مسح الأرشيف بالكامل.");
            } else if (confirmation === "tab") {
                if (tab === ArchiveTab.Servers) await clearGuilds();
                else await clearUsers();
                setStatusMessage(tab === ArchiveTab.Servers ? "تم مسح أرشيف السيرفرات." : "تم مسح أرشيف الحسابات.");
            } else if (confirmation === "prune") {
                const options = { includeGuilds: true };
                const removed = pruneMode === "older"
                    ? await pruneArchive(olderDays, options)
                    : await pruneArchiveRange(rangeStart, rangeEnd, options);
                setStatusMessage(`تم حذف ${removed} عنصر من الأرشيف.`);
            }

            setConfirmation(null);
        } catch (error) {
            logger.error("Failed to update archive from the archive window", error);
            setStatusMessage("تعذّر تحديث الأرشيف. راجع سجل Vencord للتفاصيل.");
        }
    }

    async function removeGuildEntry(id: string) {
        try {
            await removeGuild(id);
        } catch (error) {
            logger.error("Failed to remove server from archive", error);
            setStatusMessage("تعذّر حذف السيرفر من الأرشيف.");
        }
    }

    async function removeUserEntry(id: string) {
        try {
            await removeUser(id);
        } catch (error) {
            logger.error("Failed to remove account from archive", error);
            setStatusMessage("تعذّر حذف الحساب من الأرشيف.");
        }
    }

    function downloadArchive() {
        try {
            const blob = new Blob([exportArchive()], { type: "application/json" });
            const url = URL.createObjectURL(blob);
            const link = document.createElement("a");
            link.href = url;
            link.download = `server-dm-archive-${new Date().toISOString().slice(0, 10)}.json`;
            link.click();
            setTimeout(() => URL.revokeObjectURL(url), 0);
            setStatusMessage("تم تصدير الأرشيف بصيغة JSON.");
        } catch (error) {
            logger.error("Failed to export archive", error);
            setStatusMessage("تعذّر تصدير الأرشيف.");
        }
    }

    return (
        <Modal
            title="أرشيف السيرفرات والحسابات"
            size="lg"
            onClose={onClose}
            transitionState={props.transitionState}
            actions={[{ text: "إغلاق", variant: "primary", onClick: onClose }]}
        >
            <div dir="rtl">
                <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 16 }}>
                    <Button
                        variant={tab === ArchiveTab.Servers ? "primary" : "secondary"}
                        aria-pressed={tab === ArchiveTab.Servers}
                        onClick={() => {
                            setTab(ArchiveTab.Servers);
                            setConfirmation(null);
                            setStatusMessage("");
                        }}
                    >
                        السيرفرات ({archive.guilds.length})
                    </Button>
                    <Button
                        variant={tab === ArchiveTab.Accounts ? "primary" : "secondary"}
                        aria-pressed={tab === ArchiveTab.Accounts}
                        onClick={() => {
                            setTab(ArchiveTab.Accounts);
                            setConfirmation(null);
                            setStatusMessage("");
                        }}
                    >
                        الحسابات ({archive.users.length})
                    </Button>
                </div>

                <Forms.FormText>
                    يتم الحفظ على جهازك فقط. يظهر رابط Vanity إذا كان متاحًا؛ Discord لا يوفّر للإضافة رابط الدعوة العادي الذي استُخدم للانضمام.
                </Forms.FormText>

                <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 16 }}>
                    <Button variant="dangerSecondary" disabled={!hasGuilds && !hasUsers} onClick={() => setConfirmation("all")}>
                        مسح الكل
                    </Button>
                    <Button variant="dangerSecondary" disabled={!hasCurrentTabEntries} onClick={() => setConfirmation("tab")}>
                        مسح هذا التبويب فقط
                    </Button>
                    <Button variant="secondary" disabled={!hasGuilds && !hasUsers} onClick={() => setConfirmation("prune")}>
                        حذف الأقدم من...
                    </Button>
                    <Button variant="secondary" disabled={!hasGuilds && !hasUsers} onClick={downloadArchive}>
                        تصدير JSON
                    </Button>
                </div>

                {confirmation && (
                    <section style={{ border: "1px solid var(--border-subtle)", borderRadius: 8, marginTop: 16, padding: 12 }}>
                        {confirmation === "prune"
                            ? (
                                <>
                                    <Forms.FormTitle tag="h5">اختر طريقة الحذف</Forms.FormTitle>
                                    <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 8 }}>
                                        <Button
                                            variant={pruneMode === "older" ? "primary" : "secondary"}
                                            aria-pressed={pruneMode === "older"}
                                            onClick={() => setPruneMode("older")}
                                        >
                                            الأقدم من عدد أيام
                                        </Button>
                                        <Button
                                            variant={pruneMode === "range" ? "primary" : "secondary"}
                                            aria-pressed={pruneMode === "range"}
                                            onClick={() => setPruneMode("range")}
                                        >
                                            بين عمرين
                                        </Button>
                                    </div>
                                    {pruneMode === "older"
                                        ? (
                                            <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 12 }}>
                                                <label htmlFor="archive-prune-days">احذف ما عمره هذا العدد من الأيام أو أكثر:</label>
                                                <input
                                                    id="archive-prune-days"
                                                    type="number"
                                                    min="1"
                                                    step="1"
                                                    value={pruneDays}
                                                    onChange={event => setPruneDays(event.target.value)}
                                                    style={{ width: 80 }}
                                                />
                                            </div>
                                        )
                                        : (
                                            <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 8, marginTop: 12 }}>
                                                <label htmlFor="archive-prune-range-start">من عمر (يوم):</label>
                                                <input
                                                    id="archive-prune-range-start"
                                                    type="number"
                                                    min="1"
                                                    step="1"
                                                    value={rangeStartDays}
                                                    onChange={event => setRangeStartDays(event.target.value)}
                                                    style={{ width: 80 }}
                                                />
                                                <label htmlFor="archive-prune-range-end">إلى عمر (يوم):</label>
                                                <input
                                                    id="archive-prune-range-end"
                                                    type="number"
                                                    min="1"
                                                    step="1"
                                                    value={rangeEndDays}
                                                    onChange={event => setRangeEndDays(event.target.value)}
                                                    style={{ width: 80 }}
                                                />
                                            </div>
                                        )}
                                    <Forms.FormText>
                                        {pruneMode === "older"
                                            ? "سيُحذف كل حساب لم يُفتح وكل سيرفر انضممت إليه منذ هذا العدد من الأيام أو أكثر."
                                            : "سيُحذف كل حساب وسيرفر يقع عمره بين الحدين المحددين، شاملًا الحدين."}
                                    </Forms.FormText>
                                </>
                            )
                            : (
                                <Forms.FormText>
                                    {confirmation === "all"
                                        ? "تأكيد مسح جميع السيرفرات والحسابات المحفوظة؟ لا يمكن التراجع عن هذا الإجراء."
                                        : `تأكيد مسح ${tab === ArchiveTab.Servers ? "جميع السيرفرات" : "جميع الحسابات"} في هذا التبويب؟ لا يمكن التراجع عن هذا الإجراء.`}
                                </Forms.FormText>
                            )}
                        <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
                            <Button variant="dangerPrimary" disabled={confirmation === "prune" && !isPruneInputValid} onClick={runConfirmedAction}>تأكيد الحذف</Button>
                            <Button variant="secondary" onClick={() => setConfirmation(null)}>إلغاء</Button>
                        </div>
                    </section>
                )}

                {statusMessage && <Forms.FormText>{statusMessage}</Forms.FormText>}

                <div style={{ marginTop: 16, maxHeight: "55vh", overflowY: "auto" }}>
                    {tab === ArchiveTab.Servers
                        ? <GuildList guilds={archive.guilds} onRemove={id => void removeGuildEntry(id)} />
                        : <UserList users={archive.users} onRemove={id => void removeUserEntry(id)} />}
                </div>
            </div>
        </Modal>
    );
}
