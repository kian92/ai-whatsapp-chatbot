const POLLING_INTERVAL = 1000;
const MAX_RETRIES = 60;
const userMessageCounts = {};
let NO_LIMIT = false;
const pingIntervals = {};
const moderators = new Set(['923261467086']); // Add any default moderator numbers here
const reminders = {};
const ignoreList = new Set();
let assistantKey = 'asst_6xFy9UjYJsmSbPiKqmI5TPee';
const userThreads = {};
const DEFAULT_MESSAGE_LIMIT = 100; // Added default message limit


async function sendMessageWithValidation(client, number, message, senderNumber) {
    try {
        const formattedNumber = `${number}@c.us`;

        // Attempt to send the message
        await client.sendMessage(formattedNumber, message);
        await client.sendMessage(`${senderNumber}@c.us`, `Message sent successfully to ${number}`);

    } catch (error) {
        console.error(`Failed to send message to ${number}: ${error.message}`);

        // Send an error message back to the sender, but ensure it's a safe operation
        try {
            await client.sendMessage(`${senderNumber}@c.us`, `Failed to send message to ${number}: ${error.message}`);
        } catch (secondaryError) {
            console.error(`Failed to notify the sender about the failure: ${secondaryError.message}`);
        }
    }
}

function checkMessageLimit(senderNumber, isAdmin) {
    try {
        if (NO_LIMIT || isAdmin || isModerator(senderNumber)) return true;
        
        // Initialize user data if it doesn't exist
        if (!userMessageCounts[senderNumber]) {
            userMessageCounts[senderNumber] = { 
                count: 0, 
                firstMessageTime: Date.now(), 
                maxLimit: DEFAULT_MESSAGE_LIMIT 
            };
        }

        const userLimit = userMessageCounts[senderNumber].maxLimit;
        return userMessageCounts[senderNumber].count < userLimit;
    } catch (error) {
        console.error(`Error in checkMessageLimit: ${error.message}`);
        return false;
    }
}
function trackUserMessage(senderNumber) {
    try {
        const currentTime = Date.now();
        
        // Ensure userMessageCounts for this user is initialized
        if (!userMessageCounts[senderNumber]) {
            userMessageCounts[senderNumber] = { 
                count: 0, 
                firstMessageTime: currentTime, 
                maxLimit: DEFAULT_MESSAGE_LIMIT 
            };
        }

        // Calculate the time difference
        const timeDiff = currentTime - userMessageCounts[senderNumber].firstMessageTime;

        // If 24 hours have passed, reset the message count and update the firstMessageTime
        if (timeDiff > 24 * 60 * 60 * 1000) {
            userMessageCounts[senderNumber].count = 0;
            userMessageCounts[senderNumber].firstMessageTime = currentTime;
        }

        // Increment the message count
        userMessageCounts[senderNumber].count += 1;

        // Print the number of messages the user has sent in the last 24 hours
        // console.log(`User ${senderNumber} has sent ${userMessageCounts[senderNumber].count} messages in the last 24 hours. Message limit: ${userMessageCounts[senderNumber].maxLimit}`);
    } catch (error) {
        console.error(`Error in trackUserMessage: ${error.message}`);
    }
}

async function startPinging(client, number) {
    try {
        if (!number) {
            throw new Error('Invalid number for pinging.');
        }

        const fullNumber = `${number}@c.us`;
        await client.isRegisteredUser(fullNumber); // Validate the number before pinging

        if (!pingIntervals[fullNumber]) {
            pingIntervals[fullNumber] = setInterval(() => {
                client.sendMessage(fullNumber, 'Pinging').catch(err => console.error(`Failed to send ping to ${fullNumber}: ${err.message}`));
            }, 240000);
        }
    } catch (error) {
        console.error(`Error in startPinging: ${error.message}`);
    }
}

function stopPinging(number) {
    try {
        if (!number) {
            throw new Error('Invalid number to stop pinging.');
        }
        const fullNumber = `${number}@c.us`;
        if (pingIntervals[fullNumber]) {
            clearInterval(pingIntervals[fullNumber]);
            delete pingIntervals[fullNumber];
        }
    } catch (error) {
        console.error(`Error in stopPinging: ${error.message}`);
    }
}

function parseTimeString(timeString) {
    try {
        const [days, hours, minutes, seconds] = timeString.split(':').map(Number);
        if (isNaN(days) || isNaN(hours) || isNaN(minutes) || isNaN(seconds)) {
            throw new Error('Invalid time format.');
        }
        return (days * 24 * 60 * 60 * 1000) + (hours * 60 * 60 * 1000) + (minutes * 60 * 1000) + (seconds * 1000);
    } catch (error) {
        console.error(`Error in parseTimeString: ${error.message}`);
        return 0;
    }
}

function setReminder(client, number, message, time) {
    try {
        if (!number || !message || !time) {
            throw new Error('Invalid input for setting reminder.');
        }
        const delay = parseTimeString(time);
        const reminderKey = `${number}-${message}-${time}`;

        reminders[reminderKey] = setTimeout(() => {
            client.sendMessage(`${number}@c.us`, message)
                .then(() => { })
                .catch((err) => {
                    client.sendMessage(adminNumber, `Failed to send reminder to ${number}: ${err.message}`);
                });
            delete reminders[reminderKey];
        }, delay);
    } catch (error) {
        console.error(`Error in setReminder: ${error.message}`);
        client.sendMessage(adminNumber, `Failed to set reminder for ${number}: ${error.message}`);
    }
}

