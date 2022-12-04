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

type isoDate = string;

interface configObject{
    current: Config,
    historic: [key: isoDate, value: Config][]
}

const defaultConfig:configObject = {current: {factions: [], alliances: []}, historic: []};

let cachedConfig: configObject = null;

const path = "config.json";
export async function readConfig(): Promise<Config> {
    let text;
    try {
        text = await fs.readFile(path, "utf8");
    } catch (e) {
        if(e.code === "ENOENT") {
            await fs.writeFile(path, JSON.stringify(defaultConfig));
            return await readConfig();
        }
        throw e;
    }
    const parsed = JSON.parse(text) as configObject;
    cachedConfig = parsed;
    return parsed.current;
}

function deepClone(obj: any): any {
    return JSON.parse(JSON.stringify(obj));
}

export async function writeConfig(newConfig: Config): Promise<void> {
    if(!cachedConfig){
        await readConfig();
    }

    cachedConfig.historic.push([new Date().toISOString(), deepClone(newConfig)]);
    cachedConfig.current = deepClone(newConfig);

    const text = JSON.stringify(cachedConfig);
    await fs.writeFile(path, text, "utf8");
}
