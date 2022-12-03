import * as dotenv from 'dotenv' // see https://github.com/motdotla/dotenv#how-do-i-use-dotenv-with-import
dotenv.config()

import {
    REST,
    Routes,
    Client,
    GatewayIntentBits,
    ChannelType,
    PermissionFlagsBits,
    OverwriteType,
    escapeMarkdown,
    CacheType,
    ChatInputCommandInteraction,
    APIInteractionGuildMember,
    Guild,
    GuildMember,
    Role,
    APIInteractionDataResolvedGuildMember,
    Collection,
    Colors,
    ColorResolvable,
    TextChannel,
    CacheTypeReducer,
    GuildTextBasedChannel,
    GuildChannel,
    CategoryChannel
} from "discord.js";

import {SlashCommandBuilder} from "@discordjs/builders";
import {resolveColor} from "discord.js";
import {alliance, channelTypes, Config, faction, readConfig, writeConfig} from "./config";

const config = await readConfig();

const client = new Client({
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessageReactions, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent, GatewayIntentBits.GuildMembers, GatewayIntentBits.GuildEmojisAndStickers],
    allowedMentions: {parse: []}
});

const specialRoles = process.env.SPECIAL_ROLES.split(",");

import commands from "./commands";

const rest = new REST({version: '10'}).setToken(process.env.DISCORD_TOKEN);

try {
    console.log("Started refreshing application (/) commands.");

    await rest.put(Routes.applicationCommands(process.env.CLIENT_ID), {body: commands});

    console.log("Successfully reloaded application (/) commands.");
} catch (error) {
    console.error(error);
}

client.on('ready', () => {
    console.log(`Logged in as ${client.user.tag}!`);
});

interface hasForEach<T> {
    forEach(callback: (value: T, key: any, map: any) => void): void;
}

function mapToArray<T>(map: hasForEach<T>) : T[] {
    const arr: T[] = [];
    map.forEach((value) => arr.push(value));
    return arr;
}

const getFactionRoles = async (guild: Guild) : Promise<Role[]> => {
    const roles = config.factions.map(faction => faction.role);
    const guildRoles = await guild.roles.fetch();
    return mapToArray(guildRoles.filter(role => roles.includes(role.id)));
};

const getAllianceRoles = async (guild: Guild) : Promise<Role[]> => {
    const roles = config.alliances.map(alliance => alliance.role);
    const guildRoles = await guild.roles.fetch();
    return mapToArray(guildRoles.filter(role => roles.includes(role.id)));
};

const nameValid = (name: string) : boolean => name && name.length > 0 && name.length < 32;// && Boolean(name.match(/^[a-z0-9_-]+$/i));
const nameToChannelName = (name: string) : string => name.toLowerCase().replace(/ /g, "-");

client.on('interactionCreate', async interaction => {
    if (!interaction.isChatInputCommand()) return;

    // get parameters
    const {commandName, options} = interaction;
    const fullCommand = commandName + " " + (options.getSubcommandGroup() ? options.getSubcommandGroup() + " " : "") + options.getSubcommand();

    switch (fullCommand) {
        case "faction create":
            return await commandFactionCreate(interaction);
        case "faction admins add":
            return await commandFactionAdminsUpdate(interaction, true);
        case "faction admins remove":
            return await commandFactionAdminsUpdate(interaction, false);
        case "faction join":
            return await commandFactionJoin(interaction);
        case "faction delete":
            return await commandFactionDelete(interaction);
        case "alliance create":
            return await commandAllianceCreate(interaction);
        case "alliance delete":
            return await commandAllianceDelete(interaction);
        case "alliance leave":
            return await commandAllianceLeave(interaction);
        case "alliance join":
            return await commandAllianceJoin(interaction);
        default:
            console.log("Unknown command " + fullCommand);
            await interaction.reply({content: "Unknown command!", ephemeral: true});

    }

    await interaction.reply("???");
});


// command