function cancelReminder(client, number) {
    try {
        if (!number) {
            throw new Error('Invalid number to cancel reminder.');
        }
        const reminderKeys = Object.keys(reminders).filter(key => key.startsWith(`${number}-`));
        if (reminderKeys.length > 0) {
            reminderKeys.forEach(reminderKey => {
                clearTimeout(reminders[reminderKey]);
                delete reminders[reminderKey];
            });
            return true;
        }
        return false;
    } catch (error) {
        console.error(`Error in cancelReminder: ${error.message}`);
        return false;
    }
}

function clearAllThreads() {
    try {
        for (let user in userThreads) {
            delete userThreads[user];
        }
    } catch (error) {
        console.error(`Error in clearAllThreads: ${error.message}`);
    }
}

async function generateResponseOpenAI(assistant, senderNumber, userMessage) {
    try {
        if (!userMessage) {
            throw new Error('Empty message received.');
        }

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
            assistant_id: assistantKey // Use the latest assistant key here
        });

        await pollRunStatus(assistant, threadId, run.id);

        const messageResponse = await assistant.beta.threads.messages.list(threadId);
        const messages = messageResponse.data;
        const latestMessage = messages[0];

        return latestMessage.content[0].text.value.trim();
    } catch (error) {
        console.error(`Error in generateResponseOpenAI: ${error.message}`);
        return "Sorry, something went wrong while processing your request.";
    }
}

async function pollRunStatus(client, threadId, runId) {
    let retries = 0;
    while (retries < MAX_RETRIES) {
        try {
            const run = await client.beta.threads.runs.retrieve(threadId, runId);
            if (run.status === "completed") {
                return;
            } else if (run.status === "failed" || run.status === "cancelled") {
                throw new Error(`Run ${runId} ${run.status}`);
            }
            await sleep(POLLING_INTERVAL);
            retries++;
        } catch (error) {
            console.error(`Error polling run status: ${error.message}`);
            throw new Error(`Error polling run status: ${error.message}`);
        }
    }
    throw new Error(`Run ${runId} timed out after ${MAX_RETRIES} attempts`);
}

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

function addModerator(number) {
    try {
        if (!number) {
            throw new Error('Invalid number to add as moderator.');
        }
        moderators.add(number);
    } catch (error) {
        console.error(`Error in addModerator: ${error.message}`);
    }
}

function removeModerator(number) {
    try {
        if (!number) {
            throw new Error('Invalid number to remove as moderator.');
        }
        moderators.delete(number);
    } catch (error) {
        console.error(`Error in removeModerator: ${error.message}`);
    }
}

function isModerator(number) {
    try {
        if (!number) {
            throw new Error('Invalid number to check moderator status.');
        }
        return moderators.has(number);
    } catch (error) {
        console.error(`Error in isModerator: ${error.message}`);
        return false;
    }
}

function checkModerators() {
    try {
        return Array.from(moderators);
    } catch (error) {
        console.error(`Error in checkModerators: ${error.message}`);
        return [];
    }
}

function hasPermission(senderNumber, command, isAdmin, isModerator) {
    const unrestrictedCommands = ['!!un-sub', '!!live-chat', '!!sub', '!!bot'];
    if (unrestrictedCommands.includes(command)) {
        return true;
    }
    if (isAdmin || isModerator) {
        return true;
    }
    return false;
}

