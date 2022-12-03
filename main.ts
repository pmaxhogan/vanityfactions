import * as dotenv from 'dotenv' // see https://github.com/motdotla/dotenv#how-do-i-use-dotenv-with-import
import {
    APIInteractionDataResolvedGuildMember,
    APIInteractionGuildMember,
    CategoryChannel,
    ChannelType,
    ChatInputCommandInteraction,
    Client,
    escapeMarkdown,
    GatewayIntentBits,
    Guild,
    GuildChannel,
    GuildMember,
    HexColorString,
    OverwriteType,
    PermissionFlagsBits,
    REST,
    Role,
    Routes,
    TextChannel
} from "discord.js";
import {alliance, channelTypes, faction, readConfig, writeConfig} from "./config";

import commands from "./commands";
import colorsMap from "./colorsMap";

dotenv.config()

const config = await readConfig();

const client = new Client({
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessageReactions, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent, GatewayIntentBits.GuildMembers, GatewayIntentBits.GuildEmojisAndStickers],
    allowedMentions: {parse: []}
});

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
        case "faction leave":
            return await commandFactionLeave(interaction);
        case "faction delete":
            return await commandFactionDelete(interaction);
        case "faction set name":
            return await commandFactionSetName(interaction);
        case "faction set color":
            return await commandFactionSetColor(interaction);
        case "faction set invite":
            return await commandFactionSetInvite(interaction);
        case "faction kick":
            return await commandFactionKick(interaction);

        case "alliance create":
            return await commandAllianceCreate(interaction);
        case "alliance delete":
            return await commandAllianceDelete(interaction);
        case "alliance leave":
            return await commandAllianceLeave(interaction);
        case "alliance join":
            return await commandAllianceJoin(interaction);
        case "alliance kick":
            return await commandAllianceKick(interaction);
        default:
            console.log("Unknown command " + fullCommand);
            await interaction.reply({content: "Unknown command!", ephemeral: true});

    }

    await interaction.reply("???");
});

