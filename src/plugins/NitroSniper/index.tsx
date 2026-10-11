import { Logger } from "@utils/Logger";
import definePlugin from "@utils/types";
import { Message } from "@vencord/discord-types";
import { findByPropsLazy } from "@webpack";
import { ChannelStore, UserStore } from "@webpack/common";

import { resolveGiftType } from "./giftCode";
import { settings } from "./settings";
import type { ClaimRequest, WebhookResult } from "./types";
import { sendClaimWebhook } from "./webhook";
import { TURKI_AVATAR } from "./avatar";

const GIFT_LINK_REGEX = /discord\.(?:gift\/|com\/gifts?\/)([a-zA-Z0-9]{16,24})/g;

const REDEEM_TIMEOUT_MS = 10_000;
const MAX_SEEN_CODES = 50_000;

const logger = new Logger("NitroSniper");
const GiftActions = findByPropsLazy("redeemGiftCode");

let startTime = 0;
let claiming = false;
const claimQueue: ClaimRequest[] = [];
const seenCodes = new Set<string>();

function resetState() {
    startTime = Date.now();
    claimQueue.length = 0;
    seenCodes.clear();
    claiming = false;
}

function toError(error: unknown) {
    return error instanceof Error ? error : new Error(String(error));
}

function isOwnMessage(message: Message) {
    return message.author?.id === UserStore.getCurrentUser()?.id;
}

function shouldSkipMessage(message: Message) {
    return settings.store.ignoreOwnGiftLinks && isOwnMessage(message);
}

function extractGiftCodes(content: string): string[] {
    GIFT_LINK_REGEX.lastIndex = 0;
    const codes: string[] = [];
    for (const match of content.matchAll(GIFT_LINK_REGEX)) {
        codes.push(match[1]);
    }
    return codes;
}

function createClaimRequest(message: Message, code: string): ClaimRequest {
    const authorId = message.author?.id;
    const authorAvatar = message.author?.avatar;

    return {
        code,
        authorId,
        authorName: message.author?.globalName ?? message.author?.username,
        authorUsername: message.author?.username,
        authorAvatarUrl: authorId && authorAvatar
            ? `https://cdn.discordapp.com/avatars/${authorId}/${authorAvatar}.png?size=128`
            : undefined,
        channelId: message.channel_id,
        guildId: ChannelStore.getChannel(message.channel_id)?.guild_id,
        messageId: message.id
    };
}

function notifyClaim(result: WebhookResult, request: ClaimRequest, giftType: string | null) {
    void sendClaimWebhook(
        settings.store.webhookUrl,
        result,
        request,
        giftType
    ).catch(webhookError => {
        logger.error("Failed to send NitroSniper webhook notification", webhookError);
    });
}

function continueQueue() {
    claiming = false;
    processQueue();
}

function redeem(request: ClaimRequest) {
    let settled = false;
    const wantWebhook = settings.store.webhookUrl.trim().length > 0;
    const giftType = wantWebhook ? resolveGiftType(request.code) : Promise.resolve(null);

    const finish = (result: WebhookResult) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);

        if (wantWebhook) {
            void giftType.then(type => notifyClaim(result, request, type));
        }
        continueQueue();
    };

    const timer = setTimeout(() => {
        logger.warn(`Redeem timed out for code: ${request.code}`);
        finish("failed");
    }, REDEEM_TIMEOUT_MS);

    GiftActions.redeemGiftCode({
        code: request.code,
        onRedeemed: () => {
            logger.log(`Successfully redeemed code: ${request.code}`);
            finish("claimed");
        },
        onError: (error: unknown) => {
            logger.error(`Failed to redeem code: ${request.code}`, toError(error));
            finish("failed");
        }
    });
}

function processQueue() {
    if (claiming) return;

    const request = claimQueue.shift();
    if (!request) return;

    claiming = true;
    redeem(request);
}

export default definePlugin({
    name: "NitroSniper",
    description: "Automatically redeems Nitro gift links sent in chat",
    authors: [{
        name: ".vt2",
        id: 298055455614173184n,
        avatarUrl: TURKI_AVATAR
    }],
    tags: ["Chat", "Utility"],
    searchTerms: ["nitro", "gift", "redeem", "snipe"],
    settings,

    start() {
        resetState();
    },

    flux: {
        MESSAGE_CREATE({ message }: { message: Message; }) {
            const content = message.content;
            if (!content) return;

            if (!content.includes("discord.gift") && !content.includes("discord.com/gift")) {
                return;
            }

            if (message.timestamp && message.timestamp.getTime() < startTime) return;

            if (shouldSkipMessage(message)) return;

            const codes = extractGiftCodes(content);
            if (codes.length === 0) return;

            let queued = 0;
            for (const code of codes) {
                if (seenCodes.has(code)) continue;
                seenCodes.add(code);

                if (seenCodes.size > MAX_SEEN_CODES) {
                    seenCodes.clear();
                }

                claimQueue.push(createClaimRequest(message, code));
                queued++;
            }

            if (queued > 0) {
                processQueue();
            }
        }
    }
});