const TICKET_API_URL = process.env.TICKET_API_URL;
const TICKET_API_SECRET = process.env.TICKET_API_SECRET;

async function sendWinnerToTicketBot(data) {

    if (!TICKET_API_URL) {
        throw new Error("TICKET_API_URL is missing.");
    }

    if (!TICKET_API_SECRET) {
        throw new Error("TICKET_API_SECRET is missing.");
    }

    const response = await fetch(
        `${TICKET_API_URL}/internal/giveaway-winner`,
        {
            method: "POST",

            headers: {
                "Content-Type": "application/json",
                "Authorization": `Bearer ${TICKET_API_SECRET}`
            },

            body: JSON.stringify(data)
        }
    );

    const text = await response.text();

    let result;

    try {
        result = JSON.parse(text);
    } catch {
        result = {
            success: false,
            error: text
        };
    }

    if (!response.ok || !result.success) {
        throw new Error(
            result.error ||
            `Ticket Bot returned HTTP ${response.status}`
        );
    }

    return result;
}

module.exports = {
    sendWinnerToTicketBot
};