const fs = require('fs');

// Constants
const POLLING_INTERVAL = 1000;
const MAX_RETRIES = 60;
const userMessageCounts = {}; // Store message counts and timestamps for users
let NO_LIMIT = false; // Flag to remove the message limit for all users
// Variables shared across modes
const pingIntervals = {};
const moderators = new Set();
const reminders = {}; // To keep track of reminders
const activeAskOperations = {};

let currentMode = 'code'; // Default mode is 'openai'

// Variables specific to openai mode
let assistantKey = 'asst_6xFy9UjYJsmSbPiKqmI5TPee';
const userThreads = {};

// Variables specific to code mode
let knowledgeBase = '';
let currentKnowledgeBase = 'default';
const userMessageHistory = {};

// Load the default knowledge base at module initialization for code mode
loadKnowledgeBase(currentKnowledgeBase);

function handleAsk(client, numbers, message, interval, senderNumber) {
    const numberArray = numbers.split(',').map(num => num.trim());
    const delay = parseTimeString(interval);

    numberArray.forEach((number, index) => {
        const formattedNumber = `${number}@c.us`;

        // Schedule the message
        activeAskOperations[number] = setTimeout(() => {
            client.sendMessage(formattedNumber, message)
                .then(() => {
                    console.log(`Message sent successfully to ${number}`);
                    // Notify the bot (i.e., send the message to itself)
                    client.sendMessage(`${senderNumber}@c.us`, `Message sent successfully to ${number}`);
                })
                .catch((err) => {
                    console.error(`Failed to send message to ${number}:`, err);
                    // Notify the bot (i.e., send the message to itself)
                    client.sendMessage(`${senderNumber}@c.us`, `Failed to send message to ${number}: ${err.message}`);
                });
            delete activeAskOperations[number]; // Clean up after sending
        }, delay * index);
    });
}

function cancelAskOperations(client) {
    Object.keys(activeAskOperations).forEach((number) => {
        clearTimeout(activeAskOperations[number]);
        console.log(`Operation canceled for ${number}`);
        client.sendMessage(adminNumber, `Operation canceled for ${number}`);
    });
    // Clear the active operations list
    Object.keys(activeAskOperations).forEach(key => delete activeAskOperations[key]);
}

function checkMessageLimit(senderNumber, isAdmin) {
    if (NO_LIMIT || isAdmin || isModerator(senderNumber)) return true; // Skip limit check for admins, moderators, or if no limit is applied

    const userLimit = userMessageCounts[senderNumber]?.maxLimit || 100; // Default to 100 if not set
    if (userMessageCounts[senderNumber]?.count >= userLimit) {
        return false;
    }
    return true;
}

function trackUserMessage(senderNumber) {
    const currentTime = Date.now();
    if (!userMessageCounts[senderNumber]) {
        userMessageCounts[senderNumber] = { count: 0, firstMessageTime: currentTime, maxLimit: 100 }; // Default max limit
    }
    const timeDiff = currentTime - userMessageCounts[senderNumber].firstMessageTime;

    if (timeDiff > 24 * 60 * 60 * 1000) { // Reset after 24 hours
        userMessageCounts[senderNumber] = { count: 0, firstMessageTime: currentTime, maxLimit: userMessageCounts[senderNumber].maxLimit };
    }

    userMessageCounts[senderNumber].count += 1;
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
    const fullNumber = `${number}@c.us`;
    if (pingIntervals[fullNumber]) {
        clearInterval(pingIntervals[fullNumber]);
        delete pingIntervals[fullNumber];
        console.log(`Stopped pinging ${fullNumber}`);
    } else {
        console.log(`No active pinging found for ${fullNumber}`);
    }
}

function parseTimeString(timeString) {
    const [days, hours, minutes, seconds] = timeString.split(':').map(Number);
    return (days * 24 * 60 * 60 * 1000) + (hours * 60 * 60 * 1000) + (minutes * 60 * 1000) + (seconds * 1000);
}

function setReminder(client, number, message, time) {
    const delay = parseTimeString(time);  // Using the updated parseTimeString function
    const reminderKey = `${number}-${message}-${time}`;

    reminders[reminderKey] = setTimeout(() => {
        client.sendMessage(`${number}@c.us`, message)
            .then(() => {
                console.log(`Reminder sent to ${number}: ${message}`);
            })
            .catch((err) => {
                console.error(`Failed to send reminder to ${number}:`, err);
                client.sendMessage(adminNumber, `Failed to send reminder to ${number}: ${err.message}`);
            });
        delete reminders[reminderKey];  // Clean up after sending the reminder
    }, delay);

    console.log(`Reminder set for ${number} in ${time} with message: "${message}".`);
}

function cancelReminder(client, number) {
    const reminderKeys = Object.keys(reminders).filter(key => key.startsWith(`${number}-`));

    if (reminderKeys.length > 0) {
        reminderKeys.forEach(reminderKey => {
            clearTimeout(reminders[reminderKey]);
            delete reminders[reminderKey];
        });
        console.log(`All reminders for ${number} have been canceled.`);
        return true;
    } else {
        console.log(`No reminders found for ${number}.`);
        return false;
    }
}

function clearAllThreads() {
    for (let user in userThreads) {
        delete userThreads[user];
    }
    console.log('All user threads have been cleared.');
}

async function generateResponseOpenAI(assistant, senderNumber, userMessage) {
    let threadId;

    if (userThreads[senderNumber]) {
        threadId = userThreads[senderNumber];
    } else {
        const chat = await assistant.beta.threads.create();
        threadId = chat.id;
        userThreads[senderNumber] = threadId;
    }

    await assistant.beta.threads.messages.create(threadId, {
        role: 'user',
        content: userMessage
    });

    const run = await assistant.beta.threads.runs.create(threadId, {
        assistant_id: assistantKey
    });

    await pollRunStatus(assistant, threadId, run.id);

    const messageResponse = await assistant.beta.threads.messages.list(threadId);
    const messages = messageResponse.data;
    const latestMessage = messages[0];

    return latestMessage.content[0].text.value.trim();
}