async function handleCommand(client, assistantOrOpenAI, message, senderNumber, isAdmin, isModerator) {
    try {
        // Extract the assistant key without converting to lowercase
        let messageText = message.body.trim();
        const [command, ...args] = messageText.split(' ');

        // Convert only the command to lowercase, keep assistant key as it is
        const lowerCommand = command.toLowerCase();

        if (ignoreList.has(senderNumber) && lowerCommand !== '!!sub' && lowerCommand !== '!!bot') {
            return;
        }

        if (lowerCommand.startsWith('!!')) {
            if (lowerCommand === '!!show-menu') {
                // Allow all users to access the show-menu command
                message.reply(showMenu(isAdmin, isModerator));
            } else if (hasPermission(senderNumber, lowerCommand, isAdmin, isModerator)) {
                switch (lowerCommand) {
                    case '!!set-key':
                        const newAssistantKey = extractQuotedString(args.join(' '));
                        if (newAssistantKey) {
                            assistantKey = newAssistantKey;
                            message.reply('Assistant key has been updated.');
                        } else {
                            message.reply('Please provide a valid assistant key using !!set-key "YourKey".');
                        }
                        break;


                    case '!!set-reminder':
                        const [number, remindMessage, time] = extractMultipleQuotedStrings(args.join(' '));
                        if (number && remindMessage && time) {
                            setReminder(client, number, remindMessage, time);
                            message.reply(`Reminder set for ${number} with message: "${remindMessage}" in ${time}.`);
                        } else {
                            message.reply('Please use the correct format: !!set-reminder "number" "message" "days:hours:minutes:seconds".');
                        }
                        break;

                    case '!!cancel-reminder':
                        const cancelNumber = extractQuotedString(args.join(' '));
                        if (cancelNumber) {
                            const cancelSuccess = cancelReminder(client, cancelNumber);
                            message.reply(cancelSuccess ? `All reminders for ${cancelNumber} have been canceled.` : `No reminders found for ${cancelNumber}.`);
                        } else {
                            message.reply('Please provide the number to cancel reminders for: !!cancel-reminder "number".');
                        }
                        break;

                    case '!!ping':
                        const targetNumberPing = extractQuotedString(args.join(' '));
                        if (targetNumberPing) {
                            await startPinging(client, targetNumberPing);
                            message.reply(`Started pinging ${targetNumberPing}.`);
                        } else {
                            message.reply('Please specify the number to ping: !!ping "number".');
                        }
                        break;

                    case '!!stop-ping':
                        const targetNumberPingStop = extractQuotedString(args.join(' '));
                        if (targetNumberPingStop) {
                            stopPinging(targetNumberPingStop);
                            message.reply(`Stopped pinging ${targetNumberPingStop}.`);
                        } else {
                            message.reply('Please specify the number to stop pinging: !!stop-ping "number".');
                        }
                        break;

                    case '!!add-mod':
                        const newModerator = extractQuotedString(args.join(' '));
                        if (newModerator) {
                            addModerator(newModerator);
                            message.reply(`${newModerator} is now a moderator.`);
                        } else {
                            message.reply('Please specify the number to add as a moderator: !!add-mod "number".');
                        }
                        break;

                    case '!!remove-mod':
                        const moderatorToRemove = extractQuotedString(args.join(' '));
                        if (moderatorToRemove) {
                            removeModerator(moderatorToRemove);
                            message.reply(`${moderatorToRemove} is no longer a moderator.`);
                        } else {
                            message.reply('Please specify the number to remove as a moderator: !!remove-mod "number".');
                        }
                        break;

                    case '!!list-mods':
                        const moderatorsList = checkModerators();
                        message.reply(`Current moderators are: ${moderatorsList.join(', ')}`);
                        break;

                    case '!!set-limit':
                        const [targetNumber, newLimit] = extractMultipleQuotedStrings(args.join(' '));
                        if (targetNumber && newLimit) {
                            setUserMessageLimit(targetNumber, parseInt(newLimit, 10));
                            message.reply(`Message limit for ${targetNumber} has been set to ${newLimit}.`);
                        } else {
                            message.reply('Please use the correct format: !!set-limit "number" "limit".');
                        }
                        break;

                    case '!!remove-limit':
                        NO_LIMIT = true;
                        message.reply('Message limit has been removed for all users.');
                        break;

                    case '!!enforce-limit':
                        NO_LIMIT = false;
                        resetUserMessageLimits();
                        message.reply('Message limit has been enforced for all users.');
                        break;

                    case '!!clear-threads':
                        clearAllThreads();
                        message.reply('All threads have been cleared.');
                        break;

                    case '!!show-menu':
                        if (isAdmin) {
                            message.reply(showMenu(true, false)); // Admin menu
                        } else if (isModerator) {
                            message.reply(showMenu(false, true)); // Moderator menu
                        } else {
                            message.reply(showMenu(false, false)); // User menu
                        }
                        break;


                    case '!!un-sub':
                    case '!!live-chat':
                        ignoreList.add(senderNumber);
                        message.reply('You have been unsubscribed from receiving messages from this Ai Assistant.\n- Use !!sub or !!bot to Subscribe Ai Assistant again.');
                        break;

                    case '!!sub':
                    case '!!bot':
                        ignoreList.delete(senderNumber);
                        message.reply('You have been re-subscribed to receive messages from this Ai Assistant.\n- Use !!live-chat or !!un-sub to  UnSubscribe Ai Assistant');
                        break;

                    default:
                        message.reply("Unknown command. Please check the available commands using !!show-menu.");
                        break;
                }
            } else {
                message.reply("You don't have permission to use this command.");
            }
        } else {
            if (!ignoreList.has(senderNumber) && checkMessageLimit(senderNumber, isAdmin)) {
                trackUserMessage(senderNumber);
                generateResponseOpenAI(assistantOrOpenAI, senderNumber, message.body).then(reply => {
                    message.reply(reply);
                }).catch(error => {
                    console.error(`Error in generating response: ${error.message}`);
                    message.reply("Sorry, something went wrong while processing your request.");
                });
            } else if (!ignoreList.has(senderNumber)) {
                message.reply(`Your message limit for today has been reached.\n- Please try again tomorrow or contact an admin to reset your limit.`);
            }
        }
    } catch (error) {
        console.error(`Error in handleCommand: ${error.message}`);
        message.reply("An error occurred while processing your command. Please check your input and try again.");
    }
}

function extractQuotedString(text) {
    try {
        const match = text.match(/"([^"]+)"/);
        return match ? match[1] : null;
    } catch (error) {
        console.error(`Error in extractQuotedString: ${error.message}`);
        return null;
    }
}