async function commandFactionCreate(interaction: ChatInputCommandInteraction) {
    const options = interaction.options;

    if (await memberIsFounder(interaction.guild, interaction.member as GuildMember)) {
        await interaction.reply({content: "You are already the founder of a faction.", ephemeral: true});
        return;
    }

    if (await memberIsInAFaction(interaction.guild, interaction.member as GuildMember)) {
        await interaction.reply({content: "You are already in a faction.", ephemeral: true});
        return;
    }

    const factionName = options.getString("name");
    if (!nameValid(factionName)) {
        await interaction.reply({content: "Invalid / missing faction name", ephemeral: true});
        return;
    }

    const others = (await getFactionRoles(interaction.guild)).map(role => role.name);
    console.log(factionName, others);

    if (others.find(role => role.trim().toLowerCase() === factionName.trim().toLowerCase())) {
        await interaction.reply({content: "A faction with that name already exists!", ephemeral: true});
        return;
    }

    const colorString = options.getString("color");

    // @ts-ignore - color is checked
    const color:ColorResolvable = Object.keys(Colors).find(key => key.toLowerCase() === colorString.toLowerCase());

    if (!color) {
        await interaction.reply({content: "Invalid color!", ephemeral: true});
        return;
    }

    let role;
    try {
        role = await interaction.guild.roles.create({
            name: factionName,
            color,
            reason: "Faction created by " + interaction.user.tag,
            hoist: true
        });
    } catch (e) {
        console.error(e);
        await interaction.reply({content: "Error creating role!", ephemeral: true});
        return;
    }

    // make a channel category
    const category = await interaction.guild.channels.create({
        type: ChannelType.GuildCategory,
        reason: "Faction created by " + interaction.user.tag,
        name: factionName,
        permissionOverwrites: [
            {
                id: role.id,
                allow: [PermissionFlagsBits.ViewChannel]
            },
            {
                id: interaction.guild.roles.everyone,
                deny: [PermissionFlagsBits.ViewChannel]
            }
        ]
    });


    let adminChannel, textChannel, voiceChannel;
    try {
        textChannel = await interaction.guild.channels.create({
            type: ChannelType.GuildText,
            parent: category,
            reason: "Faction created by " + interaction.user.tag,
            name: nameToChannelName(factionName),
        });

        adminChannel = await interaction.guild.channels.create({
            type: ChannelType.GuildText,
            parent: category,
            reason: "Faction created by " + interaction.user.tag,
            name: nameToChannelName(factionName) + "-admin",
            permissionOverwrites: [
                {
                    id: interaction.guild.roles.everyone,
                    deny: [PermissionFlagsBits.ViewChannel],
                    type: OverwriteType.Role
                }
            ]
        });

        voiceChannel = await interaction.guild.channels.create({
            type: ChannelType.GuildVoice,
            parent: category,
            reason: "Faction created by " + interaction.user.tag,
            name: nameToChannelName(factionName) + "-vc",
        });
    } catch (e) {
        console.error(e);
        await interaction.reply({content: "Error creating channels!", ephemeral: true});
        return;
    }


    config.factions.push({
        channelCategory: category.id,
        role: role.id,
        [channelTypes.textChannel]: textChannel.id,
        [channelTypes.adminChannel]: adminChannel.id,
        [channelTypes.voiceChannel]: voiceChannel.id,
    });
    await writeConfig(config);

    const member = interaction.member as GuildMember;

    try {
        await makeMemberFactionMember(interaction.guild, member, role);
        await makeMemberFactionAdmin(interaction.guild, member, adminChannel);
        await makeMemberAFounder(interaction.guild, member);
    } catch (e) {
        console.error(e);
        await interaction.reply({content: "Error assigning permissions!", ephemeral: true});
    }

    await interaction.reply({content: "Faction created!", ephemeral: true});
}

