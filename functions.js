const fs = require('fs');

let knowledgeBase = ''; // Variable to store the knowledge base content
let currentKnowledgeBase = 'default'; // Track the current knowledge base in use
const pingIntervals = {}; // Store ping intervals per number
const moderators = new Set(); // Set to store moderators

function loadKnowledgeBase(kbName) {
    const kbFilePath = `${kbName}.txt`;
    if (fs.existsSync(kbFilePath)) {
        knowledgeBase = fs.readFileSync(kbFilePath, 'utf8');
        currentKnowledgeBase = kbName;
        console.log(`Loaded knowledge base from ${kbFilePath}`);
        return true;
    } else {
        console.error(`Knowledge base file "${kbFilePath}" not found!`);
        return false;
    }
}

function startPinging(client, number) {
    const fullNumber = `${number}@c.us`;
    if (!pingIntervals[fullNumber]) {
        pingIntervals[fullNumber] = setInterval(() => {
            client.sendMessage(fullNumber, 'Pinging');
            console.log(`Sent "Pinging" to ${fullNumber}`);
        }, 240000); // 240 seconds = 4 minutes
        console.log(`Started pinging ${fullNumber}`);
    } else {
        console.log(`Pinging already active for ${fullNumber}`);
    }
}

function stopPinging(number) {
    const fullNumber = `${number}@c.us`; // Format the number correctly
    if (pingIntervals[fullNumber]) {
        clearInterval(pingIntervals[fullNumber]); // Clear the interval
        delete pingIntervals[fullNumber]; // Remove the interval from the object
        console.log(`Stopped pinging ${fullNumber}`);
    } else {
        console.log(`No active pinging found for ${fullNumber}`);
    }
}

function parseTimeString(timeString) {
    const [hours, minutes] = timeString.split(':').map(Number);
    return (hours * 60 * 60 * 1000) + (minutes * 60 * 1000); // Convert to milliseconds
}

function setReminder(client, number, message, time) {
    const delay = parseTimeString(time);

    setTimeout(() => {
        client.sendMessage(`${number}@c.us`, message);
        console.log(`Reminder sent to ${number}: ${message}`);
    }, delay);
}

async function generateResponse(openai, userQuery, knowledgeBase) {
    const prompt = `KnowledgeBase:\n${knowledgeBase}\n\nUser Query: ${userQuery}\n\nResponse:`;

    const response = await openai.chat.completions.create({
        model: 'gpt-4o-mini',
        messages: [{ role: 'user', content: prompt }],
    });

    return response.choices[0].message.content.trim();
}

function addModerator(number) {
    moderators.add(number);
}

function removeModerator(number) {
    moderators.delete(number);
}

function isModerator(number) {
    return moderators.has(number);
}

function checkModerators() {
    return Array.from(moderators);
}

function handleCommand(client, openai, message, senderNumber, isAdmin, isModerator) {
    const messageText = message.body.toLowerCase();

    if (messageText.startsWith('!!')) {
        if (isAdmin || isModerator) {
            switch (true) {
                case messageText.startsWith('!!remind'):
                    const parts = message.body.split('"');
                    if (parts.length === 7) {
                        const targetNumber = parts[1];
                        const reminderMessage = parts[3];
                        const time = parts[5];
                        setReminder(client, targetNumber, reminderMessage, time);
                    } else {
                        message.reply('Incorrect format. Please use !!remind "number" "message" "x:y" (e.g., !!remind "923467467086" "Please pay your due." "00:01").');
                    }
                    break;

                case messageText.startsWith('!!knowledgebase'):
                    const kbName = message.body.split('"')[1];
                    if (kbName) {
                        if (loadKnowledgeBase(kbName)) {
                            message.reply(`Switched to knowledge base "${kbName}".`);
                        } else {
                            message.reply(`Knowledge base "${kbName}" does not exist.`);
                        }
                    } else {
                        message.reply('Please specify the knowledge base name like !!knowledgebase "name".');
                    }
                    break;

                case messageText.startsWith('!!ping'):
                    const targetNumberPing = message.body.split('"')[1];
                    if (targetNumberPing) {
                        startPinging(client, targetNumberPing);
                        message.reply(`Started pinging ${targetNumberPing}.`);
                    } else {
                        message.reply('Please specify the number to ping like !!ping "number".');
                    }
                    break;

                case messageText.startsWith('!!stop-ping'):
                    const targetNumberPingStop = message.body.split('"')[1];
                    if (targetNumberPingStop) {
                        stopPinging(targetNumberPingStop);
                        message.reply(`Stopped pinging ${targetNumberPingStop}.`);
                    } else {
                        message.reply('Please specify the number to stop pinging like !!pingstop "number".');
                    }
                    break;

                case isAdmin && messageText.startsWith('!!addmoderator'):
                    const newModerator = message.body.split('"')[1];
                    if (newModerator) {
                        addModerator(newModerator);
                        message.reply(`${newModerator} is now a moderator.`);
                    } else {
                        message.reply('Please specify the number to add as a moderator like !!addmoderator "number".');
                    }
                    break;

                case isAdmin && messageText.startsWith('!!removemoderator'):
                    const moderatorToRemove = message.body.split('"')[1];
                    if (moderatorToRemove) {
                        removeModerator(moderatorToRemove);
                        message.reply(`${moderatorToRemove} is no longer a moderator.`);
                    } else {
                        message.reply('Please specify the number to remove as a moderator like !!removemoderator "number".');
                    }
                    break;

                case isAdmin && messageText.startsWith('!!checkmoderators'):
                    const moderatorsList = checkModerators();
                    message.reply(`Current moderators are: ${moderatorsList.join(', ')}`);
                    break;

                case messageText.startsWith('!!menu'):
                    message.reply(showMenu(isAdmin));
                    break;

                default:
                    message.reply("Unknown command. Please check the available commands using !!menu.");
                    break;
            }
        } else {
            message.reply("You don't have permission to use commands.");
        }
    } else {
        const userQuery = message.body.toLowerCase();
        generateResponse(openai, userQuery, knowledgeBase).then(reply => {
            message.reply(reply);
        }).catch(error => {
            console.error('Error while processing the message:', error);
            message.reply("Sorry, something went wrong while processing your request.");
        });
    }
}

function showMenu(isAdmin) {
    if (isAdmin) {
        return `
        *Commands Menu (Admin):*
        - !!ping "number": Start pinging the specified number every 240 seconds
        - !!stop-ping "number": Stop pinging the specified number
        - !!menu: Show this command menu
        - !!remind "number" "message" "x:y": Set a reminder for the specified number
        - !!knowledgebase "name": Switch to the specified knowledge base
        - !!checkmoderators: List all current moderators
        - !!addmoderator "number": Add a moderator (Admin only)
        - !!removemoderator "number": Remove a moderator (Admin only)
        `;
    } else {
        return `
        *Commands Menu (Moderator):*
        - !!ping "number": Start pinging the specified number every 240 seconds
        - !!stop-ping "number": Stop pinging the specified number
        - !!menu: Show this command menu
        - !!remind "number" "message" "x:y": Set a reminder for the specified number
        - !!knowledgebase "name": Switch to the specified knowledge base
        `;
    }
}

// Export the functions to be used in index.js
module.exports = {
    loadKnowledgeBase,
    startPinging,
    stopPinging,
    showMenu,
    parseTimeString,
    setReminder,
    generateResponse,
    addModerator,
    removeModerator,
    isModerator,
    checkModerators,
    handleCommand,
    moderators
};
