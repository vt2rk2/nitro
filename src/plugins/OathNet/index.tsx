/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { NavContextMenuPatchCallback } from "@api/ContextMenu";
import { definePluginSettings } from "@api/Settings";
import { LinkIcon } from "@components/Icons";
import definePlugin, { OptionType } from "@utils/types";
import type { User } from "@vencord/discord-types";
import { Menu } from "@webpack/common";

import { openOathNetModal } from "./OathNetModal";

const settings = definePluginSettings({
    includeRobloxLink: {
        type: OptionType.BOOLEAN,
        description: "Also query the legacy Discord -> Roblox link endpoint for linked accounts.",
        default: true,
        restartNeeded: false
    }
});

interface UserContextProps {
    user: User;
}

const UserContextMenuPatch: NavContextMenuPatchCallback = (children, { user }: UserContextProps) => {
    if (!user?.id) return;
    if (children.some(child => child?.props?.id === "oathnet-user-lookup")) return;

    const userId = user.id;

    children.push(
        <Menu.MenuItem
            id="oathnet-user-lookup"
            label="Lookup User (OathNet)"
            icon={LinkIcon}
            leadingAccessory={{ type: "icon", icon: LinkIcon }}
            action={() => openOathNetModal(userId, settings.store.includeRobloxLink)}
        />
    );
};

export default definePlugin({
    name: "OathNet",
    description: "Adds a 'Lookup User (OathNet)' option to the user context menu that queries OathNet and shows the results in a modal.",
    authors: [{ name: ".vt2", id: 298055455614173184n }],
    tags: ["Utility", "Friends"],
    searchTerms: ["osint", "lookup", "oathnet", "user info"],
    settings,
    contextMenus: {
        "user-context": UserContextMenuPatch
    }
});
