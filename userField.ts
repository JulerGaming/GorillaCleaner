export interface DiscordClan {
    identity_guild_id: string;
    identity_enabled: boolean;
    tag: string;
    badge: string;
}

export interface DiscordNameplate {
    sku_id: string;
    asset: string;
    label: string;
    palette: string;
}

export interface DiscordCollectibles {
    nameplate?: DiscordNameplate;
}

export interface DiscordDisplayNameStyles {
    font_id: number;
    effect_id: number;
    colors: number[];
}

export class DiscordUser {
    id: string;
    username: string;
    globalName: string | null;
    discriminator: string | null;
    bot: boolean;
    avatar: string | null;
    avatarURL: string | null;
    banner: string | null;
    bannerColor: string | null;
    accentColor: number | null;
    publicFlags: number;
    flags: number;
    clan: DiscordClan | null;
    primaryGuild: DiscordClan | null;
    avatarDecorationData: any | null;
    collectibles: DiscordCollectibles | null;
    displayNameStyles: DiscordDisplayNameStyles | null;
    createdAt: Date;

    constructor(data: any) {
        this.id = data.id;
        this.username = data.username;
        this.globalName = data.global_name ?? null;
        this.discriminator = data.discriminator ?? null;
        this.bot = data.bot ?? false;
        this.avatar = data.avatar ?? null;
        this.avatarURL = data.avatar
            ? `https://cdn.discordapp.com/avatars/${data.id}/${data.avatar}.png?size=1024`
            : null;
        this.banner = data.banner ?? null;
        this.bannerColor = data.banner_color ?? null;
        this.accentColor = data.accent_color ?? null;
        this.publicFlags = data.public_flags ?? 0;
        this.flags = data.flags ?? 0;
        this.clan = data.clan ?? null;
        this.primaryGuild = data.primary_guild ?? null;
        this.avatarDecorationData = data.avatar_decoration_data ?? null;
        this.collectibles = data.collectibles ?? null;
        this.displayNameStyles = data.display_name_styles ?? null;
        this.createdAt = new Date(Number((BigInt(data.id) >> 22n) + 1420070400000n));
    }

    get displayName(): string {
        return this.globalName ?? this.username;
    }

    get tag(): string {
        return this.discriminator && this.discriminator !== '0'
            ? `${this.username}#${this.discriminator}`
            : this.username;
    }
}
