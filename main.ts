import * as dotenv from 'dotenv' // see https://github.com/motdotla/dotenv#how-do-i-use-dotenv-with-import
import {
    APIInteractionDataResolvedGuildMember,
    APIInteractionGuildMember,
    CategoryChannel,
    ChannelType,
    ChatInputCommandInteraction,
    Client, EmbedBuilder,
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
    Routes
} from "discord.js";
import {alliance, channelTypes, faction, readConfig, writeConfig} from "./config";

import commands from "./commands";
import colorsMap from "./colorsMap";
import helpDescription from './helpDescription';

dotenv.config()

const config = await readConfig();

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessageReactions,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.GuildEmojisAndStickers,
    ],
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
    const configRoles = config.factions.map(faction => faction.role);
    const guildRoles = await guild.roles.fetch();
    const roles = mapToArray(guildRoles.filter(role => configRoles.includes(role.id)));
    const rolesResults = [];
    for (const role of roles) {
        rolesResults.push(guild.roles.fetch(role.id));
    }

    return Promise.all(rolesResults);
};

const getAllianceRoles = async (guild: Guild) : Promise<Role[]> => {
    const roles = config.alliances.map(alliance => alliance.role);
    const guildRoles = await guild.roles.fetch();
    return mapToArray(guildRoles.filter(role => roles.includes(role.id)));
};

const invalidNames = process.env.INVALID_NAMES.split(",");