async function commandFactionAdminsUpdate(interaction: ChatInputCommandInteraction, add: boolean) {
    const adminMember = interaction.member as GuildMember;
    if (!await memberIsFounder(interaction.guild, adminMember) || !await memberIsInAFaction(interaction.guild, adminMember)) {
        await interaction.reply({content: "You are not the founder of a faction.", ephemeral: true});
        return;
    }
    const targetMember = interaction.options.getMember("user") as GuildMember;

    let adminFactionRole;
    try {
        adminFactionRole = await getMemberFactionRole(interaction.guild, adminMember);
    } catch (e) {
        await interaction.reply({content: "You are not in a faction!", ephemeral: true});
        return;
    }

    let targetFactionRole;
    try {
        targetFactionRole = await getMemberFactionRole(interaction.guild, targetMember);
    } catch (e) {
        console.error(e);
        await interaction.reply({content: "That user is not in your faction.", ephemeral: true});
        return;
    }
    if (!adminFactionRole?.id || !targetFactionRole?.id || adminFactionRole.id !== targetFactionRole.id) {
        console.log(adminFactionRole?.id, targetFactionRole?.id);
        await interaction.reply({content: "That user is not in your faction.", ephemeral: true});
        return;
    }

    if(await memberIsFounder(interaction.guild, targetMember)) {
        await interaction.reply({content: "That user is the founder of the faction.", ephemeral: true});
        return;
    }

    let adminChannel:GuildChannel;
    try {
        adminChannel = await getFactionChannel(interaction.guild, targetFactionRole.name, channelTypes.adminChannel);
    } catch (e) {
        console.error(e);
        await interaction.reply({content: "Error getting admin channel!", ephemeral: true});
        return;
    }

    if (!adminChannel) {
        await interaction.reply({content: "Error getting admin channel!", ephemeral: true});
        return;
    }

    try {
        if (add) await makeMemberFactionAdmin(interaction.guild, targetMember, adminChannel);
        else await makeMemberNotFactionAdmin(interaction.guild, targetMember, adminChannel);
    } catch (e) {
        console.error(e);
        await interaction.reply({content: "Error assigning permissions!", ephemeral: true});
        return;
    }

    await interaction.reply(`Successfully ${add ? "added" : "removed"} ${targetMember.displayName} as a faction admin.`);
}

async function commandFactionJoin(interaction: ChatInputCommandInteraction) {
    const member = interaction.member as GuildMember;
    const factionName = interaction.options.getString("name");
    if (!nameValid(factionName)) {
        await interaction.reply({content: "Invalid / missing faction name", ephemeral: true});
        return;
    }

    let factionRole:Role;
    try {
        factionRole = await getFactionRole(interaction.guild, factionName);
    } catch (e) {
        await interaction.reply({content: "That faction does not exist!", ephemeral: true});
        return;
    }
    if (!factionRole) {
        await interaction.reply({content: "That faction does not exist.", ephemeral: true});
        return;
    }

    if (await memberIsFounder(interaction.guild, member)) {
        await interaction.reply({content: "You are already the founder of a faction.", ephemeral: true});
        return;
    }

    if (await memberIsInAFaction(interaction.guild, member)) {
        await interaction.reply({content: "You are already in a faction.", ephemeral: true});
        return;
    }

    let adminChannel:GuildChannel;
    try {
        adminChannel = await getFactionChannel(interaction.guild, factionName, channelTypes.adminChannel);
    } catch (e) {
        console.error(e);
        await interaction.reply({content: "Error getting admin channel!", ephemeral: true});
        return;
    }

    let politicsChannel:TextChannel;
    try {
        politicsChannel = await getPoliticsChannel(interaction.guild);
    } catch (e) {
        console.error(e);
        await interaction.reply({content: "Error getting politics channel!", ephemeral: true});
        return;
    }

    const sent = await politicsChannel.send(escapeMarkdown(`${member.displayName} (${member.user.tag}) wants to join ${factionName}!\nIf you are an admin of ${factionName}, click the checkmark to accept.`));
    await sent.react("✅");
    await interaction.reply(`Sent join request in <#${politicsChannel.id}>`);
    sent.createReactionCollector({}).on("collect", async (reaction, user) => {
        const reactionMember = reaction.message.guild?.members.cache.get(user.id);
        const isAdmin = await memberIsFactionAdmin(interaction.guild, reactionMember, adminChannel);
        if (!isAdmin) return;
        if (reaction.emoji.name === "✅") {
            await makeMemberFactionMember(interaction.guild, member, factionRole);
            await sent.delete();

            await sent.reactions.removeAll();
            await sent.edit({content: escapeMarkdown(`${member.displayName} (${member.user.tag}) has joined ${factionName}!`)});
        }
    });
}