function extractMultipleQuotedStrings(text) {
    try {
        const matches = [...text.matchAll(/"([^"]+)"/g)];
        return matches.map(match => match[1]);
    } catch (error) {
        console.error(`Error in extractMultipleQuotedStrings: ${error.message}`);
        return [];
    }
}

function setUserMessageLimit(number, limit) {
    try {
        if (!number || isNaN(limit)) {
            throw new Error('Invalid input for setting message limit.');
        }
        if (!userMessageCounts[number]) {
            userMessageCounts[number] = { 
                count: 0, 
                firstMessageTime: Date.now(), 
                maxLimit: limit 
            };
        } else {
            userMessageCounts[number].maxLimit = limit;
        }
    } catch (error) {
        console.error(`Error in setUserMessageLimit: ${error.message}`);
    }
}

function resetUserMessageLimits() {
    try {
        for (let user in userMessageCounts) {
            userMessageCounts[user].maxLimit = DEFAULT_MESSAGE_LIMIT;
        }
    } catch (error) {
        console.error(`Error in resetUserMessageLimits: ${error.message}`);
    }
}

function showMenu(isAdmin, isModerator) {
    try {
        if (isAdmin) {
            return `
*Commands Menu (Admin):*
- !!set-key: Update the assistant key
- !!set-reminder: Set a reminder message
- !!cancel-reminder: Cancel a specific reminder
- !!ping: Start pinging a number
- !!stop-ping: Stop pinging a number
- !!add-mod: Add a moderator
- !!remove-mod: Remove a moderator
- !!list-mods: List all current moderators
- !!set-limit: Set a message limit for a user
- !!remove-limit: Remove message limits for all users
- !!enforce-limit: Reinstate message limits for all users
- !!clear-threads: Clear all threads
- !!un-sub: Unsubscribe from receiving messages
- !!sub: Resubscribe to receive messages
- !!show-menu: Show the command menu
- !!start: Start the bot
- !!stop: Stop the bot
            `;
        } else if (isModerator) {
            return `
*Commands Menu (Moderator):*
- !!set-reminder: Set a reminder message
- !!cancel-reminder: Cancel a specific reminder
- !!ping: Start pinging a number
- !!stop-ping: Stop pinging a number
- !!un-sub: Unsubscribe from receiving messages
- !!sub: Resubscribe to receive messages
- !!show-menu: Show the command menu
- !!start: Start the bot
- !!stop: Stop the bot
            `;
        } else {
            return `
*Commands Menu (User):*
- !!un-sub: Unsubscribe from receiving Ai Assistant messages
- !!live-chat: Unsubscribe from Ai Assistant receiving messages (same as !!un-sub)
- !!sub: Resubscribe to receive Ai Assistant messages
- !!bot: Resubscribe to receive Ai Assistant messages (same as !!sub)
- !!show-menu: Show the command menu
            `;
        }
    } catch (error) {
        console.error(`Error in showMenu: ${error.message}`);
        return "Sorry, unable to display the menu at this time.";
    }
}

module.exports = {
    startPinging,
    stopPinging,
    showMenu,
    parseTimeString,
    setReminder,
    generateResponseOpenAI,
    addModerator,
    removeModerator,
    isModerator,
    checkModerators,
    handleCommand,
    sleep,
    clearAllThreads,
    trackUserMessage,
    checkMessageLimit
};












//LEGACY MODE --- HAS BOTH CODE MODE AND OPENAI MODE


// const fs = require('fs');

// // Constants
// const POLLING_INTERVAL = 1000;
// const MAX_RETRIES = 60;
// const userMessageCounts = {}; // Store message counts and timestamps for users
// let NO_LIMIT = false; // Flag to remove the message limit for all users
// // Variables shared across modes
// const pingIntervals = {};
// const moderators = new Set();
// const reminders = {}; // To keep track of reminders
// const activeAskOperations = {};

// let currentMode = 'code'; // Default mode is 'openai'

// // Variables specific to openai mode
// let assistantKey = 'asst_6xFy9UjYJsmSbPiKqmI5TPee';
// const userThreads = {};

// // Variables specific to code mode
// let knowledgeBase = '';
// let currentKnowledgeBase = 'default';
// const userMessageHistory = {};

// // Load the default knowledge base at module initialization for code mode
// loadKnowledgeBase(currentKnowledgeBase);

// function handleAsk(client, numbers, message, interval, senderNumber) {
//     const numberArray = numbers.split(',').map(num => num.trim());
//     const delay = parseTimeString(interval);

//     numberArray.forEach((number, index) => {
//         const formattedNumber = `${number}@c.us`;

//         // Schedule the message
//         activeAskOperations[number] = setTimeout(() => {
//             client.sendMessage(formattedNumber, message)
//                 .then(() => {
//                     console.log(`Message sent successfully to ${number}`);
//                     // Notify the bot (i.e., send the message to itself)
//                     client.sendMessage(`${senderNumber}@c.us`, `Message sent successfully to ${number}`);
//                 })
//                 .catch((err) => {
//                     console.error(`Failed to send message to ${number}:`, err);
//                     // Notify the bot (i.e., send the message to itself)
//                     client.sendMessage(`${senderNumber}@c.us`, `Failed to send message to ${number}: ${err.message}`);
//                 });
//             delete activeAskOperations[number]; // Clean up after sending
//         }, delay * index);
//     });
// }