const nameValid = (name: string) : boolean => name && name.length > 0 && name.length < 32 && name === name.trim() && name === name.replaceAll("  ", " ") && Boolean(name.match(/^[a-z0-9_'"#: -]+$/i)) && !invalidNames.includes(name.toLowerCase());
const nameToChannelName = (name: string) : string => name.toLowerCase().replace(/ /g, "-");

client.on('interactionCreate', async interaction => {
    if (!interaction.isChatInputCommand()) return;

    if(interaction.channelId !== process.env.BOT_COMMANDS_CHANNEL) {
        await interaction.reply({content:`Please use the <#${process.env.BOT_COMMANDS_CHANNEL}> channel!`, ephemeral: true, allowedMentions: {parse: []}});
        return;
    }

    await interaction.deferReply();


    // get parameters
    const {commandName, options} = interaction;
    const fullCommand = commandName + " " + (options.getSubcommandGroup() ? options.getSubcommandGroup() + " " : "") + options.getSubcommand();

    console.log(`Received interaction /${fullCommand} from ${interaction.user.tag} with options ${JSON.stringify(options.data)}`);

    try {
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
            case "faction help":
                return await commandFactionOrAllianceHelp(interaction);
            case "faction set name":
                return await commandFactionSetName(interaction);
            case "faction set color":
                return await commandFactionSetColor(interaction);
            case "faction set emoji":
                return await commandFactionSetEmoji(interaction);
            case "faction set invite":
                return await commandFactionSetInvite(interaction);
            case "faction kick":
                return await commandFactionKick(interaction);
            case "faction list":
                return await commandFactionInfo(interaction);

            case "alliance help":
                return await commandFactionOrAllianceHelp(interaction);
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
            case "alliance list":
                return await commandAllianceList(interaction);
            default:
                console.log("Unknown command " + fullCommand);
                await interaction.editReply({content: "Unknown command!"});

        }
    }catch (e) {
        console.error(e);
        await interaction.editReply({content: "An error occurred :("});
    }
});

async function checkIfFactionOrAllianceNameUnique(guild: Guild, factionName: string) : Promise<boolean> {
    const others = (await getFactionRoles(guild)).map(role => role.name);
    others.concat((await getAllianceRoles(guild)).map(role => role.name));

    return !others.find(role => role.trim().toLowerCase() === factionName.trim().toLowerCase());
}

async function commandFactionCreate(interaction: ChatInputCommandInteraction) {
    const options = interaction.options;

    if (await memberIsFounder(interaction.guild, interaction.member as GuildMember)) {
        await interaction.editReply({content: "You are already the founder of a faction."});
        return;
    }

    if (await memberIsInAFaction(interaction.guild, interaction.member as GuildMember)) {
        await interaction.editReply({content: "You are already in a faction."});
        return;
    }

    const factionName = options.getString("name");
    if (!nameValid(factionName)) {
        await interaction.editReply({content: "Invalid / missing faction name"});
        return;
    }

    if (!await checkIfFactionOrAllianceNameUnique(interaction.guild, factionName)) {
        await interaction.editReply({content: "A faction with that name already exists!"});
        return;
    }

    const colorString = options.getString("color");
    let colorHex = findColor(colorString);
    if(!colorHex){
        await interaction.editReply({content: "Invalid color!"});
        return;
    }

    let role;
    try {
        const emoji = interaction.options.getString("emoji")?.trim() || null;

        if(emoji && !emojiValid(emoji)){
            await interaction.editReply({content: "Invalid emoji!"});
            return;
        }

        role = await interaction.guild.roles.create({
            name: factionName,
            color: colorHex,
            reason: "Faction created by " + interaction.user.tag,
            hoist: true,
            unicodeEmoji: emoji,
        });
    } catch (e) {
        console.error(e);
        await interaction.editReply({content: "Error creating role!"});
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
        await interaction.editReply({content: "Error creating channels!"});
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
        await interaction.editReply({content: "Error assigning permissions!"});
    }

    let politicsChannel = await getPoliticsChannel(interaction.guild);
    if(!politicsChannel) {
        await interaction.editReply({content: "Error getting politics channel!"});
        return;
    }

    await interaction.editReply({content: `Created faction ${role.name}`});
    await politicsChannel.send({
        content: `Faction "<@&${role.id}>" created by "<@${member.user.id}>"`,
        allowedMentions: {
            roles: [role.id],
            users: [member.user.id]
        }
    });
}

async function commandFactionAdminsUpdate(interaction: ChatInputCommandInteraction, add: boolean) {
    const adminMember = interaction.member as GuildMember;
    if (!await memberIsFounder(interaction.guild, adminMember) || !await memberIsInAFaction(interaction.guild, adminMember)) {
        await interaction.editReply({content: "You are not the founder of a faction."});
        return;
    }
    const targetMember = interaction.options.getMember("user") as GuildMember;

    const adminFactionRole = await getMemberFactionRole(interaction.guild, adminMember);
    if(!adminFactionRole){
        await interaction.editReply({content: "You are not in a faction!"});
        return;
    }

    const targetFactionRole = await getMemberFactionRole(interaction.guild, targetMember);
    if(!targetFactionRole){
        await interaction.editReply({content: "That user is not in your faction."});
        return;
    }
    if (!adminFactionRole?.id || !targetFactionRole?.id || adminFactionRole.id !== targetFactionRole.id) {
        await interaction.editReply({content: "That user is not in your faction."});
        return;
    }

    if(await memberIsFounder(interaction.guild, targetMember)) {
        await interaction.editReply({content: "That user is the founder of the faction."});
        return;
    }

    let adminChannel:GuildChannel;
    try {
        adminChannel = await getFactionChannel(interaction.guild, targetFactionRole.name, channelTypes.adminChannel);
    } catch (e) {
        console.error(e);
        await interaction.editReply({content: "Error getting admin channel!"});
        return;
    }

    if (!adminChannel) {
        await interaction.editReply({content: "Error getting admin channel!"});
        return;
    }

    try {
        if (add) await makeMemberFactionAdmin(interaction.guild, targetMember, adminChannel);
        else await makeMemberNotFactionAdmin(interaction.guild, targetMember, adminChannel);
    } catch (e) {
        console.error(e);
        await interaction.editReply({content: "Error assigning permissions!"});
        return;
    }

    await interaction.editReply(`Successfully ${add ? "added" : "removed"} <@${targetMember.id}> as a faction admin.`);
}

async function commandFactionJoin(interaction: ChatInputCommandInteraction) {
    const member = interaction.member as GuildMember;
    const factionName = interaction.options.getString("name");
    if (!nameValid(factionName)) {
        await interaction.editReply({content: "Invalid / missing faction name"});
        return;
    }

    let factionRole:Role;
    try {
        factionRole = await getFactionRole(interaction.guild, factionName);
    } catch (e) {
        await interaction.editReply({content: "That faction does not exist!"});
        return;
    }
    if (!factionRole) {
        await interaction.editReply({content: "That faction does not exist."});
        return;
    }

    if (await memberIsFounder(interaction.guild, member)) {
        await interaction.editReply({content: "You are already the founder of a faction."});
        return;
    }

    if (await memberIsInAFaction(interaction.guild, member)) {
        await interaction.editReply({content: "You are already in a faction."});
        return;
    }

    let adminChannel:GuildChannel;
    try {
        adminChannel = await getFactionChannel(interaction.guild, factionName, channelTypes.adminChannel);
    } catch (e) {
        console.error(e);
        await interaction.editReply({content: "Error getting admin channel!"});
        return;
    }

    let politicsChannel = await getPoliticsChannel(interaction.guild);
    if(!politicsChannel) {
        await interaction.editReply({content: "Error getting politics channel!"});
        return;
    }

    const factionAlliances = config.alliances.filter(alliance => alliance.factions.includes(factionRole.id));
    for(const alliance of factionAlliances) {
        await member.roles.add(alliance.role);
    }

    const found = config.factions.find(faction => faction.role === factionRole.id);
    if(found.isInviteOnly){
        const sent = await politicsChannel.send({
            content: escapeMarkdown(`"<@${member.user.id}>" wants to join "${factionName}"!\nIf you are an admin of "${factionName}", click the checkmark to accept.`),
            allowedMentions: {
                users: [member.user.id]
            }
        });
        await sent.react("✅");
        await interaction.editReply(`Sent join request in <#${politicsChannel.id}>`);
        sent.createReactionCollector({}).on("collect", async (reaction, user) => {
            const reactionMember = await reaction.message.guild?.members.fetch(user.id);
            const isAdmin = await memberIsFactionAdmin(interaction.guild, reactionMember, adminChannel);
            if (!isAdmin) return;
            if (reaction.emoji.name === "✅") {
                await makeMemberFactionMember(interaction.guild, member, factionRole);

                await sent.reactions.removeAll();
                await sent.edit({content: escapeMarkdown(`"<@${member.user.id}>" has joined "${factionRole.name}"!`)});
            }
        });
    }else{
        await politicsChannel.send({
            content: escapeMarkdown(`"<@${member.user.id}>" has joined "${factionRole.name}"!`),
            allowedMentions: {
                users: [member.user.id]
            }
        });

        await makeMemberFactionMember(interaction.guild, member, factionRole);
        await interaction.editReply(`Successfully joined ${factionName}!`);
    }
}

async function commandFactionDelete(interaction: ChatInputCommandInteraction) {
    const member = interaction.member as GuildMember;

    const factionRole = await getMemberFactionRole(interaction.guild, member);
    if (!factionRole) {
        await interaction.editReply({content: "You are not in a faction!"});
        return;
    }
    if (!await memberIsFounder(interaction.guild, member)) {
        await interaction.editReply({content: "You are not the founder of a faction!"});
        return;
    }

    const category = await getFactionCategory(interaction.guild, factionRole.name);
    if (!category) {
        await interaction.editReply({content: "Error getting category!"});
        return;
    }

    let politicsChannel = await getPoliticsChannel(interaction.guild);
    if(!politicsChannel) {
        await interaction.editReply({content: "Error getting politics channel!"});
        return;
    }

    const factionObj = config.factions.find(faction => faction.role === factionRole.id);
    if (!factionObj) {
        await interaction.editReply({content: "Error getting faction object!"});
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
    await interaction.editReply(`Successfully deleted faction ${factionRole.name}!`);

    await politicsChannel.send({
        content: escapeMarkdown(`"<@${member.user.id}>" has deleted the faction "${factionRole.name}"!`),
        allowedMentions: {
            users: [member.user.id]
        }
    });
}

async function commandFactionLeave(interaction: ChatInputCommandInteraction) {
    const member = interaction.member as GuildMember;

    const factionRole = await getMemberFactionRole(interaction.guild, member);
    if (!factionRole) {
        await interaction.editReply({content: "You are not in a faction!"});
        return;
    }

    if (await memberIsFounder(interaction.guild, member)) {
        await interaction.editReply({content: "You are the founder of a faction! Use /faction delete instead."});
        return;
    }

    let politicsChannel = await getPoliticsChannel(interaction.guild);
    if(!politicsChannel) {
        await interaction.editReply({content: "Error getting politics channel!"});
        return;
    }

    const result = await removeMemberFromFaction(interaction.guild, member, factionRole, interaction);
    if(!result) return;
    await interaction.editReply(`Successfully left faction ${factionRole.name}!`);

    await politicsChannel.send({
        content: escapeMarkdown(`"<@${member.user.id}>" has left "${factionRole.name}"!`),
        allowedMentions: {
            users: [member.user.id]
        }
    });
}

async function commandFactionInfo(interaction: ChatInputCommandInteraction){
    const name = interaction.options.getRole("name")?.name;

    await interaction.guild.members.fetch();
    if(name){
        const role = await getFactionRole(interaction.guild, name);
        if(!role){
            await interaction.editReply({content: "That faction does not exist!"});
            return;
        }
        const faction = config.factions.find(faction => faction.role === role.id);
        if(!faction){
            await interaction.editReply({content: "Error getting faction object!"});
            return;
        }

        const embed = new EmbedBuilder();
        embed.setTitle(role.name);
        embed.setDescription(`${role.name}: ${role.members.size} member${role.members.size !== 1 ? "s" : ""}, ${faction.isInviteOnly ? "request to join" : "open invite"}`);
        embed.setColor("Blue");
        const fields = [];
        const alliancesRoles = await getAllianceRoles(interaction.guild);
        const factionRoles = await getFactionRoles(interaction.guild);
        const ourAlliances = config.alliances.filter(alliance => alliance.factions.includes(role.id));
        if(alliancesRoles.length > 0) {
            for (const role of alliancesRoles) {
                const found = ourAlliances.find(alliance => alliance.role === role.id);
                if (found) {
                    fields.push({
                        name: "Alliance: " + role.name,
                        value: " with " + found.factions.map(faction => factionRoles.find(role => role.id === faction).name).join(", ")
                    });
                }
            }
        }else{
            fields.push({
                name: "Alliances",
                value: "None"
            });
        }
        embed.addFields(fields);

        await interaction.editReply({embeds: [embed]});
    }else{
        const roles = await getFactionRoles(interaction.guild);
        const embed = new EmbedBuilder();
        embed.setTitle("Factions");
        embed.setDescription("Use /faction list <name> to get more info about a faction.");
        embed.setColor("Blue");
        const fields = [];
        if(roles.length > 0) {
            for (const role of roles) {
                const faction = config.factions.find(faction => faction.role === role.id);
                if (!faction) continue;
                fields.push({
                    name: role.name,
                    value: `${role.members.size} member${role.members.size !== 1 ? "s" : ""}, ${faction.isInviteOnly ? "request to join" : "open invite"}`
                });
            }
        }else{
            fields.push({
                name: "No factions",
                value: "There are no factions yet!"
            });
        }
        embed.addFields(fields);
        await interaction.editReply({embeds: [embed]});
    }
}

async function commandFactionKick(interaction: ChatInputCommandInteraction){
    const resp = await factionAdminOnlyCommand(interaction);
    if(!resp) return;
    const [_, factionRole] = resp;

    const member = interaction.options.getMember("name") as GuildMember;
    const result = await removeMemberFromFaction(interaction.guild, member, factionRole, interaction);
    if(!result) return;

    await interaction.editReply(`Successfully kicked ${member.displayName} from ${factionRole.name}!`);
}

async function commandAllianceCreate(interaction: ChatInputCommandInteraction){
    const member = interaction.member as GuildMember;
    const allianceName = interaction.options.getString("name");
    const memberFoundingFactionRole = await getFoundingFactionRoleForAlliance(interaction);
    if(!memberFoundingFactionRole) return;

    if(!nameValid(allianceName)){
        await interaction.editReply({content: "Invalid alliance name!"});
        return;
    }

    const others = (await getAllianceRoles(interaction.guild)).map(role => role.name);
    if (others.find(role => role.trim().toLowerCase() === allianceName.trim().toLowerCase())) {
        await interaction.editReply({content: "An alliance with that name already exists!"});
        return;
    }

    await interaction.guild.members.fetch();
    const foundedAlliances = config.alliances.filter(alliance => alliance.roleOfFoundingFaction === memberFoundingFactionRole.id);
    if (foundedAlliances.length > memberFoundingFactionRole.members.size){
        await interaction.editReply({content: "You have already founded too many alliances!"});
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

    await interaction.guild.members.fetch();
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

    let politicsChannel = await getPoliticsChannel(interaction.guild);
    if(!politicsChannel) {
        await interaction.editReply({content: "Error getting politics channel!"});
        return;
    }

    await politicsChannel.send({
        content: escapeMarkdown(`Alliance "<@&${allianceRole.id}>" created by "<@${member.user.id}>"!`),
        allowedMentions: {
            roles: [allianceRole.id],
            users: [member.user.id]
        }
    });
    await interaction.editReply(`Alliance created!`);
}

async function commandAllianceJoin(interaction: ChatInputCommandInteraction){
    const resp = await factionFounderInAllianceCommand(interaction, false);
    if(!resp) return;
    const [memberFoundingFactionRole, allianceRole, found, member] = resp;

    if(!found || found.factions.includes(memberFoundingFactionRole.id)){
        await interaction.editReply({content: "You are already in this alliance!"});
        return;
    }

    let politicsChannel = await getPoliticsChannel(interaction.guild);
    if(!politicsChannel) {
        await interaction.editReply({content: "Error getting politics channel!"});
        return;
    }

    const sent = await politicsChannel.send({
        content: escapeMarkdown(`"<@${member.user.id}>": from <@&${memberFoundingFactionRole.id}> wants to join alliance "${allianceRole.name}"! If you are the founder of "${allianceRole.name}", react with ✅ to accept.`),
        allowedMentions: {
            users: [member.user.id]
        }
    });
    await sent.react("✅");
    await interaction.editReply(`Sent join request in <#${politicsChannel.id}>!`);
    sent.createReactionCollector({}).on("collect", async (reaction, user) => {
        await interaction.guild.members.fetch();
        const reactionMember = reaction.message.guild?.members.cache.get(user.id);
        const isFounder = await memberIsFounder(reaction.message.guild, reactionMember);
        if (!isFounder) return;

        const faction = await getMemberFactionRole(reaction.message.guild, reactionMember);
        if(!faction || faction.id !== found.roleOfFoundingFaction) return;

        if (reaction.emoji.name === "✅") {
            // assign roles to all members of the faction
            await interaction.guild.members.fetch();
            const factionMembers = memberFoundingFactionRole.members;
            for (const [_, factionMember] of factionMembers) {
                await factionMember.roles.add(allianceRole);
            }

            found.factions.push(memberFoundingFactionRole.id);
            await writeConfig(config);

            await sent.edit({content: escapeMarkdown(`"<@&${memberFoundingFactionRole.id}>" has joined the alliance "<@&${allianceRole.id}>"!`)});
            await sent.reactions.removeAll();
        }
    });
}

async function commandAllianceLeave(interaction: ChatInputCommandInteraction){
    const resp = await factionFounderInAllianceCommand(interaction, false);
    if(!resp) return;
    const [memberFoundingFactionRole, allianceRole, found] = resp;


    if(!found || !found.factions.includes(memberFoundingFactionRole.id)){
        await interaction.editReply({content: "Can't leave that alliance!"});
        return;
    }
    found.factions = found.factions.filter(faction => faction !== memberFoundingFactionRole.id);
    await writeConfig(config);

    let politicsChannel = await getPoliticsChannel(interaction.guild);
    if(!politicsChannel) {
        await interaction.editReply({content: "Error getting politics channel!"});
        return;
    }

    await interaction.guild.members.fetch();
    for(const [_, factionMember] of memberFoundingFactionRole.members){
        await factionMember.roles.remove(allianceRole);
    }

    await politicsChannel.send({
        content: escapeMarkdown(`"<@&${memberFoundingFactionRole.id}>" left the alliance "<@&${allianceRole.id}>"!`),
        allowedMentions: {
            roles: [allianceRole.id, memberFoundingFactionRole.id]
        }
    });
    await interaction.editReply(`Left alliance!`);
}

async function commandAllianceDelete(interaction: ChatInputCommandInteraction){
    const resp = await factionFounderInAllianceCommand(interaction, true);
    if(!resp) return;
    const [, allianceRole, found, member] = resp;

    let politicsChannel = await getPoliticsChannel(interaction.guild);
    if(!politicsChannel) {
        await interaction.editReply({content: "Error getting politics channel!"});
        return;
    }

    if(!found){
        await interaction.editReply({content: "Invalid alliance, you must be the founder!"});
        return;
    }
    await deleteAlliance(interaction.guild, found);

    await interaction.editReply(`Alliance ${allianceRole.name} deleted!`);

    await politicsChannel.send({
        content: `Alliance "${allianceRole.name}" deleted by "<@${member.user.id}>"!`,
        allowedMentions: {
            users: [member.user.id]
        }
    });
}

async function commandFactionSetName(interaction: ChatInputCommandInteraction){
    const resp = await factionAdminOnlyCommand(interaction);
    if(!resp) return;
    const [_, factionRole] = resp;

    const name = interaction.options.getString("name");
    if(!nameValid(name)){
        await interaction.editReply({content: "Invalid name!"});
        return;
    }

    if(!await checkIfFactionOrAllianceNameUnique(interaction.guild, name)){
        await interaction.editReply({content: "Name already taken!"});
        return;
    }

    await factionRole.setName(name);
    await interaction.editReply(`Faction name set to ${name}!`);
}

async function commandFactionSetColor(interaction: ChatInputCommandInteraction){
    const resp = await factionAdminOnlyCommand(interaction);
    if(!resp) return;
    const [_, factionRole] = resp;

    const color = interaction.options.getString("name");
    let colorHex = findColor(color);
    if(!colorHex){
        await interaction.editReply({content: "Invalid color!"});
        return;
    }

    await factionRole.setColor(colorHex);
    await interaction.editReply(`Faction color set to ${color}!`);
}

const emojiValid = (emoji:string) => {
    console.log(emoji);
    const segmenter = new Intl.Segmenter();
    const segments = Array.from(segmenter.segment(emoji));
    console.log(segments.length, segments);
    return segments.length === 1;
}

async function commandFactionSetEmoji(interaction: ChatInputCommandInteraction){
    const resp = await factionAdminOnlyCommand(interaction);
    if(!resp) return;
    const [_, factionRole] = resp;

    const emoji = interaction.options.getString("name").trim();

    if(!emojiValid(emoji)){
        await interaction.editReply({content: "Invalid emoji!"});
        return;
    }

    try {
        await factionRole.setUnicodeEmoji(emoji);
        await interaction.editReply(`Faction emoji set to ${emoji}!`);
    } catch (e) {
        await interaction.editReply("Could not set emoji!");
    }
}

async function commandFactionSetInvite(interaction: ChatInputCommandInteraction){
    const resp = await factionAdminOnlyCommand(interaction);
    if(!resp) return;
    const [_, factionRole] = resp;

    const status = interaction.options.getString("status");
    const found = config.factions.find(faction => faction.role === factionRole.id);
    found.isInviteOnly = status === "admin-approves";
    await writeConfig(config);

    await interaction.editReply(`Faction invite status set to ${status}!`);
}

async function commandAllianceKick(interaction: ChatInputCommandInteraction){
    const resp = await factionFounderInAllianceCommand(interaction, true);
    if(!resp) return;
    const [memberFoundingFactionRole, allianceRole, found, member] = resp;
    const factionName = interaction.options.getString("faction");

    if(!found || !found.factions.includes(memberFoundingFactionRole.id)){
        await interaction.editReply({content: "Can't kick from that alliance!"});
        return;
    }

    const factionRole = await getFactionRole(interaction.guild, factionName);
    if(!factionRole){
        await interaction.editReply({content: "Faction not found!"});
        return;
    }

    if(!found.factions.includes(factionRole.id)){
        await interaction.editReply({content: "Faction not in alliance!"});
        return;
    }

    let politicsChannel = await getPoliticsChannel(interaction.guild);
    if(!politicsChannel) {
        await interaction.editReply({content: "Error getting politics channel!"});
        return;
    }

    found.factions = found.factions.filter(faction => faction !== factionRole.id);
    await writeConfig(config);

    await interaction.guild.members.fetch();
    for(const [_, factionMember] of factionRole.members){
        await factionMember.roles.remove(allianceRole);
    }

    await interaction.editReply(`Kicked faction ${factionRole.name} from alliance ${allianceRole.name}!`);
    await politicsChannel.send({
        content: escapeMarkdown(`"<@&${factionRole.id}>" was kicked from the alliance "<@&${allianceRole.id}>" by "<@${member.user.id}>"!`),
        allowedMentions: {
            roles: [allianceRole.id,  factionRole.id],
            users: [member.user.id]
        }
    });
}

async function commandAllianceList(interaction: ChatInputCommandInteraction){
    const alliances = await getAllianceRoles(interaction.guild);

    const factionRoles = await getFactionRoles(interaction.guild);
    const embed = new EmbedBuilder();
    embed.setTitle("Alliances");
    embed.setColor("Blue");
    const fields = [];
    await interaction.guild.members.fetch();
    if(alliances.length > 0){
        for(const allianceRole of alliances){
            const allianceObj:alliance = config.alliances.find(allianceObj => allianceObj.role === allianceRole.id);

            const text = `${allianceRole.members.size} member${allianceRole.members.size !== 1 ? "s" : ""}, from ${allianceObj.factions.length} faction${allianceObj.factions.length !== 1 ? "s" : ""}: ${allianceObj.factions.map(faction => factionRoles.find(role => role.id === faction).name).join(", ")}`;
            fields.push({name: allianceRole.name, value: text});
        }
    } else {
        fields.push({name: "No alliances", value: "There are no alliances!"});
    }
    embed.addFields(fields);
    await interaction.editReply({embeds: [embed]});
}

async function commandFactionOrAllianceHelp(interaction: ChatInputCommandInteraction){
    const embed = new EmbedBuilder();
    embed.setTitle("Faction Help");
    embed.setColor("Blue");
    const commands = helpDescription.trim();
    embed.setFields(commands.split("\n").filter(Boolean).map(line => ({name: "`" + line.split("\t")[0] + "`", value: line.split("\t")[1]})));
    await interaction.editReply({embeds: [embed]});
}

// utility

async function factionFounderInAllianceCommand(interaction: ChatInputCommandInteraction, founder: boolean): Promise<[Role, Role, alliance, GuildMember]>{
    const member = interaction.member as GuildMember;
    const allianceName = interaction.options.getString("name");
    const memberFoundingFactionRole = await getFoundingFactionRoleForAlliance(interaction);
    if(!memberFoundingFactionRole) return;

    const allianceRole = await getAllianceRole(interaction.guild, allianceName);
    if (!allianceRole) {
        await interaction.editReply({content: "Alliance not found!"});
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
        await interaction.editReply({content: "You are not in a faction!"});
        return;
    }

    let adminChannel:GuildChannel;
    try {
        adminChannel = await getFactionChannel(interaction.guild, factionRole.name, channelTypes.adminChannel);
    } catch (e) {
        console.error(e);
        await interaction.editReply({content: "Error getting admin channel!"});
        return;
    }
    if(!await memberIsFactionAdmin(interaction.guild, member, adminChannel)){
        await interaction.editReply({content: "You need to be an admin!"});
        return;
    }

    return [member, factionRole];
}

async function removeMemberFromFaction(guild:Guild, member:GuildMember, factionRole: Role, interaction: ChatInputCommandInteraction){
    if(await memberIsFounder(guild, member)){
        await interaction.editReply({content: "That member cannot be removed"});
        return;
    }

    let adminChannel:GuildChannel;
    try {
        adminChannel = await getFactionChannel(guild, factionRole.name, channelTypes.adminChannel);
    } catch (e) {
        console.error(e);
        await interaction.editReply({content: "Error getting admin channel!"});
        return;
    }

    await member.fetch();

    if(!member.roles.cache.has(factionRole.id)){
        await interaction.editReply({content: "Member not in faction!"});
        return;
    }

    try {
        await makeMemberNotFactionAdmin(interaction.guild, member, adminChannel);
    } catch (e) {
        console.error(e);
        await interaction.editReply({content: "Error removing permissions!"});
        return;
    }

    const factionAlliances = config.alliances.filter(alliance => alliance.factions.includes(factionRole.id));
    for(const alliance of factionAlliances) {
        await member.roles.remove(alliance.role);
    }

    await member.roles.remove(factionRole);
    return true;
}

async function getFoundingFactionRoleForAlliance(interaction: ChatInputCommandInteraction): Promise<Role> {
    const member = interaction.member as GuildMember;
    const allianceName = interaction.options.getString("name");
    if (!nameValid(allianceName)) {
        await interaction.editReply({content: "Invalid / missing alliance name"});
        return;
    }

    if(!await checkIfFactionOrAllianceNameUnique(interaction.guild, allianceName)){
        await interaction.editReply({content: "Alliance name already taken!"});
        return;
    }

    const memberFactionRole = await getMemberFactionRole(interaction.guild, member);
    if(!memberFactionRole){
        await interaction.editReply({content: "You are not in a faction!"});
        return;
    }

    if (!await memberIsFounder(interaction.guild, member)) {
        await interaction.editReply({content: "You need to be the founder of a faction."});
        return;
    }
    return await interaction.guild.roles.fetch(memberFactionRole.id);
}

async function deleteChannelsInCategory(category:CategoryChannel) {
    await category.guild.channels.fetch();
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
        return null;
    }
    return found;
}

await client.login(process.env.DISCORD_TOKEN);

