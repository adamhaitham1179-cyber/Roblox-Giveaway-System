const Database = require("better-sqlite3");

const db = new Database("tickets.db");

db.pragma("journal_mode = WAL");

db.exec(`
    CREATE TABLE IF NOT EXISTS ticket_configs (
        guildId TEXT PRIMARY KEY,
        categoryId TEXT NOT NULL,
        staffRoleId TEXT
    );

    CREATE TABLE IF NOT EXISTS tickets (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        giveawayId TEXT NOT NULL,
        guildId TEXT NOT NULL,
        discordId TEXT NOT NULL,
        robloxUsername TEXT NOT NULL,
        robux INTEGER NOT NULL,
        channelId TEXT,
        gamepassUrl TEXT,
        status TEXT DEFAULT 'open',
        createdAt INTEGER NOT NULL,
        updatedAt INTEGER NOT NULL,

        UNIQUE(giveawayId, discordId)
    );
`);

// ======================================================
// TICKET CONFIG
// ======================================================

function setTicketConfig(guildId, categoryId, staffRoleId = null) {
    db.prepare(`
        INSERT INTO ticket_configs
        (
            guildId,
            categoryId,
            staffRoleId
        )
        VALUES (?, ?, ?)

        ON CONFLICT(guildId)
        DO UPDATE SET
            categoryId = excluded.categoryId,
            staffRoleId = excluded.staffRoleId
    `).run(
        guildId,
        categoryId,
        staffRoleId
    );
}

function getTicketConfig(guildId) {
    return db.prepare(`
        SELECT *
        FROM ticket_configs
        WHERE guildId = ?
    `).get(guildId);
}

// ======================================================
// CREATE TICKET
// ======================================================

function createTicket(data) {
    const now = Date.now();

    db.prepare(`
        INSERT OR IGNORE INTO tickets
        (
            giveawayId,
            guildId,
            discordId,
            robloxUsername,
            robux,
            createdAt,
            updatedAt
        )
        VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
        data.giveawayId,
        data.guildId,
        data.discordId,
        data.robloxUsername,
        Number(data.robux),
        now,
        now
    );

    const ticket = db.prepare(`
        SELECT id
        FROM tickets
        WHERE giveawayId = ?
        AND discordId = ?
    `).get(
        data.giveawayId,
        data.discordId
    );

    if (!ticket) {
        throw new Error(
            "Could not create or find the ticket in the database."
        );
    }

    return ticket.id;
}

// ======================================================
// GET TICKET
// Supports both:
// getTicket(ticketId)
// getTicket(giveawayId, discordId)
// ======================================================

function getTicket(ticketIdOrGiveawayId, discordId = null) {

    if (discordId !== null) {

        return db.prepare(`
            SELECT *
            FROM tickets
            WHERE giveawayId = ?
            AND discordId = ?
        `).get(
            ticketIdOrGiveawayId,
            discordId
        );

    }

    return db.prepare(`
        SELECT *
        FROM tickets
        WHERE id = ?
    `).get(
        Number(ticketIdOrGiveawayId)
    );
}

// ======================================================
// GET TICKET BY WINNER
// ======================================================

function getTicketByWinner(giveawayId, discordId) {
    return db.prepare(`
        SELECT *
        FROM tickets
        WHERE giveawayId = ?
        AND discordId = ?
    `).get(
        giveawayId,
        discordId
    );
}

// ======================================================
// GET TICKET BY CHANNEL
// ======================================================

function getTicketByChannelId(channelId) {
    return db.prepare(`
        SELECT *
        FROM tickets
        WHERE channelId = ?
    `).get(channelId);
}

// ======================================================
// SET CHANNEL ID
// ======================================================

function setChannelId(ticketId, channelId) {
    db.prepare(`
        UPDATE tickets
        SET
            channelId = ?,
            updatedAt = ?
        WHERE id = ?
    `).run(
        channelId,
        Date.now(),
        Number(ticketId)
    );
}

// ======================================================
// SET GAME PASS URL
// ======================================================

function setGamepassUrl(ticketId, url) {
    db.prepare(`
        UPDATE tickets
        SET
            gamepassUrl = ?,
            updatedAt = ?
        WHERE id = ?
    `).run(
        url,
        Date.now(),
        Number(ticketId)
    );
}

// ======================================================
// CLOSE / STATUS
// ======================================================

function closeTicket(ticketId, status = "closed") {
    db.prepare(`
        UPDATE tickets
        SET
            status = ?,
            updatedAt = ?
        WHERE id = ?
    `).run(
        status,
        Date.now(),
        Number(ticketId)
    );
}

function setTicketStatus(ticketId, status) {
    db.prepare(`
        UPDATE tickets
        SET
            status = ?,
            updatedAt = ?
        WHERE id = ?
    `).run(
        status,
        Date.now(),
        Number(ticketId)
    );
}

// ======================================================
// EXPORT
// ======================================================

module.exports = {
    setTicketConfig,
    getTicketConfig,

    createTicket,

    getTicket,
    getTicketByWinner,
    getTicketByChannelId,

    setChannelId,
    setGamepassUrl,

    closeTicket,
    setTicketStatus
};