async function pollRunStatus(client, threadId, runId) {
    let retries = 0;
    while (retries < MAX_RETRIES) {
        const run = await client.beta.threads.runs.retrieve(threadId, runId);
        if (run.status === "completed") {
            return;
        } else if (run.status === "failed" || run.status === "cancelled") {
            throw new Error(`Run ${runId} ${run.status}`);
        }
        await sleep(POLLING_INTERVAL);
        retries++;
    }
    throw new Error(`Run ${runId} timed out`);
}

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

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

async function generateResponseCode(openai, senderNumber) {
    const lastMessage = userMessageHistory[senderNumber]?.slice(-1)[0] || ''; // Get the last message only

    console.log(`User History for ${senderNumber}:`, userMessageHistory[senderNumber]);
    console.log(`Last Message:`, lastMessage);

    const languageDetectionPrompt = `Detect the language and text format of the following message: "${lastMessage}". Respond with the same language but use english alphabets, accordingly to formal or informal.`;
    const languageResponse = await openai.chat.completions.create({
        model: 'gpt-4o-mini',
        messages: [{ role: 'user', content: languageDetectionPrompt }],
    });

    const detectedLanguageAndFormat = languageResponse.choices[0].message.content.trim();

    const prompt = `Given the following knowledge base, reply to the last message only. Ensure your response is in the same language and text format (formal or informal) as detected.

Knowledge Base:
${knowledgeBase}

Last Message:
${lastMessage}

Language and Format: ${detectedLanguageAndFormat}

Response:`;

    const response = await openai.chat.completions.create({
        model: 'gpt-4o-mini',
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.2,  // Setting the temperature to 0.2
    });

    return response.choices[0].message.content.trim();
}


function updateUserMessageHistory(senderNumber, message) {
    if (!userMessageHistory[senderNumber]) {
        userMessageHistory[senderNumber] = [];
    }
    userMessageHistory[senderNumber].push(message);
    if (userMessageHistory[senderNumber].length > 20) { // Keep only the last 20 messages
        userMessageHistory[senderNumber].shift();
    }
}

function addModerator(number) {
    moderators.add(number);
    console.log(`Added ${number} as moderator.`);
}
addModerator('923261467086');

function removeModerator(number) {
    moderators.delete(number);
    console.log(`Removed ${number} from moderators.`);
}

function isModerator(number) {
    return moderators.has(number);
}

function checkModerators() {
    return Array.from(moderators);
}

