import {SlashCommandBuilder} from "@discordjs/builders";

export default [
    /**
     * /faction create <name> <color>
     * /faction setname <oldname> <newname>
     * /faction makeadmin <user>
     * /faction demoteadmin <user>
     * /faction join <name>
     * /faction delete founder of faction
     */
    new SlashCommandBuilder()
        .setName("faction")
        .setDescription("Faction commands")
        .addSubcommand((subcommand) =>
            subcommand.setName("create").setDescription("Create a faction")
                .addStringOption((option) => option.setName("name").setDescription("The name of the faction").setRequired(true))
                .addStringOption((option) => option.setName("color").setDescription("The color of the faction").setRequired(true))
                .addStringOption((option) => option.setName("emoji").setDescription("The emoji of the faction").setRequired(false))
        )

        .addSubcommandGroup((group) =>
            group.setName("set").setDescription("Set faction properties")
                .addSubcommand((subcommand) =>
                    subcommand.setName("name").setDescription("Set the name of a faction")
                        .addStringOption((option) => option.setName("name").setDescription("The new name of the faction").setRequired(true))
                )

                .addSubcommand((subcommand) =>
                    subcommand.setName("color").setDescription("Set the color of a faction")
                        .addStringOption((option) => option.setName("name").setDescription("The name of the faction").setRequired(true))
                )

                .addSubcommand((subcommand) =>
                    subcommand.setName("emoji").setDescription("Set the emoji of a faction")
                        .addStringOption((option) => option.setName("name").setDescription("The emoji").setRequired(true))
                )

                .addSubcommand((subcommand) =>
                    subcommand.setName("invite").setDescription("Set the invite status of a faction")
                        .addStringOption((option) => option.setName("status").setDescription("The invite status of the faction").setRequired(true).addChoices({
                            name: "open",
                            value: "open"
                        }, {name: "admin-approves", value: "admin-approves"}))
                )
        )

        .addSubcommandGroup((group) =>
            group.setName("admins").setDescription("Faction admins")
                .addSubcommand((subcommand) =>
                    subcommand.setName("add").setDescription("Make a user an admin of a faction")
                        .addUserOption((option) => option.setName("user").setDescription("The user to make an admin").setRequired(true))
                )
                .addSubcommand((subcommand) =>
                    subcommand.setName("remove").setDescription("Make a user not an admin of a faction")
                        .addUserOption((option) => option.setName("user").setDescription("The user to make not an admin").setRequired(true))
                )
        )

        .addSubcommand((subcommand) =>
            subcommand.setName("join").setDescription("Join a faction")
                .addStringOption((option) => option.setName("name").setDescription("The name of the faction").setRequired(true))
        )

        .addSubcommand((subcommand) =>
            subcommand.setName("kick").setDescription("Remove someone from a faction")
                .addUserOption((option) => option.setName("name").setDescription("The user to click").setRequired(true))
        )

        .addSubcommand((subcommand) =>
            subcommand.setName("delete").setDescription("Delete your faction")
        )

        .addSubcommand((subcommand) =>
            subcommand.setName("leave").setDescription("Leave your faction")
        )

        .addSubcommand((subcommand) =>
            subcommand.setName("help").setDescription("Command help")
        )

        .addSubcommand((subcommand) =>
            subcommand.setName("list").setDescription("List factions")
                .addRoleOption((option) => option.setName("name").setDescription("The name of the faction"))
        ).toJSON(),

    new SlashCommandBuilder()
        .setName("alliance")
        .setDescription("Alliance commands")
        .addSubcommand((subcommand) => subcommand.setName("create").setDescription("Create an alliance")
            .addStringOption((option) => option.setName("name").setDescription("The name of the faction").setRequired(true)))
        .addSubcommand((subcommand) => subcommand.setName("delete").setDescription("Delete an alliance")
            .addStringOption((option) => option.setName("name").setDescription("The name of the faction").setRequired(true)))
        .addSubcommand((subcommand) => subcommand.setName("join").setDescription("Join an alliance")
            .addStringOption((option) => option.setName("name").setDescription("The name of the faction").setRequired(true)))
        .addSubcommand((subcommand) => subcommand.setName("leave").setDescription("Leave an alliance")
            .addStringOption((option) => option.setName("name").setDescription("The name of the faction").setRequired(true)))
        .addSubcommand((subcommand) =>
            subcommand.setName("kick").setDescription("Kick a faction from an alliance")
                .addStringOption((option) => option.setName("name").setDescription("The alliance name").setRequired(true))
                .addStringOption((option) => option.setName("faction").setDescription("The faction name").setRequired(true))
        )
        .addSubcommand((subcommand) => subcommand.setName("list").setDescription("List alliances"))
        .addSubcommand((subcommand) =>
            subcommand.setName("help").setDescription("Command help")
        )
        .toJSON()
];
