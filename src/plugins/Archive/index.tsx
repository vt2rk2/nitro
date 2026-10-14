/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { definePluginSettings } from "@api/Settings";
import { Button } from "@components/Button";
import { Logger } from "@utils/Logger";
import definePlugin, { OptionType } from "@utils/types";
import { ChannelType } from "@vencord/discord-types/enums";
import { ChannelStore, GuildStore, openModal, UserStore } from "@webpack/common";

import { ArchiveModal } from "./ArchiveModal";
import { AUTHOR_AVATAR } from "./avatar";
import { initializeArchive, pruneArchive, recordGuild, recordUser } from "./store";

const logger = new Logger("Archive");
const knownGuildIds = new Set<string>();
let trackingStartedAt = 0;

function seedKnownGuilds() {
    for (const guildId of GuildStore.getGuildIds()) knownGuildIds.add(guildId);
}

function openArchive(initialConfirmation?: "all") {
    openModal(props => <ArchiveModal {...props} initialConfirmation={initialConfirmation} />);
}

const settings = definePluginSettings({
    autoPruneDays: {
        type: OptionType.NUMBER,
        description: "احذف تلقائيًا الأرشيف الأقدم من عدد الأيام المحدد عند تشغيل الإضافة (0 لتعطيل الحذف التلقائي)",
        default: 0
    },
    openArchive: {
        type: OptionType.COMPONENT,
        description: "افتح الأرشيف المحلي للسيرفرات والحسابات",
        component: () => <Button onClick={() => openArchive()}>فتح الأرشيف</Button>
    },
    clearArchive: {
        type: OptionType.COMPONENT,
        description: "امسح جميع بيانات الأرشيف بعد التأكيد",
        component: () => <Button variant="dangerSecondary" onClick={() => openArchive("all")}>مسح الأرشيف</Button>
    }
});

function archiveUser(userId: string, source: "profile" | "dm") {
    const currentUser = UserStore.getCurrentUser();
    if (!userId || userId === currentUser?.id) return;

    const user = UserStore.getUser(userId);
    recordUser(userId, user?.globalName || user?.username || userId, source);
}

export default definePlugin({
    name: "Archive",
    description: "يحفظ لك محلياً السيرفرات اللي تنضم لها، والحسابات اللي تفتح بروفايلها أو خاصها. كل شي على جهازك بس، وتقدر تمسح أو تصدّر الأرشيف وقت ما تبي",
    website: "https://richboys.life/",
    authors: [{ name: ".vt2", id: 1039642576476712971n, avatarUrl: AUTHOR_AVATAR }],
    tags: ["Utility", "Privacy"],
    settings,

    flux: {
        CONNECTION_OPEN: seedKnownGuilds,

        GUILD_CREATE(data: {
            id?: string;
            name?: string;
            joined_at?: string;
            vanity_url_code?: string;
            vanityURLCode?: string;
            guild?: {
                id?: string;
                name?: string;
                joined_at?: string;
                vanity_url_code?: string;
                vanityURLCode?: string;
            };
        }) {
            const guild = data.guild ?? data;
            const guildId = guild.id;
            if (!guildId || knownGuildIds.has(guildId)) return;

            knownGuildIds.add(guildId);
            const storedGuild = GuildStore.getGuild(guildId);
            const parsedJoinedAt = guild.joined_at ? Date.parse(guild.joined_at) : NaN;
            const joinedAt = Number.isFinite(parsedJoinedAt)
                ? parsedJoinedAt
                : storedGuild?.joinedAt?.getTime() ?? Date.now();
            // Ignore guilds joined while the plugin was disabled.
            if (joinedAt < trackingStartedAt - 60_000) return;

            recordGuild({
                id: guildId,
                name: guild.name ?? storedGuild?.name ?? guildId,
                joinedAt,
                vanityCode: guild.vanity_url_code ?? guild.vanityURLCode ?? storedGuild?.vanityURLCode ?? undefined
            });
        },

        GUILD_DELETE(data: { id?: string; guildId?: string; unavailable?: boolean; }) {
            if (data.unavailable) return;
            const guildId = data.id ?? data.guildId;
            if (guildId) knownGuildIds.delete(guildId);
        },

        CHANNEL_SELECT({ channelId }: { channelId: string; }) {
            const channel = ChannelStore.getChannel(channelId);
            if (!channel || (channel.type !== ChannelType.DM && channel.type !== ChannelType.GROUP_DM)) return;

            for (const recipientId of channel.recipients) archiveUser(recipientId, "dm");
        },

        USER_PROFILE_MODAL_OPEN({ userId }: { userId: string; }) {
            archiveUser(userId, "profile");
        }
    },

    start() {
        trackingStartedAt = Date.now();
        seedKnownGuilds();
        initializeArchive()
            .then(async () => {
                const maxAgeDays = settings.store.autoPruneDays;
                if (maxAgeDays > 0) await pruneArchive(maxAgeDays);
            })
            .catch(error => logger.error("Failed to initialize or automatically prune archive", error));
    }
});
