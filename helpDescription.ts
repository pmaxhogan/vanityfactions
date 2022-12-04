export default `
/faction help\tDisplay this help message
/faction list\tlist all factions
/faction list <name>\tGet details about faction <name>

/faction join <name>\tJoin faction <name> (may require approval)
/faction create <name> <color>\tCreate a faction with name <name> and color <color> (color can be a hex code like \`#FE6210\` or a color name)
/faction delete\tDelete your faction
/faction leave\tLeave your faction (if you are not the founder)
/faction admins add <user>\tMake <user> an admin of your faction (if you are a faction founder)
/faction admins remove <user>\tMake <user> not an admin of your faction (if you are a faction founder)

/faction kick <user>\tKick <user> from your faction (if you are an admin)
/faction set name <name>\tSet the name of your faction to <name> (if you are an admin)
/faction set color <color>\tSet the color of your faction to <color> (if you are an admin)
/faction set invite <status>\tSet the invite status of your faction to <status> (if you are an admin)

/alliance help\tDisplay this help message
/alliance list\tlist all alliances
/alliance create <name>\tCreate an alliance with name <name> (if you are a faction founder)
/alliance delete <name>\tDelete your alliance (if you are an alliance founder)
/alliance join <name>\tJoin alliance <name> (if you are a faction founder, requires approval)
/alliance leave\tLeave your alliance (if you are a faction founder & did not create the alliance)
/alliance kick <faction>\tKick <faction> from your alliance (if you are the alliance founder)
`;
