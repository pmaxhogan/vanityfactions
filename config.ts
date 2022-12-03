import { promises as fs } from "fs";
import {Snowflake} from "discord.js";

export interface faction {
    role: Snowflake,
    channelCategory: Snowflake,
    [channelTypes.textChannel]: Snowflake,
    [channelTypes.voiceChannel]: Snowflake
    [channelTypes.adminChannel]: Snowflake,
    isInviteOnly: boolean,
}

export interface alliance {
    roleOfFoundingFaction: Snowflake,
    factions: Snowflake[],
    role: Snowflake,
    channelCategory: Snowflake,
    [channelTypes.textChannel]: Snowflake,
    [channelTypes.voiceChannel]: Snowflake
}

export interface Config{
    factions: faction[];
    alliances: alliance[];
}

export enum channelTypes{
    textChannel = "textChannel",
    voiceChannel = "voiceChannel",
    adminChannel = "adminChannel"
}

const path = "config.json";
export async function readConfig(): Promise<Config> {
    const text = await fs.readFile(path, "utf8");
    return JSON.parse(text);
}

export async function writeConfig(config: Config): Promise<void> {
    const text = JSON.stringify(config);
    await fs.writeFile(path, text, "utf8");
}