async function deleteChannelsInCategory(category:CategoryChannel) {
    const channels = category.children.cache;
    for (const [_, channel] of channels) {
        await channel.delete();
    }
}

async function commandFactionDelete(interaction: ChatInputCommandInteraction) {
    const member = interaction.member as GuildMember;

    const factionRole = await getMemberFactionRole(interaction.guild, member);
    if (!factionRole) {
        await interaction.reply({content: "You are not in a faction!", ephemeral: true});
        return;
    }
    if (!await memberIsFounder(interaction.guild, member)) {
        await interaction.reply({content: "You are not the founder of a faction!", ephemeral: true});
        return;
    }

    const category = await getFactionCategory(interaction.guild, factionRole.name);
    if (!category) {
        await interaction.reply({content: "Error getting category!", ephemeral: true});
        return;
    }

    const factionObj = config.factions.find(faction => faction.role === factionRole.id);
    if (!factionObj) {
        await interaction.reply({content: "Error getting faction object!", ephemeral: true});
        return;
    }
    config.factions.splice(config.factions.indexOf(factionObj), 1);
    await writeConfig(config);

    const foundedAlliances = config.alliances.filter(alliance => alliance.roleOfFoundingFaction === factionRole.id);
    for (const alliance of foundedAlliances) {
        await deleteAlliance(interaction.guild, alliance);
    }

    await deleteChannelsInCategory(category);
    await category.delete();
    await factionRole.delete();
    await interaction.reply(`Successfully deleted faction ${factionRole.name}!`);
}

async function getFoundingFactionRoleForAlliance(interaction: ChatInputCommandInteraction): Promise<Role> {
    const member = interaction.member as GuildMember;
    const allianceName = interaction.options.getString("name");
    if (!nameValid(allianceName)) {
        await interaction.reply({content: "Invalid / missing alliance name", ephemeral: true});
        return;
    }

    const memberFactionRole = await getMemberFactionRole(interaction.guild, member);
    if(!memberFactionRole){
        await interaction.reply({content: "You are not in a faction!", ephemeral: true});
        return;
    }

    if (!await memberIsFounder(interaction.guild, member)) {
        await interaction.reply({content: "You need to be the founder of a faction.", ephemeral: true});
        return;
    }
    return memberFactionRole;
}

