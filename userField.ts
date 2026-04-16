export class DiscordUser {
    id: string;
    username: string;
    globalName: string | null;
    discriminator: string | null;
    bot: boolean;
    avatar: string | null;
    avatarURL: string | null;
    banner: string | null;
    accentColor: number | null;
    clan: any | null;
    primaryGuild: any | null;
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
        this.accentColor = data.accent_color ?? null;
        this.clan = data.clan ?? null;
        this.primaryGuild = data.primary_guild ?? null;
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
