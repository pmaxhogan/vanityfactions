import * as dotenv from 'dotenv' // see https://github.com/motdotla/dotenv#how-do-i-use-dotenv-with-import
dotenv.config()

import { REST, Routes, Client, GatewayIntentBits, ChannelType, PermissionFlagsBits, OverwriteType, escapeMarkdown } from "discord.js";

import { SlashCommandBuilder } from "@discordjs/builders";

import { resolveColor } from "discord.js";

const client = new Client({
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessageReactions, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent, GatewayIntentBits.GuildMembers, GatewayIntentBits.GuildEmojisAndStickers],
    allowedMentions: { parse: [] }
});

const specialRoles = process.env.SPECIAL_ROLES.split(",");

const commands = [
    /**
     * /faction create <name> <color>
     * /faction setname <oldname> <newname>
     * /faction makeadmin <user>
     * /faction demoteadmin <user>
     * /faction join <name>
     * /faction delete founder of faction
     */
    new SlashCommandBuilder()
        .setName('faction')
        .setDescription('Faction commands')
        .addSubcommand((subcommand) =>
            subcommand.setName('create').setDescription('Create a faction')
                .addStringOption((option) => option.setName('name').setDescription('The name of the faction').setRequired(true))
                .addStringOption((option) => option.setName('color').setDescription('The color of the faction').setRequired(true))
        )

        .addSubcommandGroup((group) =>
            group.setName('set').setDescription('Create a faction')
            .addSubcommand((subcommand) =>
                subcommand.setName('name').setDescription('Set the name of a faction')
                    .addStringOption((option) => option.setName('oldname').setDescription('The old name of the faction').setRequired(true))
                    .addStringOption((option) => option.setName('newname').setDescription('The new name of the faction').setRequired(true))
            )

            .addSubcommand((subcommand) =>
                subcommand.setName('color').setDescription('Set the color of a faction')
                    .addStringOption((option) => option.setName('name').setDescription('The name of the faction').setRequired(true))
                    .addStringOption((option) => option.setName('color').setDescription('The color of the faction').setRequired(true))
            )

            .addSubcommand((subcommand) =>
                subcommand.setName('invite').setDescription('Set the invite status of a faction')
                    .addStringOption((option) => option.setName('status').setDescription('The invite status of the faction').setRequired(true).addChoices({ name: 'open', value: 'open' }, { name: 'admin-only', value: 'admin-only' }))
            )
        )

        .addSubcommandGroup((group) =>
            group.setName('admins').setDescription('Faction admins')
                .addSubcommand((subcommand) =>
                    subcommand.setName('add').setDescription('Make a user an admin of a faction')
                        .addUserOption((option) => option.setName('user').setDescription('The user to make an admin').setRequired(true))
                )
                .addSubcommand((subcommand) =>
                    subcommand.setName('remove').setDescription('Make a user not an admin of a faction')
                        .addUserOption((option) => option.setName('user').setDescription('The user to make not an admin').setRequired(true))
                )
        )

        .addSubcommand((subcommand) =>
            subcommand.setName('join').setDescription('Join a faction')
                .addStringOption((option) => option.setName('name').setDescription('The name of the faction').setRequired(true))
        )

        .addSubcommand((subcommand) =>
            subcommand.setName('delete').setDescription('Delete a faction')
        ).toJSON(),

    new SlashCommandBuilder()
        .setName('alliance')
        .setDescription('Alliance commands')
        .addSubcommand((subcommand) => subcommand.setName('create').setDescription('Create an alliance'))
        .addSubcommand((subcommand) => subcommand.setName('delete').setDescription('Delete an alliance'))
        .addSubcommand((subcommand) => subcommand.setName('join').setDescription('Join an alliance'))
];

const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);

try {
    console.log("Started refreshing application (/) commands.");

    await rest.put(Routes.applicationCommands(process.env.CLIENT_ID), { body: commands });
    // delete all commands

    console.log("Successfully reloaded application (/) commands.");
} catch (error) {
    console.error(error);
}

client.on('ready', () => {
    console.log(`Logged in as ${client.user.tag}!`);
});

const mapToArray = map => Array.from(map.values());

const getFactionRoles = async (guild) => {
    const roles = await guild.roles.fetch();
    const rolesArr = mapToArray(roles);
    return rolesArr.filter(role => !specialRoles.includes(role.id) && role.name !== "@everyone");
};

const nameValid = name => name && name.length > 0 && name.length < 32 && name.match(/^[a-z0-9_-]+$/i);
const nameToChannelName = name => name.toLowerCase().replace(/ /g, "-");