async function commandAllianceCreate(interaction: ChatInputCommandInteraction){
    const member = interaction.member as GuildMember;
    const allianceName = interaction.options.getString("name");
    const memberFoundingFactionRole = await getFoundingFactionRoleForAlliance(interaction);
    if(!memberFoundingFactionRole) return;

    const others = (await getAllianceRoles(interaction.guild)).map(role => role.name);
    if (others.find(role => role.trim().toLowerCase() === allianceName.trim().toLowerCase())) {
        await interaction.reply({content: "An alliance with that name already exists!", ephemeral: true});
        return;
    }

    const foundedAlliances = config.alliances.filter(alliance => alliance.roleOfFoundingFaction === memberFoundingFactionRole.id);
    if (foundedAlliances.length > memberFoundingFactionRole.members.size){
        await interaction.reply({content: "You have already founded too many alliances!", ephemeral: true});
        return;
    }


    const allianceRole = await interaction.guild.roles.create({
        name: allianceName,
    });

    // make a channel category
    const category = await interaction.guild.channels.create({
        type: ChannelType.GuildCategory,
        reason: "Faction created by " + interaction.user.tag,
        name: allianceName,
        permissionOverwrites: [
            {
                id: allianceRole.id,
                allow: [PermissionFlagsBits.ViewChannel]
            },
            {
                id: interaction.guild.roles.everyone,
                deny: [PermissionFlagsBits.ViewChannel]
            }
        ]
    });

    const textChannel = await interaction.guild.channels.create({
        type: ChannelType.GuildText,
        parent: category,
        reason: "Faction created by " + interaction.user.tag,
        name: nameToChannelName(allianceName),
    });

    const voiceChannel = await interaction.guild.channels.create({
        type: ChannelType.GuildVoice,
        parent: category,
        reason: "Faction created by " + interaction.user.tag,
        name: nameToChannelName(allianceName) + "-vc",
    });

    // assign roles to all members of the faction
    const factionMembers = memberFoundingFactionRole.members;
    for (const [_, member] of factionMembers) {
        await member.roles.add(allianceRole);
    }

    config.alliances.push({
        channelCategory: category.id,
        roleOfFoundingFaction: memberFoundingFactionRole.id,
        [channelTypes.textChannel]: textChannel.id,
        [channelTypes.voiceChannel]: voiceChannel.id,
        role: allianceRole.id,
        factions: [memberFoundingFactionRole.id]
    });
    await writeConfig(config);

    let politicsChannel:TextChannel;
    try {
        politicsChannel = await getPoliticsChannel(interaction.guild);
    } catch (e) {
        console.error(e);
        await interaction.reply({content: "Error getting politics channel!", ephemeral: true});
        return;
    }
    await politicsChannel.send({
        content: escapeMarkdown(`${member.displayName} (${member.user.tag}) created an alliance <@&${allianceRole.id}>!`),
        allowedMentions: {
            roles: [allianceRole.id]
        }
    });
    await interaction.reply(`Alliance created!`);
}


async function commandAllianceJoin(interaction: ChatInputCommandInteraction){
    const member = interaction.member as GuildMember;
    const allianceName = interaction.options.getString("name");
    const memberFoundingFactionRole = await getFoundingFactionRoleForAlliance(interaction);
    if(!memberFoundingFactionRole) return;

    const allianceRole = await getAllianceRole(interaction.guild, allianceName);
    if (!allianceRole) {
        await interaction.reply({content: "Alliance not found!", ephemeral: true});
        return;
    }
    const found = config.alliances.find(alliance => alliance.role === allianceRole.id && alliance.roleOfFoundingFaction !== memberFoundingFactionRole.id);
    if(!found || found.factions.includes(memberFoundingFactionRole.id)){
        await interaction.reply({content: "You are already in this alliance!", ephemeral: true});
        return;
    }
    console.log(memberFoundingFactionRole.id, found.factions);

    let politicsChannel:TextChannel;
    try {
        politicsChannel = await getPoliticsChannel(interaction.guild);
    }
    catch (e) {
        console.error(e);
        await interaction.reply({content: "Error getting politics channel!", ephemeral: true});
        return;
    }
    const sent = await politicsChannel.send({
        content: escapeMarkdown(`<@${member.id}> wants to join ${allianceName}! If you are the founder of ${allianceName}, react with ✅ to accept.`),
    });
    await sent.react("✅");
    await interaction.reply(`Sent join request in <#${politicsChannel.id}>!`);
    sent.createReactionCollector({}).on("collect", async (reaction, user) => {
        const reactionMember = reaction.message.guild?.members.cache.get(user.id);
        const isFounder = await memberIsFounder(reaction.message.guild, reactionMember);
        if (!isFounder) return;

        const faction = await getMemberFactionRole(reaction.message.guild, reactionMember);
        if(!faction || faction.id !== found.roleOfFoundingFaction) return;

        if (reaction.emoji.name === "✅") {
            // assign roles to all members of the faction
            const factionMembers = memberFoundingFactionRole.members;
            for (const [_, factionMember] of factionMembers) {
                await factionMember.roles.add(allianceRole);
            }

            found.factions.push(memberFoundingFactionRole.id);
            await writeConfig(config);

            await sent.edit({content: escapeMarkdown(`<@&${memberFoundingFactionRole.id}> has joined the alliance <@&${allianceRole.id}>!`)});
            await sent.reactions.removeAll();
        }
    });
}