// function cancelAskOperations(client) {
//     Object.keys(activeAskOperations).forEach((number) => {
//         clearTimeout(activeAskOperations[number]);
//         console.log(`Operation canceled for ${number}`);
//         client.sendMessage(adminNumber, `Operation canceled for ${number}`);
//     });
//     // Clear the active operations list
//     Object.keys(activeAskOperations).forEach(key => delete activeAskOperations[key]);
// }

// function checkMessageLimit(senderNumber, isAdmin) {
//     if (NO_LIMIT || isAdmin || isModerator(senderNumber)) return true; // Skip limit check for admins, moderators, or if no limit is applied

//     const userLimit = userMessageCounts[senderNumber]?.maxLimit || 100; // Default to 100 if not set
//     if (userMessageCounts[senderNumber]?.count >= userLimit) {
//         return false;
//     }
//     return true;
// }

// function trackUserMessage(senderNumber) {
//     const currentTime = Date.now();
//     if (!userMessageCounts[senderNumber]) {
//         userMessageCounts[senderNumber] = { count: 0, firstMessageTime: currentTime, maxLimit: 100 }; // Default max limit
//     }
//     const timeDiff = currentTime - userMessageCounts[senderNumber].firstMessageTime;

//     if (timeDiff > 24 * 60 * 60 * 1000) { // Reset after 24 hours
//         userMessageCounts[senderNumber] = { count: 0, firstMessageTime: currentTime, maxLimit: userMessageCounts[senderNumber].maxLimit };
//     }

//     userMessageCounts[senderNumber].count += 1;
// }

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
//     const fullNumber = `${number}@c.us`;
//     if (pingIntervals[fullNumber]) {
//         clearInterval(pingIntervals[fullNumber]);
//         delete pingIntervals[fullNumber];
//         console.log(`Stopped pinging ${fullNumber}`);
//     } else {
//         console.log(`No active pinging found for ${fullNumber}`);
//     }
// }

// function parseTimeString(timeString) {
//     const [days, hours, minutes, seconds] = timeString.split(':').map(Number);
//     return (days * 24 * 60 * 60 * 1000) + (hours * 60 * 60 * 1000) + (minutes * 60 * 1000) + (seconds * 1000);
// }

// function setReminder(client, number, message, time) {
//     const delay = parseTimeString(time);  // Using the updated parseTimeString function
//     const reminderKey = `${number}-${message}-${time}`;

//     reminders[reminderKey] = setTimeout(() => {
//         client.sendMessage(`${number}@c.us`, message)
//             .then(() => {
//                 console.log(`Reminder sent to ${number}: ${message}`);
//             })
//             .catch((err) => {
//                 console.error(`Failed to send reminder to ${number}:`, err);
//                 client.sendMessage(adminNumber, `Failed to send reminder to ${number}: ${err.message}`);
//             });
//         delete reminders[reminderKey];  // Clean up after sending the reminder
//     }, delay);

//     console.log(`Reminder set for ${number} in ${time} with message: "${message}".`);
// }

// function cancelReminder(client, number) {
//     const reminderKeys = Object.keys(reminders).filter(key => key.startsWith(`${number}-`));

//     if (reminderKeys.length > 0) {
//         reminderKeys.forEach(reminderKey => {
//             clearTimeout(reminders[reminderKey]);
//             delete reminders[reminderKey];
//         });
//         console.log(`All reminders for ${number} have been canceled.`);
//         return true;
//     } else {
//         console.log(`No reminders found for ${number}.`);
//         return false;
//     }
// }

// function clearAllThreads() {
//     for (let user in userThreads) {
//         delete userThreads[user];
//     }
//     console.log('All user threads have been cleared.');
// }

// async function generateResponseOpenAI(assistant, senderNumber, userMessage) {
//     let threadId;

//     if (userThreads[senderNumber]) {
//         threadId = userThreads[senderNumber];
//     } else {
//         const chat = await assistant.beta.threads.create();
//         threadId = chat.id;
//         userThreads[senderNumber] = threadId;
//     }

//     await assistant.beta.threads.messages.create(threadId, {
//         role: 'user',
//         content: userMessage
//     });

//     const run = await assistant.beta.threads.runs.create(threadId, {
//         assistant_id: assistantKey
//     });

//     await pollRunStatus(assistant, threadId, run.id);

//     const messageResponse = await assistant.beta.threads.messages.list(threadId);
//     const messages = messageResponse.data;
//     const latestMessage = messages[0];

//     return latestMessage.content[0].text.value.trim();
// }

// async function pollRunStatus(client, threadId, runId) {
//     let retries = 0;
//     while (retries < MAX_RETRIES) {
//         const run = await client.beta.threads.runs.retrieve(threadId, runId);
//         if (run.status === "completed") {
//             return;
//         } else if (run.status === "failed" || run.status === "cancelled") {
//             throw new Error(`Run ${runId} ${run.status}`);
//         }
//         await sleep(POLLING_INTERVAL);
//         retries++;
//     }
//     throw new Error(`Run ${runId} timed out`);
// }

// function sleep(ms) {
//     return new Promise(resolve => setTimeout(resolve, ms));
// }

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
// const knowledgeBaseCache = `${knowledgeBase}`;  // Cache the knowledge base if it's static