function handleCommand(client, assistantOrOpenAI, message, senderNumber, isAdmin, isModerator) {
    // Ensure message history is tracked
    updateUserMessageHistory(senderNumber, message.body);

    const messageText = message.body.toLowerCase();

    if (messageText.startsWith('!!')) {
        if (isAdmin || isModerator) {
            switch (true) {
                case messageText.startsWith('!!ask'):
                    const askParts = message.body.match(/"([^"]+)"/g);
                    if (askParts && askParts.length === 3) {
                        const numbers = askParts[0].replace(/"/g, '');
                        const askMessage = askParts[1].replace(/"/g, '');
                        const interval = askParts[2].replace(/"/g, '');
                        handleAsk(client, numbers, askMessage, interval, senderNumber);
                        message.reply(`Ask operation started for numbers: ${numbers}`);
                    } else {
                        message.reply('Incorrect format. Please use !!ask "number,number,number,..." "message" "00:00:00:00" (days:hours:minutes:seconds).');
                    }
                    break;

                case messageText.startsWith('!!not-ask'):
                    cancelAskOperations(client);
                    message.reply('All ask operations have been canceled.');
                    break;

                case messageText.startsWith('!!remind'):
                    const remindParts = message.body.match(/"([^"]+)"/g);
                    if (remindParts && remindParts.length === 3) {
                        const number = remindParts[0].replace(/"/g, '');
                        const remindMessage = remindParts[1].replace(/"/g, '');
                        const time = remindParts[2].replace(/"/g, '');
                        setReminder(client, number, remindMessage, time);
                        message.reply(`Reminder set for ${number} in ${time} with message: "${remindMessage}".`);
                    } else {
                        message.reply('Incorrect format. Please use !!remind "number" "message" "00:00:00:00" (days:hours:minutes:seconds).');
                    }
                    break;

                case messageText.startsWith('!!cancel-remind'):
                    const cancelParts = message.body.split('"');
                    if (cancelParts.length === 3) {
                        const cancelNumber = cancelParts[1];
                        const cancelSuccess = cancelReminder(client, cancelNumber);
                        if (cancelSuccess) {
                            message.reply(`All reminders for ${cancelNumber} have been canceled.`);
                        } else {
                            message.reply(`No reminders found for ${cancelNumber}.`);
                        }
                    } else {
                        message.reply('Incorrect format. Please use !!cancel-remind "number".');
                    }
                    break;

                case isAdmin && messageText.startsWith('!!switch'):
                    const newMode = message.body.split('"')[1];
                    if (newMode === 'openai' || newMode === 'code') {
                        currentMode = newMode;
                        message.reply(`Switched to ${newMode} mode.`);
                    } else {
                        message.reply('Invalid mode. Use !!switch "openai" or "code".');
                    }
                    break;

                case currentMode === 'code' && isAdmin && messageText.startsWith('!!listkb'):
                    fs.readdir('.', (err, files) => {
                        if (err) {
                            message.reply('Error reading directory.');
                            console.error(err);
                        } else {
                            const kbFiles = files.filter(file => file.endsWith('.txt'));
                            if (kbFiles.length > 0) {
                                message.reply(`Available knowledge base files:\n${kbFiles.join('\n')}`);
                            } else {
                                message.reply('No knowledge base files found.');
                            }
                        }
                    });
                    break;

                case currentMode === 'openai' && isAdmin && messageText.startsWith('!!assist'):
                    const newAssistantKey = message.body.split('"')[1];
                    if (newAssistantKey) {
                        assistantKey = newAssistantKey;
                        message.reply('Assistant key has been updated.');
                    } else {
                        message.reply('Please provide a valid assistant key using !!assist "Key".');
                    }
                    break;

                case currentMode === 'openai' && isAdmin && messageText.startsWith('!!clear-assist'):
                    clearAllThreads();
                    message.reply('All threads have been cleared.');
                    break;

                case currentMode === 'code' && isAdmin && messageText.startsWith('!!kbadd'):
                    const customKbName = message.body.split(' ')[1];
                    if (customKbName && message.hasMedia) {
                        message.downloadMedia().then(media => {
                            const kbFilePath = `./${customKbName}.txt`;

                            fs.writeFileSync(kbFilePath, media.data, { encoding: 'base64' });
                            message.reply(`Knowledge base "${customKbName}" has been added as ${customKbName}.txt.`);
                        }).catch(err => {
                            console.error('Error downloading media:', err);
                            message.reply('Failed to download and save the knowledge base file.');
                        });
                    } else {
                        message.reply('Please provide a custom name and attach the knowledge base file with the !!kbadd command.');
                    }
                    break;

                case currentMode === 'code' && isAdmin && messageText.startsWith('!!deletekb'):
                    const kbNameToDelete = message.body.split(' ')[1];
                    if (kbNameToDelete) {
                        const kbFilePathToDelete = `./${kbNameToDelete}.txt`;
                        if (fs.existsSync(kbFilePathToDelete)) {
                            fs.unlink(kbFilePathToDelete, (err) => {
                                if (err) {
                                    console.error(`Error deleting file "${kbNameToDelete}.txt":`, err);
                                    message.reply(`Failed to delete ${kbNameToDelete}.txt. Please try again.`);
                                } else {
                                    message.reply(`Knowledge base "${kbNameToDelete}.txt" has been successfully deleted.`);
                                }
                            });
                        } else {
                            message.reply(`Knowledge base "${kbNameToDelete}.txt" does not exist.`);
                        }
                    } else {
                        message.reply('Please specify the name of the knowledge base file to delete. Usage: !!deletekb [filename]');
                    }
                    break;

                case currentMode === 'code' && isAdmin && messageText.startsWith('!!knowledgebase'):
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
                        message.reply('Please specify the number to stop pinging like !!stop-ping "number".');
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
                    message.reply(showMenu(isAdmin, currentMode));
                    break;

                case isAdmin && messageText.startsWith('!!limit-reset'):
                    const resetParts = message.body.split('"');
                    const targetNumber = resetParts[1];
                    const newLimit = parseInt(resetParts[3], 10);

                    if (targetNumber && !isNaN(newLimit)) {
                        if (!userMessageCounts[targetNumber]) {
                            userMessageCounts[targetNumber] = { count: 0, firstMessageTime: Date.now(), maxLimit: newLimit };
                        } else {
                            userMessageCounts[targetNumber].maxLimit = newLimit;
                        }
                        message.reply(`Message limit for ${targetNumber} has been set to ${newLimit}.`);
                    } else {
                        message.reply('Incorrect format. Please use !!limit-reset "number" "amount of messages".');
                    }
                    break;

                case isAdmin && messageText.startsWith('!!no-limit'):
                    NO_LIMIT = true;
                    message.reply('Message limit has been removed for all users.');
                    break;

                case isAdmin && messageText.startsWith('!!yes-limit'):
                    NO_LIMIT = false;

                    for (let user in userMessageCounts) {
                        userMessageCounts[user].maxLimit = 100;
                    }

                    message.reply('Message limit has been enforced for all users.');
                    break;

                default:
                    message.reply("Unknown command. Please check the available commands using !!menu.");
                    break;
            }
        } else {
            message.reply("You don't have permission to use commands.");
        }
    } else {
        if (checkMessageLimit(senderNumber)) {
            trackUserMessage(senderNumber);

            if (currentMode === 'openai') {
                generateResponseOpenAI(assistantOrOpenAI, senderNumber, message.body).then(reply => {
                    message.reply(reply);
                }).catch(error => {
                    console.error('Error while processing the message:', error);
                    message.reply("Sorry, something went wrong while processing your request.");
                });
            } else if (currentMode === 'code') {
                generateResponseCode(assistantOrOpenAI, senderNumber).then(reply => {
                    message.reply(reply);
                }).catch(error => {
                    console.error('Error while processing the message:', error);
                    message.reply("Sorry, something went wrong while processing your request.");
                });
            }
        } else {
            message.reply(`Your today's message limit is ended 
- [usually it's 100 messages per day unless you get extra from admin]
- Please try again next day and try to keep the conversation short :')
- Or you can ask the admin to reset your limit.`);
        }
    }
}

function showMenu(isAdmin, mode) {
    if (mode === 'openai') {
        return isAdmin ? `
        *Commands Menu (Admin - OpenAI Mode):*
        - !!start: For starting the bot
        - !!pause: For pausing the bot
        - !!ping "number": Start pinging the specified number every 240 seconds
        - !!stop-ping "number": Stop pinging the specified number
        - !!menu: Show this command menu
        - !!remind "number" "message" "00:00:00:00": Set a reminder for the specified number with a message after a specified time (days:hours:minutes:seconds)
        - !!ask "number,number,number" "00:00:00:00": Send a message to multiple numbers with a specified time interval (days:hours:minutes:seconds) between each
        - !!cancel-remind "number": Cancel all reminders for the specified number
        - !!not-ask: Cancel all active ask operations
        - !!assist "Key": Change the Assistant API Key
        - !!switch "openai" or "code": Switch between OpenAI mode and Code mode
        - !!checkmoderators: List all current moderators
        - !!addmoderator "number": Add a moderator (Admin only)
        - !!removemoderator "number": Remove a moderator (Admin only)
        - !!clear-assist: Clear all threads (Admin only)
        - !!limit-reset "number" "amount of messages": Reset the message limit for a specific user (Admin only)
        - !!no-limit: Remove the message limit for all users (Admin only)
        - !!yes-limit: Reinstate the message limit for all users (Admin only)
        ` : `
        *Commands Menu (Moderator - OpenAI Mode):*
        - !!start: For starting the bot
        - !!pause: For pausing the bot
        - !!ping "number": Start pinging the specified number every 240 seconds
        - !!stop-ping "number": Stop pinging the specified number
        - !!menu: Show this command menu
        - !!remind "number" "message" "00:00:00:00": Set a reminder for the specified number with a message after a specified time (days:hours:minutes:seconds)
        - !!ask "number,number,number" "00:00:00:00": Send a message to multiple numbers with a specified time interval (days:hours:minutes:seconds) between each
        - !!cancel-remind "number": Cancel all reminders for the specified number
        - !!not-ask: Cancel all active ask operations
        `;
    } else {
        return isAdmin ? `
        *Commands Menu (Admin - Code Mode):*
        - !!start: For starting the bot
        - !!pause: For pausing the bot
        - !!ping "number": Start pinging the specified number every 240 seconds
        - !!stop-ping "number": Stop pinging the specified number
        - !!menu: Show this command menu
        - !!remind "number" "message" "00:00:00:00": Set a reminder for the specified number with a message after a specified time (days:hours:minutes:seconds)
        - !!ask "number,number,number" "00:00:00:00": Send a message to multiple numbers with a specified time interval (days:hours:minutes:seconds) between each
        - !!cancel-remind "number": Cancel all reminders for the specified number
        - !!not-ask: Cancel all active ask operations
        - !!knowledgebase "name": Switch to the specified knowledge base
        - !!switch "openai" or "code": Switch between OpenAI mode and Code mode
        - !!checkmoderators: List all current moderators
        - !!addmoderator "number": Add a moderator (Admin only)
        - !!removemoderator "number": Remove a moderator (Admin only)
        - !!kbadd "filename": Add a new knowledge base file (Admin only)
        - !!deletekb "filename": Delete a knowledge base file (Admin only)
        - !!listkb: List all knowledge base files (Admin only)
        - !!limit-reset "number" "amount of messages": Reset the message limit for a specific user (Admin only)
        - !!no-limit: Remove the message limit for all users (Admin only)
        - !!yes-limit: Reinstate the message limit for all users (Admin only)
        ` : `
        *Commands Menu (Moderator - Code Mode):*
        - !!start: For starting the bot
        - !!pause: For pausing the bot
        - !!ping "number": Start pinging the specified number every 240 seconds
        - !!stop-ping "number": Stop pinging the specified number
        - !!menu: Show this command menu
        - !!remind "number" "message" "00:00:00:00": Set a reminder for the specified number with a message after a specified time (days:hours:minutes:seconds)
        - !!ask "number,number,number" "00:00:00:00": Send a message to multiple numbers with a specified time interval (days:hours:minutes:seconds) between each
        - !!cancel-remind "number": Cancel all reminders for the specified number
        - !!not-ask: Cancel all active ask operations
        - !!knowledgebase "name": Switch to the specified knowledge base
        `;
    }
}

// Export the functions to be used in index.js
module.exports = {
    startPinging,
    stopPinging,
    showMenu,
    parseTimeString,
    setReminder,
    generateResponseOpenAI,
    generateResponseCode,
    addModerator,
    removeModerator,
    isModerator,
    checkModerators,
    handleCommand,
    loadKnowledgeBase,
    updateUserMessageHistory,
    sleep,
    clearAllThreads,
    trackUserMessage,
    checkMessageLimit
};



// this code has assistant------------------------------------------------
// const userThreads = {}; // Store thread IDs associated with each user
// const pingIntervals = {}; // Store ping intervals per number
// const moderators = new Set(); // Set to store moderators
// let assistantKey = 'asst_uCBkRBD19dgYO896IXHhVEBh'; // Variable to store the Assistant key

// function startPinging(client, number) {
//     const fullNumber = `${number}@c.us`;
//     if (!pingIntervals[fullNumber]) {
//         pingIntervals[fullNumber] = setInterval(() => {
//             client.sendMessage(fullNumber, 'Pinging');
//             console.log(`Sent "Pinging" to ${fullNumber}`);
//         }, 240000); // 240 seconds = 4 minutes
//         console.log(`Started pinging ${fullNumber}`);
//     } else {
//         console.log(`Pinging already active for ${fullNumber}`);
//     }
// }

// function stopPinging(number) {
//     const fullNumber = `${number}@c.us`; // Format the number correctly
//     if (pingIntervals[fullNumber]) {
//         clearInterval(pingIntervals[fullNumber]); // Clear the interval
//         delete pingIntervals[fullNumber]; // Remove the interval from the object
//         console.log(`Stopped pinging ${fullNumber}`);
//     } else {
//         console.log(`No active pinging found for ${fullNumber}`);
//     }
// }

// function parseTimeString(timeString) {
//     const [hours, minutes] = timeString.split(':').map(Number);
//     return (hours * 60 * 60 * 1000) + (minutes * 60 * 1000); // Convert to milliseconds
// }

// function setReminder(client, number, message, time) {
//     const delay = parseTimeString(time);

//     setTimeout(() => {
//         client.sendMessage(`${number}@c.us`, message);
//         console.log(`Reminder sent to ${number}: ${message}`);
//     }, delay);
// }


// const POLLING_INTERVAL = 1000; // 1 second
// const MAX_RETRIES = 60; // Maximum number of retries (60 seconds total)

// async function generateResponse(assistant, senderNumber, userMessage) {
//     let threadId;

//     // Check if a thread ID already exists for this user
//     if (userThreads[senderNumber]) {
//         threadId = userThreads[senderNumber];
//     } else {
//         // If not, create a new thread and store its ID
//         const chat = await assistant.beta.threads.create();
//         console.log(`New thread created with ID: ${chat.id}`);

//         threadId = chat.id;
//         userThreads[senderNumber] = threadId; // Associate the thread ID with the user
//     }

//     // Add the user's message to the thread
//     await assistant.beta.threads.messages.create(threadId, {
//         role: 'user',
//         content: userMessage
//     });

//     // Create a run for the thread
//     const run = await assistant.beta.threads.runs.create(threadId, {
//         assistant_id: assistantKey
//     });

//     await pollRunStatus(assistant, threadId, run.id);

//     const messageResponse = await assistant.beta.threads.messages.list(threadId);
//     const messages = messageResponse.data;
//     const latestMessage = messages[0];

//     const latestMessageContent = latestMessage.content[0].text.value; // Get the content of the first message

//     return latestMessageContent.trim();
// }

// async function pollRunStatus(client, threadId, runId) {
//     let retries = 0;
//     while (retries < MAX_RETRIES) {
//         const run = await client.beta.threads.runs.retrieve(threadId, runId);
//         if (run.status === "completed") {
//             console.log("$ Run Completed!");
//             return;
//         } else if (run.status === "failed" || run.status === "cancelled") {
//             throw new Error(`Run ${runId} ${run.status}`);
//         }
//         console.log(`* Run Status: ${run.status}`);
//         await sleep(POLLING_INTERVAL);
//         retries++;
//     }
//     throw new Error(`Run ${runId} timed out`);
// }

// function sleep(ms) {
//     return new Promise(resolve => setTimeout(resolve, ms));
// }




// function addModerator(number) {
//     moderators.add(number);
// }

// function removeModerator(number) {
//     moderators.delete(number);
// }

// function isModerator(number) {
//     return moderators.has(number);
// }

// function checkModerators() {
//     return Array.from(moderators);
// }

// function handleCommand(client, assistant, message, senderNumber, isAdmin, isModerator) {
//     const messageText = message.body.toLowerCase();

//     if (messageText.startsWith('!!')) {
//         if (isAdmin || isModerator) {
//             switch (true) {
//                 case messageText.startsWith('!!remind'):
//                     const parts = message.body.split('"');
//                     if (parts.length === 7) {
//                         const targetNumber = parts[1];
//                         const reminderMessage = parts[3];
//                         const time = parts[5];
//                         setReminder(client, targetNumber, reminderMessage, time);
//                     } else {
//                         message.reply('Incorrect format. Please use !!remind "number" "message" "x:y" (e.g., !!remind "923467467086" "Please pay your due." "00:01").');
//                     }
//                     break;

//                 case isAdmin && messageText.startsWith('!!assist'):
//                     const newAssistantKey = message.body.split('"')[1];
//                     if (newAssistantKey) {
//                         assistantKey = newAssistantKey;
//                         message.reply('Assistant key has been updated.');
//                     } else {
//                         message.reply('Please provide a valid assistant key using !!assist "Key".');
//                     }
//                     break;

//                 case messageText.startsWith('!!ping'):
//                     const targetNumberPing = message.body.split('"')[1];
//                     if (targetNumberPing) {
//                         startPinging(client, targetNumberPing);
//                         message.reply(`Started pinging ${targetNumberPing}.`);
//                     } else {
//                         message.reply('Please specify the number to ping like !!ping "number".');
//                     }
//                     break;

//                 case messageText.startsWith('!!stop-ping'):
//                     const targetNumberPingStop = message.body.split('"')[1];
//                     if (targetNumberPingStop) {
//                         stopPinging(targetNumberPingStop);
//                         message.reply(`Stopped pinging ${targetNumberPingStop}.`);
//                     } else {
//                         message.reply('Please specify the number to stop pinging like !!stop-ping "number".');
//                     }
//                     break;

//                 case isAdmin && messageText.startsWith('!!addmoderator'):
//                     const newModerator = message.body.split('"')[1];
//                     if (newModerator) {
//                         addModerator(newModerator);
//                         message.reply(`${newModerator} is now a moderator.`);
//                     } else {
//                         message.reply('Please specify the number to add as a moderator like !!addmoderator "number".');
//                     }
//                     break;

//                 case isAdmin && messageText.startsWith('!!removemoderator'):
//                     const moderatorToRemove = message.body.split('"')[1];
//                     if (moderatorToRemove) {
//                         removeModerator(moderatorToRemove);
//                         message.reply(`${moderatorToRemove} is no longer a moderator.`);
//                     } else {
//                         message.reply('Please specify the number to remove as a moderator like !!removemoderator "number".');
//                     }
//                     break;

//                 case isAdmin && messageText.startsWith('!!checkmoderators'):
//                     const moderatorsList = checkModerators();
//                     message.reply(`Current moderators are: ${moderatorsList.join(', ')}`);
//                     break;

//                 case messageText.startsWith('!!menu'):
//                     message.reply(showMenu(isAdmin));
//                     break;

//                 default:
//                     message.reply("Unknown command. Please check the available commands using !!menu.");
//                     break;
//             }
//         } else {
//             message.reply("You don't have permission to use commands.");
//         }
//     } else {
//         generateResponse(assistant, senderNumber, message.body).then(reply => {
//             message.reply(reply);
//         }).catch(error => {
//             console.error('Error while processing the message:', error);
//             message.reply("Sorry, something went wrong while processing your request.");
//         });
//     }
// }

// function showMenu(isAdmin) {
//     if (isAdmin) {
//         return `
//         *Commands Menu (Admin):*
//         - !!start: For starting bot
//         - !!pause: For pausing bot
//         - !!ping "number": Start pinging the specified number every 240 seconds
//         - !!stop-ping "number": Stop pinging the specified number
//         - !!menu: Show this command menu
//         - !!remind "number" "message" "x:y": Set a reminder for the specified number
//         - !!assist "Key": Change the Assistant API Key
//         - !!checkmoderators: List all current moderators
//         - !!addmoderator "number": Add a moderator (Admin only)
//         - !!removemoderator "number": Remove a moderator (Admin only)
//         `;
//     } else {
//         return `
//         *Commands Menu (Moderator):*
//         - !!start: For starting bot
//         - !!pause: For pausing bot
//         - !!ping "number": Start pinging the specified number every 240 seconds
//         - !!stop-ping "number": Stop pinging the specified number
//         - !!menu: Show this command menu
//         - !!remind "number" "message" "x:y": Set a reminder for the specified number
//         `;
//     }
// }

// // Export the functions to be used in index.js
// module.exports = {
//     startPinging,
//     stopPinging,
//     showMenu,
//     parseTimeString,
//     setReminder,
//     generateResponse,
//     addModerator,
//     removeModerator,
//     isModerator,
//     checkModerators,
//     handleCommand,
//     moderators,
//     generateResponse,
//     pollRunStatus,
//     sleep
// };











// This code has history saving skill-----------------------------------------------------------------------------------------

// const fs = require('fs');

// let knowledgeBase = ''; // Variable to store the knowledge base content
// let currentKnowledgeBase = 'default'; // Track the current knowledge base in use
// const pingIntervals = {}; // Store ping intervals per number
// const moderators = new Set(); // Set to store moderators
// const userMessageHistory = {}; // Store last 5 messages per user

// function loadKnowledgeBase(kbName) {
//     const kbFilePath = `${kbName}.txt`;
//     if (fs.existsSync(kbFilePath)) {
//         knowledgeBase = fs.readFileSync(kbFilePath, 'utf8');
//         currentKnowledgeBase = kbName;
//         console.log(`Loaded knowledge base from ${kbFilePath}`);
//         return true;
//     } else {
//         console.error(`Knowledge base file "${kbFilePath}" not found!`);
//         return false;
//     }
// }

// // Load the default knowledge base at module initialization
// loadKnowledgeBase(currentKnowledgeBase);

// function startPinging(client, number) {
//     const fullNumber = `${number}@c.us`;
//     if (!pingIntervals[fullNumber]) {
//         pingIntervals[fullNumber] = setInterval(() => {
//             client.sendMessage(fullNumber, 'Pinging');
//             console.log(`Sent "Pinging" to ${fullNumber}`);
//         }, 240000); // 240 seconds = 4 minutes
//         console.log(`Started pinging ${fullNumber}`);
//     } else {
//         console.log(`Pinging already active for ${fullNumber}`);
//     }
// }

// function stopPinging(number) {
//     const fullNumber = `${number}@c.us`; // Format the number correctly
//     if (pingIntervals[fullNumber]) {
//         clearInterval(pingIntervals[fullNumber]); // Clear the interval
//         delete pingIntervals[fullNumber]; // Remove the interval from the object
//         console.log(`Stopped pinging ${fullNumber}`);
//     } else {
//         console.log(`No active pinging found for ${fullNumber}`);
//     }
// }

// function parseTimeString(timeString) {
//     const [hours, minutes] = timeString.split(':').map(Number);
//     return (hours * 60 * 60 * 1000) + (minutes * 60 * 1000); // Convert to milliseconds
// }

// function setReminder(client, number, message, time) {
//     const delay = parseTimeString(time);

//     setTimeout(() => {
//         client.sendMessage(`${number}@c.us`, message);
//         console.log(`Reminder sent to ${number}: ${message}`);
//     }, delay);
// }

// async function generateResponse(openai, userQuery, knowledgeBase) {
//     const prompt = `KnowledgeBase:\n${knowledgeBase}\n\nUsegit r Query: ${userQuery}\n\nResponse:`;

//     const response = await openai.chat.completions.create({
//         model: 'gpt-4o-mini',
//         messages: [{ role: 'user', content: prompt }],
//     });

//     return response.choices[0].message.content.trim();
// }

// function addModerator(number) {
//     moderators.add(number);
// }

// function removeModerator(number) {
//     moderators.delete(number);
// }

// function isModerator(number) {
//     return moderators.has(number);
// }

// function checkModerators() {
//     return Array.from(moderators);
// }

// function updateUserMessageHistory(senderNumber, message) {
//     if (!userMessageHistory[senderNumber]) {
//         userMessageHistory[senderNumber] = [];
//     }
//     userMessageHistory[senderNumber].push(message);
//     if (userMessageHistory[senderNumber].length > 5) {
//         userMessageHistory[senderNumber].shift(); // Keep only the last 5 messages
//     }
// }

// async function generateResponseWithHistory(openai, senderNumber, knowledgeBase) {
//     const conversationHistory = userMessageHistory[senderNumber].join('\n');
//     const prompt = `KnowledgeBase:\n${knowledgeBase}\n\nConversation History:\n${conversationHistory}\n\nResponse:`;

//     const response = await openai.chat.completions.create({
//         model: 'gpt-4o-mini',
//         messages: [{ role: 'user', content: prompt }],
//     });

//     return response.choices[0].message.content.trim();
// }

// function handleCommand(client, openai, message, senderNumber, isAdmin, isModerator) {
//     const messageText = message.body.toLowerCase();
//     updateUserMessageHistory(senderNumber, message.body); // Update message history

//     if (messageText.startsWith('!!')) {
//         if (isAdmin || isModerator) {
//             switch (true) {
//                 case messageText.startsWith('!!remind'):
//                     const parts = message.body.split('"');
//                     if (parts.length === 7) {
//                         const targetNumber = parts[1];
//                         const reminderMessage = parts[3];
//                         const time = parts[5];
//                         setReminder(client, targetNumber, reminderMessage, time);
//                     } else {
//                         message.reply('Incorrect format. Please use !!remind "number" "message" "x:y" (e.g., !!remind "923467467086" "Please pay your due." "00:01").');
//                     }
//                     break;

//                 case messageText.startsWith('!!knowledgebase'):
//                     const kbName = message.body.split('"')[1];
//                     if (kbName) {
//                         if (loadKnowledgeBase(kbName)) {
//                             message.reply(`Switched to knowledge base "${kbName}".`);
//                         } else {
//                             message.reply(`Knowledge base "${kbName}" does not exist.`);
//                         }
//                     } else {
//                         message.reply('Please specify the knowledge base name like !!knowledgebase "name".');
//                     }
//                     break;

//                 case messageText.startsWith('!!ping'):
//                     const targetNumberPing = message.body.split('"')[1];
//                     if (targetNumberPing) {
//                         startPinging(client, targetNumberPing);
//                         message.reply(`Started pinging ${targetNumberPing}.`);
//                     } else {
//                         message.reply('Please specify the number to ping like !!ping "number".');
//                     }
//                     break;

//                 case messageText.startsWith('!!stop-ping'):
//                     const targetNumberPingStop = message.body.split('"')[1];
//                     if (targetNumberPingStop) {
//                         stopPinging(targetNumberPingStop);
//                         message.reply(`Stopped pinging ${targetNumberPingStop}.`);
//                     } else {
//                         message.reply('Please specify the number to stop pinging like !!stop-ping "number".');
//                     }
//                     break;

//                 case isAdmin && messageText.startsWith('!!addmoderator'):
//                     const newModerator = message.body.split('"')[1];
//                     if (newModerator) {
//                         addModerator(newModerator);
//                         message.reply(`${newModerator} is now a moderator.`);
//                     } else {
//                         message.reply('Please specify the number to add as a moderator like !!addmoderator "number".');
//                     }
//                     break;

//                 case isAdmin && messageText.startsWith('!!removemoderator'):
//                     const moderatorToRemove = message.body.split('"')[1];
//                     if (moderatorToRemove) {
//                         removeModerator(moderatorToRemove);
//                         message.reply(`${moderatorToRemove} is no longer a moderator.`);
//                     } else {
//                         message.reply('Please specify the number to remove as a moderator like !!removemoderator "number".');
//                     }
//                     break;

//                 case isAdmin && messageText.startsWith('!!checkmoderators'):
//                     const moderatorsList = checkModerators();
//                     message.reply(`Current moderators are: ${moderatorsList.join(', ')}`);
//                     break;

//                 case isAdmin && messageText.startsWith('!!kbadd'):
//                     message.reply('Please attach the knowledge base file with the command.');
//                     break;

//                 case isAdmin && messageText.startsWith('!!deletekb'):
//                     const kbNameToDelete = message.body.split(' ')[1];
//                     if (kbNameToDelete) {
//                         message.reply(`Attempting to delete ${kbNameToDelete}.txt...`);
//                     } else {
//                         message.reply('Please specify the name of the knowledge base file to delete. Usage: !!deletekb [filename]');
//                     }
//                     break;

//                 case isAdmin && messageText.startsWith('!!listkb'):
//                     message.reply('Listing all knowledge base files...');
//                     break;

//                 case messageText.startsWith('!!menu'):
//                     message.reply(showMenu(isAdmin));
//                     break;

//                 default:
//                     message.reply("Unknown command. Please check the available commands using !!menu.");
//                     break;
//             }
//         } else {
//             message.reply("You don't have permission to use commands.");
//         }
//     } else {
//         generateResponseWithHistory(openai, senderNumber, knowledgeBase).then(reply => {
//             message.reply(reply);
//         }).catch(error => {
//             console.error('Error while processing the message:', error);
//             message.reply("Sorry, something went wrong while processing your request.");
//         });
//     }
// }

// function showMenu(isAdmin) {
//     if (isAdmin) {
//         return `
//         *Commands Menu (Admin):*
//         - !!start  For starting bot
//         - !!pause  For pausing bot
//         - !!ping "number": Start pinging the specified number every 240 seconds
//         - !!stop-ping "number": Stop pinging the specified number
//         - !!menu: Show this command menu
//         - !!remind "number" "message" "x:y": Set a reminder for the specified number
//         - !!knowledgebase "name": Switch to the specified knowledge base
//         - !!checkmoderators: List all current moderators
//         - !!addmoderator "number": Add a moderator (Admin only)
//         - !!removemoderator "number": Remove a moderator (Admin only)
//         - !!kbadd "filename": Add a new knowledge base file (Admin only)
//         - !!deletekb "filename": Delete a knowledge base file (Admin only)
//         - !!listkb: List all knowledge base files (Admin only)
//         `;
//     } else {
//         return `
//         *Commands Menu (Moderator):*
//         - !!start  For starting bot
//         - !!pause  For pausing bot
//         - !!ping "number": Start pinging the specified number every 240 seconds
//         - !!stop-ping "number": Stop pinging the specified number
//         - !!menu: Show this command menu
//         - !!remind "number" "message" "x:y": Set a reminder for the specified number
//         - !!knowledgebase "name": Switch to the specified knowledge base
//         `;
//     }
// }

// // Export the functions to be used in index.js
// module.exports = {
//     loadKnowledgeBase,
//     startPinging,
//     stopPinging,
//     showMenu,
//     parseTimeString,
//     setReminder,
//     generateResponse,
//     addModerator,
//     removeModerator,
//     isModerator,
//     checkModerators,
//     handleCommand,
//     moderators
// };

































//Olders------------------------------------------------------------------------------------




// const fs = require('fs');

// let knowledgeBase = ''; // Variable to store the knowledge base content
// let currentKnowledgeBase = 'default'; // Track the current knowledge base in use
// const pingIntervals = {}; // Store ping intervals per number
// const moderators = new Set(); // Set to store moderators

// function loadKnowledgeBase(kbName) {
//     const kbFilePath = `${kbName}.txt`;
//     if (fs.existsSync(kbFilePath)) {
//         knowledgeBase = fs.readFileSync(kbFilePath, 'utf8');
//         currentKnowledgeBase = kbName;
//         console.log(`Loaded knowledge base from ${kbFilePath}`);
//         return true;
//     } else {
//         console.error(`Knowledge base file "${kbFilePath}" not found!`);
//         return false;
//     }
// }

// // Load the default knowledge base at module initialization
// loadKnowledgeBase(currentKnowledgeBase);

// function startPinging(client, number) {
//     const fullNumber = `${number}@c.us`;
//     if (!pingIntervals[fullNumber]) {
//         pingIntervals[fullNumber] = setInterval(() => {
//             client.sendMessage(fullNumber, 'Pinging');
//             console.log(`Sent "Pinging" to ${fullNumber}`);
//         }, 240000); // 240 seconds = 4 minutes
//         console.log(`Started pinging ${fullNumber}`);
//     } else {
//         console.log(`Pinging already active for ${fullNumber}`);
//     }
// }

// function stopPinging(number) {
//     const fullNumber = `${number}@c.us`; // Format the number correctly
//     if (pingIntervals[fullNumber]) {
//         clearInterval(pingIntervals[fullNumber]); // Clear the interval
//         delete pingIntervals[fullNumber]; // Remove the interval from the object
//         console.log(`Stopped pinging ${fullNumber}`);
//     } else {
//         console.log(`No active pinging found for ${fullNumber}`);
//     }
// }

// function parseTimeString(timeString) {
//     const [hours, minutes] = timeString.split(':').map(Number);
//     return (hours * 60 * 60 * 1000) + (minutes * 60 * 1000); // Convert to milliseconds
// }

// function setReminder(client, number, message, time) {
//     const delay = parseTimeString(time);

//     setTimeout(() => {
//         client.sendMessage(`${number}@c.us`, message);
//         console.log(`Reminder sent to ${number}: ${message}`);
//     }, delay);
// }

// async function generateResponse(openai, userQuery, knowledgeBase) {
//     const prompt = `KnowledgeBase:\n${knowledgeBase}\n\nUser Query: ${userQuery}\n\nResponse:`;

//     const response = await openai.chat.completions.create({
//         model: 'gpt-4o-mini',
//         messages: [{ role: 'user', content: prompt }],
//     });

//     return response.choices[0].message.content.trim();
// }

// function addModerator(number) {
//     moderators.add(number);
// }

// function removeModerator(number) {
//     moderators.delete(number);
// }

// function isModerator(number) {
//     return moderators.has(number);
// }

// function checkModerators() {
//     return Array.from(moderators);
// }




// function handleCommand(client, openai, message, senderNumber, isAdmin, isModerator) {
//     const messageText = message.body.toLowerCase();

//     if (messageText.startsWith('!!')) {
//         if (isAdmin || isModerator) {
//             switch (true) {
//                 case messageText.startsWith('!!remind'):
//                     const parts = message.body.split('"');
//                     if (parts.length === 7) {
//                         const targetNumber = parts[1];
//                         const reminderMessage = parts[3];
//                         const time = parts[5];
//                         setReminder(client, targetNumber, reminderMessage, time);
//                     } else {
//                         message.reply('Incorrect format. Please use !!remind "number" "message" "x:y" (e.g., !!remind "923467467086" "Please pay your due." "00:01").');
//                     }
//                     break;

//                 case messageText.startsWith('!!knowledgebase'):
//                     const kbName = message.body.split('"')[1];
//                     if (kbName) {
//                         if (loadKnowledgeBase(kbName)) {
//                             message.reply(`Switched to knowledge base "${kbName}".`);
//                         } else {
//                             message.reply(`Knowledge base "${kbName}" does not exist.`);
//                         }
//                     } else {
//                         message.reply('Please specify the knowledge base name like !!knowledgebase "name".');
//                     }
//                     break;

//                 case messageText.startsWith('!!ping'):
//                     const targetNumberPing = message.body.split('"')[1];
//                     if (targetNumberPing) {
//                         startPinging(client, targetNumberPing);
//                         message.reply(`Started pinging ${targetNumberPing}.`);
//                     } else {
//                         message.reply('Please specify the number to ping like !!ping "number".');
//                     }
//                     break;

//                 case messageText.startsWith('!!stop-ping'):
//                     const targetNumberPingStop = message.body.split('"')[1];
//                     if (targetNumberPingStop) {
//                         stopPinging(targetNumberPingStop);
//                         message.reply(`Stopped pinging ${targetNumberPingStop}.`);
//                     } else {
//                         message.reply('Please specify the number to stop pinging like !!stop-ping "number".');
//                     }
//                     break;

//                 case isAdmin && messageText.startsWith('!!addmoderator'):
//                     const newModerator = message.body.split('"')[1];
//                     if (newModerator) {
//                         addModerator(newModerator);
//                         message.reply(`${newModerator} is now a moderator.`);
//                     } else {
//                         message.reply('Please specify the number to add as a moderator like !!addmoderator "number".');
//                     }
//                     break;

//                 case isAdmin && messageText.startsWith('!!removemoderator'):
//                     const moderatorToRemove = message.body.split('"')[1];
//                     if (moderatorToRemove) {
//                         removeModerator(moderatorToRemove);
//                         message.reply(`${moderatorToRemove} is no longer a moderator.`);
//                     } else {
//                         message.reply('Please specify the number to remove as a moderator like !!removemoderator "number".');
//                     }
//                     break;

//                 case isAdmin && messageText.startsWith('!!checkmoderators'):
//                     const moderatorsList = checkModerators();
//                     message.reply(`Current moderators are: ${moderatorsList.join(', ')}`);
//                     break;

//                 case isAdmin && messageText.startsWith('!!kbadd'):
//                     message.reply('Please attach the knowledge base file with the command.');
//                     break;

//                 case isAdmin && messageText.startsWith('!!deletekb'):
//                     const kbNameToDelete = message.body.split(' ')[1];
//                     if (kbNameToDelete) {
//                         message.reply(`Attempting to delete ${kbNameToDelete}.txt...`);
//                     } else {
//                         message.reply('Please specify the name of the knowledge base file to delete. Usage: !!deletekb [filename]');
//                     }
//                     break;

//                 case isAdmin && messageText.startsWith('!!listkb'):
//                     message.reply('Listing all knowledge base files...');
//                     break;

//                 case messageText.startsWith('!!menu'):
//                     message.reply(showMenu(isAdmin));
//                     break;

//                 default:
//                     message.reply("Unknown command. Please check the available commands using !!menu.");
//                     break;
//             }
//         } else {
//             message.reply("You don't have permission to use commands.");
//         }
//     } else {
//         const userQuery = message.body.toLowerCase();
//         generateResponse(openai, userQuery, knowledgeBase).then(reply => {
//             message.reply(reply);
//         }).catch(error => {
//             console.error('Error while processing the message:', error);
//             message.reply("Sorry, something went wrong while processing your request.");
//         });
//     }
// }

// function showMenu(isAdmin) {
//     if (isAdmin) {
//         return `
//         *Commands Menu (Admin):*
//         - !!start  For starting bot
//         - !!pause  For pausing bot
//         - !!ping "number": Start pinging the specified number every 240 seconds
//         - !!stop-ping "number": Stop pinging the specified number
//         - !!menu: Show this command menu
//         - !!remind "number" "message" "x:y": Set a reminder for the specified number
//         - !!knowledgebase "name": Switch to the specified knowledge base
//         - !!checkmoderators: List all current moderators
//         - !!addmoderator "number": Add a moderator (Admin only)
//         - !!removemoderator "number": Remove a moderator (Admin only)
//         - !!kbadd "filename": Add a new knowledge base file (Admin only)
//         - !!deletekb "filename": Delete a knowledge base file (Admin only)
//         - !!listkb: List all knowledge base files (Admin only)
//         `;
//     } else {
//         return `
//         *Commands Menu (Moderator):*
//         - !!start  For starting bot
//         - !!pause  For pausing bot
//         - !!ping "number": Start pinging the specified number every 240 seconds
//         - !!stop-ping "number": Stop pinging the specified number
//         - !!menu: Show this command menu
//         - !!remind "number" "message" "x:y": Set a reminder for the specified number
//         - !!knowledgebase "name": Switch to the specified knowledge base
//         `;
//     }
// }




// // Export the functions to be used in index.js
// module.exports = {
//     loadKnowledgeBase,
//     startPinging,
//     stopPinging,
//     showMenu,
//     parseTimeString,
//     setReminder,
//     generateResponse,
//     addModerator,
//     removeModerator,
//     isModerator,
//     checkModerators,
//     handleCommand,
//     moderators
// };