async function commandAllianceLeave(interaction: ChatInputCommandInteraction){
    const member = interaction.member as GuildMember;
    const allianceName = interaction.options.getString("name");
    const memberFoundingFactionRole = await getFoundingFactionRoleForAlliance(interaction);
    if(!memberFoundingFactionRole) return;

    const allianceRole = await getAllianceRole(interaction.guild, allianceName);
    if (!allianceRole) {
        await interaction.reply({content: "Alliance not found!", ephemeral: true});
        return;
    }
    const found = config.alliances.find(alliance => alliance.role === allianceRole.id && alliance.roleOfFoundingFaction !== memberFoundingFactionRole.id);
    if(!found || !found.factions.includes(memberFoundingFactionRole.id)){
        await interaction.reply({content: "Can't leave that alliance!", ephemeral: true});
        return;
    }
    found.factions = found.factions.filter(faction => faction !== memberFoundingFactionRole.id);
    await writeConfig(config);

    let politicsChannel:TextChannel;
    try {
        politicsChannel = await getPoliticsChannel(interaction.guild);
    }
    catch (e) {
        console.error(e);
        await interaction.reply({content: "Error getting politics channel!", ephemeral: true});
        return;
    }

    for(const [_, factionMember] of memberFoundingFactionRole.members){
        await factionMember.roles.remove(allianceRole);
    }

    await politicsChannel.send({
        content: escapeMarkdown(`<@&${memberFoundingFactionRole.id}> left the alliance <@&${allianceRole.id}>!`),
        allowedMentions: {
            roles: [allianceRole.id, memberFoundingFactionRole.id]
        }
    });
    await interaction.reply(`Left alliance!`);
}

async function commandAllianceDelete(interaction: ChatInputCommandInteraction){
    const member = interaction.member as GuildMember;

    if(!await memberIsFounder(interaction.guild, member)) {
        await interaction.reply({content: "You need to be a founder!"});
        return;
    }

    const allianceName = interaction.options.getString("name");
    const allianceRole = await getAllianceRole(interaction.guild, allianceName);
    if(!allianceRole){
        await interaction.reply({content: "Invalid alliance name!", ephemeral: true});
        return;
    }

    const factionRole = await getMemberFactionRole(interaction.guild, member);
    if(!factionRole){
        await interaction.reply({content: "You are not in a faction!"});
        return;
    }

    const found = config.alliances.find(alliance => alliance.role === allianceRole.id && alliance.roleOfFoundingFaction === factionRole.id);
    if(!found){
        await interaction.reply({content: "Error getting alliance object!", ephemeral: true});
        return;
    }
    await deleteAlliance(interaction.guild, found);
}

// utility

async function deleteAlliance(guild: Guild, alliance: alliance){
    const category = guild.channels.cache.get(alliance.channelCategory) as CategoryChannel;
    const allianceRole = guild.roles.cache.get(alliance.role);
    if(!category){
        throw new Error("Error getting category!");
    }
    if(!allianceRole){
        throw new Error("Error getting alliance role!");
    }

    await deleteChannelsInCategory(category);
    await category.delete();

    if (allianceRole) await allianceRole.delete();

    config.alliances.splice(config.alliances.indexOf(alliance), 1);
    await writeConfig(config);
}

async function memberIsInAFaction(guild: Guild, member: GuildMember) {
    try {
        return await getMemberFactionRole(guild, member) !== undefined;
    } catch (e) {
        return false;
    }
}