// async function generateResponseCode(openai, senderNumber) {
//     try {
//         const lastMessage = userMessageHistory[senderNumber]?.at(-1) || ''; // Get the last message only

//         const promptParts = [
//             `Detect the language and text format of the following message: '${lastMessage}'.`,
//             `Respond only in Urdu, Hindi, or English, using Roman script. Match the formality of the original message.`,
//             `Given the following knowledge base, reply to the last message only.`,
//             `Ensure your response is in the same language and text format as detected.`,
//             `Knowledge Base: ${knowledgeBaseCache}`,
//             `Last Message: ${lastMessage}`,
//             `Response:`
//         ];

//         const prompt = promptParts.join('\n\n');  // Combine the prompt parts

//         const response = await openai.chat.completions.create({
//             model: 'gpt-4o-mini',
//             messages: [{ role: 'system', content: prompt }],
//             temperature: 0.1,   // Lowered temperature for more deterministic responses
//             max_tokens: 100,    // Limit the response length to 100 tokens
//         });

//         return response.choices[0].message.content.trim();
//     } catch (error) {
//         console.error("Error generating response:", error);
//         return "Sorry, I'm unable to process your request right now.";
//     }
// }

// function updateUserMessageHistory(senderNumber, message) {
//     if (!userMessageHistory[senderNumber]) {
//         userMessageHistory[senderNumber] = [];
//     }
//     userMessageHistory[senderNumber].push(message);
//     if (userMessageHistory[senderNumber].length > 20) { // Keep only the last 20 messages
//         userMessageHistory[senderNumber].shift();
//     }
// }

// function addModerator(number) {
//     moderators.add(number);
//     console.log(`Added ${number} as moderator.`);
// }
// addModerator('923261467086');

// function removeModerator(number) {
//     moderators.delete(number);
//     console.log(`Removed ${number} from moderators.`);
// }

// function isModerator(number) {
//     return moderators.has(number);
// }

// function checkModerators() {
//     return Array.from(moderators);
// }

// function handleCommand(client, assistantOrOpenAI, message, senderNumber, isAdmin, isModerator) {
//     // Ensure message history is tracked
//     updateUserMessageHistory(senderNumber, message.body);

//     const messageText = message.body.toLowerCase();

//     if (messageText.startsWith('!!')) {
//         if (isAdmin || isModerator) {
//             switch (true) {
//                 case messageText.startsWith('!!ask'):
//                     const askParts = message.body.match(/"([^"]+)"/g);
//                     if (askParts && askParts.length === 3) {
//                         const numbers = askParts[0].replace(/"/g, '');
//                         const askMessage = askParts[1].replace(/"/g, '');
//                         const interval = askParts[2].replace(/"/g, '');
//                         handleAsk(client, numbers, askMessage, interval, senderNumber);
//                         message.reply(`Ask operation started for numbers: ${numbers}`);
//                     } else {
//                         message.reply('Incorrect format. Please use !!ask "number,number,number,..." "message" "00:00:00:00" (days:hours:minutes:seconds).');
//                     }
//                     break;

//                 case messageText.startsWith('!!not-ask'):
//                     cancelAskOperations(client);
//                     message.reply('All ask operations have been canceled.');
//                     break;

//                 case messageText.startsWith('!!remind'):
//                     const remindParts = message.body.match(/"([^"]+)"/g);
//                     if (remindParts && remindParts.length === 3) {
//                         const number = remindParts[0].replace(/"/g, '');
//                         const remindMessage = remindParts[1].replace(/"/g, '');
//                         const time = remindParts[2].replace(/"/g, '');
//                         setReminder(client, number, remindMessage, time);
//                         message.reply(`Reminder set for ${number} in ${time} with message: "${remindMessage}".`);
//                     } else {
//                         message.reply('Incorrect format. Please use !!remind "number" "message" "00:00:00:00" (days:hours:minutes:seconds).');
//                     }
//                     break;

//                 case messageText.startsWith('!!cancel-remind'):
//                     const cancelParts = message.body.split('"');
//                     if (cancelParts.length === 3) {
//                         const cancelNumber = cancelParts[1];
//                         const cancelSuccess = cancelReminder(client, cancelNumber);
//                         if (cancelSuccess) {
//                             message.reply(`All reminders for ${cancelNumber} have been canceled.`);
//                         } else {
//                             message.reply(`No reminders found for ${cancelNumber}.`);
//                         }
//                     } else {
//                         message.reply('Incorrect format. Please use !!cancel-remind "number".');
//                     }
//                     break;

//                 case isAdmin && messageText.startsWith('!!switch'):
//                     const newMode = message.body.split('"')[1];
//                     if (newMode === 'openai' || newMode === 'code') {
//                         currentMode = newMode;
//                         message.reply(`Switched to ${newMode} mode.`);
//                     } else {
//                         message.reply('Invalid mode. Use !!switch "openai" or "code".');
//                     }
//                     break;