client.on('interactionCreate', async interaction => {
    if (!interaction.isChatInputCommand()) return;

    // get parameters
    const { commandName, options } = interaction;
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
        case "alliance join":
            return await commandAllianceJoin(interaction);
        default:
            console.log("Unknown command " + fullCommand);
            await interaction.reply({ content: "Unknown command!", ephemeral: true });

    }

    await interaction.reply("???");
});


// command

async function commandFactionCreate(interaction) {
    const options = interaction.options;

    if(await memberIsFounder(interaction.guild, interaction.member)) {
        interaction.reply({ content: "You are already the founder of a faction.", ephemeral: true });
        return;
    }

    if(await memberIsInAFaction(interaction.guild, interaction.member)) {
        interaction.reply({ content: "You are already in a faction.", ephemeral: true });
        return;
    }

    const factionName = options.getString("name");
    if(!nameValid(factionName)) {
        await interaction.reply({ content: "Invalid / missing faction name", ephemeral: true });
        return;
    }

    const others = (await getFactionRoles(interaction.guild)).map(role => role.name);
    console.log(factionName, others);

    if (others.find(role => role.trim().toLowerCase() === factionName.trim().toLowerCase())) {
        await interaction.reply({ content: "A faction with that name already exists!", ephemeral: true });
        return;
    }

    const color = options.getString("color");

    try {
        resolveColor(color);
    } catch (e) {
        await interaction.reply({ content: "Invalid color!", ephemeral: true });
        return;
    }

    let role;
    try{
        role = await interaction.guild.roles.create({
            name: factionName,
            color,
            reason: "Faction created by " + interaction.user.tag
        });
    } catch (e) {
        console.error(e);
        await interaction.reply({ content: "Error creating role!", ephemeral: true });
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
    console.log(category.id);

    let adminChannel;
    try {
        const textChannel = await interaction.guild.channels.create({
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

        const voiceChannel = await interaction.guild.channels.create({
            type: ChannelType.GuildVoice,
            parent: category,
            reason: "Faction created by " + interaction.user.tag,
            name: nameToChannelName(factionName) + "-vc",
        });
    } catch (e) {
        console.error(e);
        await interaction.reply({ content: "Error creating channels!", ephemeral: true });
        return;
    }

    try{
        await makeMemberFactionMember(interaction.guild, interaction.member, role);
        await makeMemberFactionAdmin(interaction.guild, interaction.member, adminChannel);
        await makeMemberAFounder(interaction.guild, interaction.member);
    } catch (e) {
        console.error(e);
        await interaction.reply({ content: "Error assigning permissions!", ephemeral: true });
    }

}

async function commandFactionAdminsUpdate(interaction, add){
    const adminMember = interaction.member;
    if(!await memberIsFounder(interaction.guild, adminMember) || !await memberIsInAFaction(interaction.guild, adminMember)) {
        await interaction.reply({ content: "You are not the founder of a faction.", ephemeral: true });
        return;
    }
    debugger;
    const targetMember = interaction.options.getMember("user");

    let adminFactionRole;
    try {
        adminFactionRole = await getMemberFactionRole(interaction.guild, adminMember);
    } catch (e) {
        await interaction.reply({ content: "You are not in a faction!", ephemeral: true });
        return;
    }

    let targetFactionRole;
    try {
        targetFactionRole = await getMemberFactionRole(interaction.guild, targetMember);
    }catch (e) {
        console.error(e);
        await interaction.reply({ content: "That user is not in your faction.", ephemeral: true });
        return;
    }
    if(!adminFactionRole?.id || !targetFactionRole?.id || adminFactionRole.id !== targetFactionRole.id) {
        console.log(adminFactionRole?.id, targetFactionRole?.id);
        await interaction.reply({ content: "That user is not in your faction.", ephemeral: true });
        return;
    }

    let adminChannel;
    try {
        adminChannel = await getAdminChannel(interaction.guild, targetFactionRole.name);
    } catch (e) {
        console.error(e);
        await interaction.reply({ content: "Error getting admin channel!", ephemeral: true });
        return;
    }

    if(!adminChannel) {
        await interaction.reply({ content: "Error getting admin channel!", ephemeral: true });
        return;
    }

    try{
        if(add) await makeMemberFactionAdmin(interaction.guild, targetMember, adminChannel);
        else await makeMemberNotFactionAdmin(interaction.guild, targetMember, adminChannel);
    } catch (e) {
        console.error(e);
        await interaction.reply({ content: "Error assigning permissions!", ephemeral: true });
        return;
    }

    await interaction.reply(`Successfully ${add ? "added" : "removed"} ${targetMember.displayName} as a faction admin.`);
}

async function commandFactionJoin(interaction){
    const factionName = interaction.options.getString("name");
    if(!nameValid(factionName)) {
        await interaction.reply({ content: "Invalid / missing faction name", ephemeral: true });
        return;
    }

    let factionRole;
    try{
        factionRole = await getFactionRole(interaction.guild, factionName);
    } catch (e) {
        await interaction.reply({ content: "That faction does not exist!", ephemeral: true });
        return;
    }
    if(!factionRole) {
        await interaction.reply({ content: "That faction does not exist.", ephemeral: true });
        return;
    }

    if(await memberIsFounder(interaction.guild, interaction.member)) {
        await interaction.reply({ content: "You are already the founder of a faction.", ephemeral: true });
        return;
    }

    if(await memberIsInAFaction(interaction.guild, interaction.member)) {
        await interaction.reply({ content: "You are already in a faction.", ephemeral: true });
        return;
    }

    let adminChannel;
    try {
        adminChannel = await getAdminChannel(interaction.guild, factionName);
    } catch (e) {
        console.error(e);
        await interaction.reply({ content: "Error getting admin channel!", ephemeral: true });
        return;
    }

    let politicsChannel;
    try {
        politicsChannel = await getPoliticsChannel(interaction.guild);
    } catch (e) {
        console.error(e);
        await interaction.reply({ content: "Error getting politics channel!", ephemeral: true });
        return;
    }

    const sent = await politicsChannel.send(escapeMarkdown(`${interaction.member.displayName} (${interaction.member.user.tag}) wants to join ${factionName}!\nIf you are an admin of ${factionName}, click the checkmark to accept.`));
    await sent.react("✅");
    await interaction.reply(`Sent join request in <#${politicsChannel.id}>`);
    sent.createReactionCollector({}).on("collect", async (reaction, user) => {
        const isAdmin = await memberIsFactionAdmin(interaction.guild, user, adminChannel);
        if(!isAdmin) return;
        if(reaction.emoji.name === "✅") {
            await makeMemberFactionMember(interaction.guild, interaction.member, factionRole);
            await sent.delete();
            await politicsChannel.send(escapeMarkdown(`${interaction.member.displayName} (${interaction.member.user.tag}) has joined ${factionName}!`));
        }
    });
}



// utility

async function memberIsInAFaction(guild, member) {
    try{
        return await getMemberFactionRole(guild, member) !== undefined;
    } catch (e) {
        return false;
    }
}

async function memberIsFounder(guild, member) {
    const role = await getFounderRole(guild);
    return member.roles.cache.has(role.id);
}

async function memberIsFactionAdmin(guild, member, adminChannel) {
    return adminChannel.permissionsFor(member).has(PermissionFlagsBits.ViewChannel);
}

async function memberIsFounderOfFaction(guild, member, faction) {
    return await memberIsFounder(guild, member) && mapToArray(member.roles).find(role => role.name === faction);
}

async function makeMemberFactionMember(guild, member, factionRole) {
    console.log("adding role", factionRole.id);
    await member.roles.add(factionRole);
}

async function makeMemberFactionAdmin(guild, member, adminChannel) {
    await adminChannel.permissionOverwrites.edit(member, {
        [PermissionFlagsBits.ViewChannel]: true,
    });
}

async function makeMemberNotFactionAdmin(guild, member, adminChannel) {
    await adminChannel.permissionOverwrites.edit(member, {
        [PermissionFlagsBits.ViewChannel]: false,
    });
}

async function makeMemberAFounder(guild, member) {
    const founderRole = await getFounderRole(guild);
    console.log("adding role", founderRole.id);
    await member.roles.add(founderRole);
}

async function getFounderRole(guild) {
    const founderRole = await guild.roles.fetch(process.env.FOUNDER_ROLE);
    if(!founderRole){
        throw new Error("Founder role not found!");
    }
    return founderRole;
}

async function getFactionRole(guild, name){
    const roles = await getFactionRoles(guild);
    return roles.find(role => role.name === name);
}

async function getMemberFactionRole(guild, member) {
    const roles = await getFactionRoles(guild);
    const factionRole = roles.find(role => member.roles.cache.has(role.id));
    if(!factionRole){
        throw new Error("Member is not in a faction!");
    }
    return factionRole;
}

async function getAdminChannel(guild, factionName) {
    const channels = mapToArray(await guild.channels.fetch());
    return channels.find(channel => channel.name === nameToChannelName(factionName) + "-admin");
}

async function getPoliticsChannel(guild) {
    const id = process.env.POLITICS_CHANNEL;
    return await guild.channels.fetch(id);
}

await client.login(process.env.DISCORD_TOKEN);