async function checkIfFactionNameUnique(guild: Guild, factionName: string) : Promise<boolean> {
    const others = (await getFactionRoles(guild)).map(role => role.name);

    return !others.find(role => role.trim().toLowerCase() === factionName.trim().toLowerCase());
}

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

    if (!await checkIfFactionNameUnique(interaction.guild, factionName)) {
        await interaction.reply({content: "A faction with that name already exists!", ephemeral: true});
        return;
    }

    const colorString = options.getString("color");
    let colorHex = findColor(colorString);
    if(!colorHex){
        await interaction.reply({content: "Invalid color!", ephemeral: true});
        return;
    }

    let role;
    try {
        role = await interaction.guild.roles.create({
            name: factionName,
            color: colorHex,
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
        isInviteOnly: true
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

    const adminFactionRole = await getMemberFactionRole(interaction.guild, adminMember);
    if(!adminFactionRole){
        await interaction.reply({content: "You are not in a faction!", ephemeral: true});
        return;
    }

    const targetFactionRole = await getMemberFactionRole(interaction.guild, targetMember);
    if(!targetFactionRole){
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

    const factionAlliances = config.alliances.filter(alliance => alliance.factions.includes(factionRole.id));
    for(const alliance of factionAlliances) {
        await member.roles.add(alliance.role);
    }

    const found = config.factions.find(faction => faction.role === factionRole.id);
    if(found.isInviteOnly){
        const sent = await politicsChannel.send(escapeMarkdown(`${member.displayName} (${member.user.tag}) wants to join ${factionName}!\nIf you are an admin of ${factionName}, click the checkmark to accept.`));
        await sent.react("✅");
        await interaction.reply(`Sent join request in <#${politicsChannel.id}>`);
        sent.createReactionCollector({}).on("collect", async (reaction, user) => {
            const reactionMember = reaction.message.guild?.members.cache.get(user.id);
            const isAdmin = await memberIsFactionAdmin(interaction.guild, reactionMember, adminChannel);
            if (!isAdmin) return;
            if (reaction.emoji.name === "✅") {
                await makeMemberFactionMember(interaction.guild, member, factionRole);

                await sent.reactions.removeAll();
                await sent.edit({content: escapeMarkdown(`${member.displayName} (${member.user.tag}) has joined ${factionName}!`)});
            }
        });
    }else{
        await makeMemberFactionMember(interaction.guild, member, factionRole);
        await interaction.reply(`Successfully joined ${factionName}!`);
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
    await member.roles.remove(await getFounderRole(interaction.guild));
    await interaction.reply(`Successfully deleted faction ${factionRole.name}!`);
}

async function commandFactionLeave(interaction: ChatInputCommandInteraction) {
    const member = interaction.member as GuildMember;

    const factionRole = await getMemberFactionRole(interaction.guild, member);
    if (!factionRole) {
        await interaction.reply({content: "You are not in a faction!", ephemeral: true});
        return;
    }

    if (await memberIsFounder(interaction.guild, member)) {
        await interaction.reply({content: "You are the founder of a faction! Use /faction delete instead.", ephemeral: true});
        return;
    }

    await removeMemberFromFaction(interaction.guild, member, factionRole, interaction);
    await interaction.reply(`Successfully left faction ${factionRole.name}!`);
}

async function commandFactionKick(interaction: ChatInputCommandInteraction){
    const resp = await factionAdminOnlyCommand(interaction);
    if(!resp) return;
    const [_, factionRole] = resp;

    const member = interaction.options.getMember("name") as GuildMember;
    await removeMemberFromFaction(interaction.guild, member, factionRole, interaction);

    await interaction.reply(`Successfully kicked ${member.displayName} from ${factionRole.name}!`);
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
    const resp = await factionFounderInAllianceCommand(interaction, false);
    if(!resp) return;
    const [memberFoundingFactionRole, allianceRole, found, member] = resp;

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
        content: escapeMarkdown(`<@${member.id}> wants to join ${allianceRole.name}! If you are the founder of ${allianceRole.name}, react with ✅ to accept.`),
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
    const resp = await factionFounderInAllianceCommand(interaction, false);
    if(!resp) return;
    const [memberFoundingFactionRole, allianceRole, found] = resp;

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
    const resp = await factionFounderInAllianceCommand(interaction, true);
    if(!resp) return;
    const [, , found] = resp;

    if(!found){
        await interaction.reply({content: "Invalid alliance, you must be the founder!", ephemeral: true});
        return;
    }
    await deleteAlliance(interaction.guild, found);

    await interaction.reply(`Alliance deleted!`);
}

async function commandFactionSetName(interaction: ChatInputCommandInteraction){
    const resp = await factionAdminOnlyCommand(interaction);
    if(!resp) return;
    const [_, factionRole] = resp;

    const name = interaction.options.getString("name");
    if(!nameValid(name)){
        await interaction.reply({content: "Invalid name!", ephemeral: true});
        return;
    }

    if(!await checkIfFactionNameUnique(interaction.guild, name)){
        await interaction.reply({content: "Name already taken!", ephemeral: true});
        return;
    }

    await factionRole.setName(name);
    await interaction.reply(`Faction name set to ${name}!`);
}

async function commandFactionSetColor(interaction: ChatInputCommandInteraction){
    const resp = await factionAdminOnlyCommand(interaction);
    if(!resp) return;
    const [_, factionRole] = resp;

    const color = interaction.options.getString("name");
    let colorHex = findColor(color);
    if(!colorHex){
        await interaction.reply({content: "Invalid color!", ephemeral: true});
        return;
    }

    await factionRole.setColor(colorHex);
    await interaction.reply(`Faction color set to ${color}!`);
}

async function commandFactionSetInvite(interaction: ChatInputCommandInteraction){
    const resp = await factionAdminOnlyCommand(interaction);
    if(!resp) return;
    const [_, factionRole] = resp;

    const status = interaction.options.getString("status");
    const found = config.factions.find(faction => faction.role === factionRole.id);
    found.isInviteOnly = status === "admin-only";
    await writeConfig(config);

    await interaction.reply(`Faction invite status set to ${status}!`);
}

async function commandAllianceKick(interaction: ChatInputCommandInteraction){
    const resp = await factionFounderInAllianceCommand(interaction, true);
    if(!resp) return;
    const [memberFoundingFactionRole, allianceRole, found] = resp;
    const factionName = interaction.options.getString("faction");

    if(!found || !found.factions.includes(memberFoundingFactionRole.id)){
        await interaction.reply({content: "Can't kick from that alliance!", ephemeral: true});
        return;
    }

    const factionRole = await getFactionRole(interaction.guild, factionName);
    if(!factionRole){
        await interaction.reply({content: "Faction not found!", ephemeral: true});
        return;
    }

    if(!found.factions.includes(factionRole.id)){
        await interaction.reply({content: "Faction not in alliance!", ephemeral: true});
        return;
    }

    found.factions = found.factions.filter(faction => faction !== factionRole.id);
    await writeConfig(config);

    for(const [_, factionMember] of factionRole.members){
        await factionMember.roles.remove(allianceRole);
    }

    await interaction.reply(`Kicked faction ${factionRole.name} from alliance ${allianceRole.name}!`);
}

// utility

async function factionFounderInAllianceCommand(interaction: ChatInputCommandInteraction, founder: boolean): Promise<[Role, Role, alliance, GuildMember]>{
    const member = interaction.member as GuildMember;
    const allianceName = interaction.options.getString("name");
    const memberFoundingFactionRole = await getFoundingFactionRoleForAlliance(interaction);
    if(!memberFoundingFactionRole) return;

    const allianceRole = await getAllianceRole(interaction.guild, allianceName);
    if (!allianceRole) {
        await interaction.reply({content: "Alliance not found!", ephemeral: true});
        return;
    }
    const found = config.alliances.find(alliance => alliance.role === allianceRole.id && (alliance.roleOfFoundingFaction === memberFoundingFactionRole.id) === founder);

    return [memberFoundingFactionRole, allianceRole, found, member];
}

function findColor(colorString: string): HexColorString{
    if(colorString && colorsMap.has(colorString)) return colorsMap.get(colorString.toLowerCase().replaceAll(" ", ""));
    else if(colorString && colorString.match(/^#[0-9a-f]{6}$/i)) return colorString as HexColorString;
    return null;
}

async function factionAdminOnlyCommand(interaction: ChatInputCommandInteraction): Promise<[GuildMember, Role]> {
    const member = interaction.member as GuildMember;
    const factionRole = await getMemberFactionRole(interaction.guild, member);
    if(!factionRole){
        await interaction.reply({content: "You are not in a faction!"});
        return;
    }

    let adminChannel:GuildChannel;
    try {
        adminChannel = await getFactionChannel(interaction.guild, factionRole.name, channelTypes.adminChannel);
    } catch (e) {
        console.error(e);
        await interaction.reply({content: "Error getting admin channel!", ephemeral: true});
        return;
    }
    if(!await memberIsFactionAdmin(interaction.guild, member, adminChannel)){
        await interaction.reply({content: "You need to be an admin!"});
        return;
    }

    return [member, factionRole];
}

async function removeMemberFromFaction(guild:Guild, member:GuildMember, factionRole: Role, interaction: ChatInputCommandInteraction){
    let adminChannel:GuildChannel;
    try {
        adminChannel = await getFactionChannel(guild, factionRole.name, channelTypes.adminChannel);
    } catch (e) {
        console.error(e);
        await interaction.reply({content: "Error getting admin channel!", ephemeral: true});
        return;
    }

    try {
        await makeMemberNotFactionAdmin(interaction.guild, member, adminChannel);
    } catch (e) {
        console.error(e);
        await interaction.reply({content: "Error removing permissions!", ephemeral: true});
        return;
    }

    const factionAlliances = config.alliances.filter(alliance => alliance.factions.includes(factionRole.id));
    for(const alliance of factionAlliances) {
        await member.roles.remove(alliance.role);
    }

    await member.roles.remove(factionRole);
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

async function deleteChannelsInCategory(category:CategoryChannel) {
    const channels = category.children.cache;
    for (const [_, channel] of channels) {
        await channel.delete();
    }
}

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
    return await getMemberFactionRole(guild, member);
}

async function memberIsFounder(guild: Guild, member: GuildMember) {
    const role = await getFounderRole(guild);
    return member.roles.cache.has(role.id);
}

async function memberIsFactionAdmin(guild: Guild, member: GuildMember, adminChannel: GuildChannel) {
    return adminChannel.permissionsFor(member).has(PermissionFlagsBits.ViewChannel);
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
        return false;
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