//                 case currentMode === 'code' && isAdmin && messageText.startsWith('!!listkb'):
//                     fs.readdir('.', (err, files) => {
//                         if (err) {
//                             message.reply('Error reading directory.');
//                             console.error(err);
//                         } else {
//                             const kbFiles = files.filter(file => file.endsWith('.txt'));
//                             if (kbFiles.length > 0) {
//                                 message.reply(`Available knowledge base files:\n${kbFiles.join('\n')}`);
//                             } else {
//                                 message.reply('No knowledge base files found.');
//                             }
//                         }
//                     });
//                     break;

//                 case currentMode === 'openai' && isAdmin && messageText.startsWith('!!assist'):
//                     const newAssistantKey = message.body.split('"')[1];
//                     if (newAssistantKey) {
//                         assistantKey = newAssistantKey;
//                         message.reply('Assistant key has been updated.');
//                     } else {
//                         message.reply('Please provide a valid assistant key using !!assist "Key".');
//                     }
//                     break;

//                 case currentMode === 'openai' && isAdmin && messageText.startsWith('!!clear-assist'):
//                     clearAllThreads();
//                     message.reply('All threads have been cleared.');
//                     break;

//                 case currentMode === 'code' && isAdmin && messageText.startsWith('!!kbadd'):
//                     const customKbName = message.body.split(' ')[1];
//                     if (customKbName && message.hasMedia) {
//                         message.downloadMedia().then(media => {
//                             const kbFilePath = `./${customKbName}.txt`;

//                             fs.writeFileSync(kbFilePath, media.data, { encoding: 'base64' });
//                             message.reply(`Knowledge base "${customKbName}" has been added as ${customKbName}.txt.`);
//                         }).catch(err => {
//                             console.error('Error downloading media:', err);
//                             message.reply('Failed to download and save the knowledge base file.');
//                         });
//                     } else {
//                         message.reply('Please provide a custom name and attach the knowledge base file with the !!kbadd command.');
//                     }
//                     break;

//                 case currentMode === 'code' && isAdmin && messageText.startsWith('!!deletekb'):
//                     const kbNameToDelete = message.body.split(' ')[1];
//                     if (kbNameToDelete) {
//                         const kbFilePathToDelete = `./${kbNameToDelete}.txt`;
//                         if (fs.existsSync(kbFilePathToDelete)) {
//                             fs.unlink(kbFilePathToDelete, (err) => {
//                                 if (err) {
//                                     console.error(`Error deleting file "${kbNameToDelete}.txt":`, err);
//                                     message.reply(`Failed to delete ${kbNameToDelete}.txt. Please try again.`);
//                                 } else {
//                                     message.reply(`Knowledge base "${kbNameToDelete}.txt" has been successfully deleted.`);
//                                 }
//                             });
//                         } else {
//                             message.reply(`Knowledge base "${kbNameToDelete}.txt" does not exist.`);
//                         }
//                     } else {
//                         message.reply('Please specify the name of the knowledge base file to delete. Usage: !!deletekb [filename]');
//                     }
//                     break;

//                 case currentMode === 'code' && isAdmin && messageText.startsWith('!!knowledgebase'):
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

//                 case messageText.startsWith('!!menu'):
//                     message.reply(showMenu(isAdmin, currentMode));
//                     break;

//                 case isAdmin && messageText.startsWith('!!limit-reset'):
//                     const resetParts = message.body.split('"');
//                     const targetNumber = resetParts[1];
//                     const newLimit = parseInt(resetParts[3], 10);

//                     if (targetNumber && !isNaN(newLimit)) {
//                         if (!userMessageCounts[targetNumber]) {
//                             userMessageCounts[targetNumber] = { count: 0, firstMessageTime: Date.now(), maxLimit: newLimit };
//                         } else {
//                             userMessageCounts[targetNumber].maxLimit = newLimit;
//                         }
//                         message.reply(`Message limit for ${targetNumber} has been set to ${newLimit}.`);
//                     } else {
//                         message.reply('Incorrect format. Please use !!limit-reset "number" "amount of messages".');
//                     }
//                     break;

//                 case isAdmin && messageText.startsWith('!!no-limit'):
//                     NO_LIMIT = true;
//                     message.reply('Message limit has been removed for all users.');
//                     break;

//                 case isAdmin && messageText.startsWith('!!yes-limit'):
//                     NO_LIMIT = false;

//                     for (let user in userMessageCounts) {
//                         userMessageCounts[user].maxLimit = 100;
//                     }

//                     message.reply('Message limit has been enforced for all users.');
//                     break;

//                 default:
//                     message.reply("Unknown command. Please check the available commands using !!menu.");
//                     break;
//             }
//         } else {
//             message.reply("You don't have permission to use commands.");
//         }
//     } else {
//         if (checkMessageLimit(senderNumber)) {
//             trackUserMessage(senderNumber);

//             if (currentMode === 'openai') {
//                 generateResponseOpenAI(assistantOrOpenAI, senderNumber, message.body).then(reply => {
//                     message.reply(reply);
//                 }).catch(error => {
//                     console.error('Error while processing the message:', error);
//                     message.reply("Sorry, something went wrong while processing your request.");
//                 });
//             } else if (currentMode === 'code') {
//                 generateResponseCode(assistantOrOpenAI, senderNumber).then(reply => {
//                     message.reply(reply);
//                 }).catch(error => {
//                     console.error('Error while processing the message:', error);
//                     message.reply("Sorry, something went wrong while processing your request.");
//                 });
//             }
//         } else {
//             message.reply(`Your today's message limit is ended 
// - [usually it's 100 messages per day unless you get extra from admin]
// - Please try again next day and try to keep the conversation short :')
// - Or you can ask the admin to reset your limit.`);
//         }
//     }
// }