async function memberIsFounder(guild: Guild, member: GuildMember) {
    const role = await getFounderRole(guild);
    return member.roles.cache.has(role.id);
}

async function memberIsFactionAdmin(guild: Guild, member: GuildMember, adminChannel: GuildChannel) {
    return adminChannel.permissionsFor(member).has(PermissionFlagsBits.ViewChannel);
}

async function memberIsFounderOfFaction(guild: Guild, member: GuildMember, faction: any) {
    const factionRole = await getFactionRole(guild, faction.name);
    if(!factionRole) return false;
    return await memberIsFounder(guild, member) && mapToArray(member.roles.cache).find(role => factionRole.id === role.id);
}

async function makeMemberFactionMember(guild: Guild, member: GuildMember, factionRole: Role) {
    console.log("adding role", factionRole.id);
    await member.roles.add(factionRole);
}

async function makeMemberFactionAdmin(guild: Guild, member: NonNullable<GuildMember>, adminChannel: GuildChannel) {
    await adminChannel.permissionOverwrites.edit(member, {
        "ViewChannel": true,
    });
}

async function makeMemberNotFactionAdmin(guild: Guild, member: NonNullable<GuildMember>, adminChannel: GuildChannel) {
    await adminChannel.permissionOverwrites.edit(member, {
        "ViewChannel": false,
    });
}

async function makeMemberAFounder(guild: Guild, member: GuildMember) {
    const founderRole = await getFounderRole(guild);
    console.log("adding role", founderRole.id);
    await member.roles.add(founderRole);
}

async function getFounderRole(guild: Guild) {
    const founderRole = await guild.roles.fetch(process.env.FOUNDER_ROLE);
    if(!founderRole){
        throw new Error("Founder role not found!");
    }
    return founderRole;
}

async function getFactionRole(guild: Guild, name: string){
    const roles = await getFactionRoles(guild);
    return roles.find(role => role.name.toLowerCase() === name.toLowerCase());
}

async function getAllianceRole(guild: Guild, name: string){
    const roles = await getAllianceRoles(guild);
    return roles.find(role => role.name.toLowerCase() === name.toLowerCase());
}

async function getMemberFactionRole(guild: Guild, member: NonNullable<GuildMember>) {
    const roles = await getFactionRoles(guild);
    const factionRole = roles.find(role => member.roles.cache.has(role.id));
    if(!factionRole){
        throw new Error("Member is not in a faction!");
    }
    return factionRole;
}

async function getFactionObj(guild:Guild, roleName:string): Promise<faction> {
    const role = await getFactionRole(guild, roleName);
    const factionObj = config.factions.find(faction => faction.role === role.id);
    if(!factionObj){
        throw new Error("Category not found!");
    }
    return factionObj;
}

async function getFactionCategory (guild: Guild, roleName : string): Promise<CategoryChannel> {
    const factionObj = await getFactionObj(guild, roleName);

    const channels = await guild.channels.fetch();
    const category = channels.find(channel => channel.id === factionObj.channelCategory && channel.type === ChannelType.GuildCategory);
    if(!category){
        throw new Error("Category not found!");
    }
    return category as CategoryChannel;
}

async function getFactionChannel(guild: Guild, roleName: string, channelType: channelTypes){
    const factionObj = await getFactionObj(guild, roleName);
    const category = await getFactionCategory(guild, roleName);

    const channels = await guild.channels.fetch();
    const channel = channels.find(channel => channel.id === factionObj[channelType] && channel.parentId === category.id);
    if(!channel){
        throw new Error("Category not found!");
    }
    return channel;
}

async function getPoliticsChannel(guild: Guild) {
    const id = process.env.POLITICS_CHANNEL;
    const found = await guild.channels.fetch(id);
    if (!found || found.type !== ChannelType.GuildText) {
        throw new Error("Channel not found!");
    }
    return found;
}

await client.login(process.env.DISCORD_TOKEN);