// function showMenu(isAdmin, mode) {
//     if (mode === 'openai') {
//         return isAdmin ? `
//         *Commands Menu (Admin - OpenAI Mode):*
//         - !!start: For starting the bot
//         - !!pause: For pausing the bot
//         - !!ping "number": Start pinging the specified number every 240 seconds
//         - !!stop-ping "number": Stop pinging the specified number
//         - !!menu: Show this command menu
//         - !!remind "number" "message" "00:00:00:00": Set a reminder for the specified number with a message after a specified time (days:hours:minutes:seconds)
//         - !!ask "number,number,number" "00:00:00:00": Send a message to multiple numbers with a specified time interval (days:hours:minutes:seconds) between each
//         - !!cancel-remind "number": Cancel all reminders for the specified number
//         - !!not-ask: Cancel all active ask operations
//         - !!assist "Key": Change the Assistant API Key
//         - !!switch "openai" or "code": Switch between OpenAI mode and Code mode
//         - !!checkmoderators: List all current moderators
//         - !!addmoderator "number": Add a moderator (Admin only)
//         - !!removemoderator "number": Remove a moderator (Admin only)
//         - !!clear-assist: Clear all threads (Admin only)
//         - !!limit-reset "number" "amount of messages": Reset the message limit for a specific user (Admin only)
//         - !!no-limit: Remove the message limit for all users (Admin only)
//         - !!yes-limit: Reinstate the message limit for all users (Admin only)
//         ` : `
//         *Commands Menu (Moderator - OpenAI Mode):*
//         - !!start: For starting the bot
//         - !!pause: For pausing the bot
//         - !!ping "number": Start pinging the specified number every 240 seconds
//         - !!stop-ping "number": Stop pinging the specified number
//         - !!menu: Show this command menu
//         - !!remind "number" "message" "00:00:00:00": Set a reminder for the specified number with a message after a specified time (days:hours:minutes:seconds)
//         - !!ask "number,number,number" "00:00:00:00": Send a message to multiple numbers with a specified time interval (days:hours:minutes:seconds) between each
//         - !!cancel-remind "number": Cancel all reminders for the specified number
//         - !!not-ask: Cancel all active ask operations
//         `;
//     } else {
//         return isAdmin ? `
//         *Commands Menu (Admin - Code Mode):*
//         - !!start: For starting the bot
//         - !!pause: For pausing the bot
//         - !!ping "number": Start pinging the specified number every 240 seconds
//         - !!stop-ping "number": Stop pinging the specified number
//         - !!menu: Show this command menu
//         - !!remind "number" "message" "00:00:00:00": Set a reminder for the specified number with a message after a specified time (days:hours:minutes:seconds)
//         - !!ask "number,number,number" "00:00:00:00": Send a message to multiple numbers with a specified time interval (days:hours:minutes:seconds) between each
//         - !!cancel-remind "number": Cancel all reminders for the specified number
//         - !!not-ask: Cancel all active ask operations
//         - !!knowledgebase "name": Switch to the specified knowledge base
//         - !!switch "openai" or "code": Switch between OpenAI mode and Code mode
//         - !!checkmoderators: List all current moderators
//         - !!addmoderator "number": Add a moderator (Admin only)
//         - !!removemoderator "number": Remove a moderator (Admin only)
//         - !!kbadd "filename": Add a new knowledge base file (Admin only)
//         - !!deletekb "filename": Delete a knowledge base file (Admin only)
//         - !!listkb: List all knowledge base files (Admin only)
//         - !!limit-reset "number" "amount of messages": Reset the message limit for a specific user (Admin only)
//         - !!no-limit: Remove the message limit for all users (Admin only)
//         - !!yes-limit: Reinstate the message limit for all users (Admin only)
//         ` : `
//         *Commands Menu (Moderator - Code Mode):*
//         - !!start: For starting the bot
//         - !!pause: For pausing the bot
//         - !!ping "number": Start pinging the specified number every 240 seconds
//         - !!stop-ping "number": Stop pinging the specified number
//         - !!menu: Show this command menu
//         - !!remind "number" "message" "00:00:00:00": Set a reminder for the specified number with a message after a specified time (days:hours:minutes:seconds)
//         - !!ask "number,number,number" "00:00:00:00": Send a message to multiple numbers with a specified time interval (days:hours:minutes:seconds) between each
//         - !!cancel-remind "number": Cancel all reminders for the specified number
//         - !!not-ask: Cancel all active ask operations
//         - !!knowledgebase "name": Switch to the specified knowledge base
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
//     generateResponseOpenAI,
//     generateResponseCode,
//     addModerator,
//     removeModerator,
//     isModerator,
//     checkModerators,
//     handleCommand,
//     loadKnowledgeBase,
//     updateUserMessageHistory,
//     sleep,
//     clearAllThreads,
//     trackUserMessage,
//     checkMessageLimit
// };






















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
