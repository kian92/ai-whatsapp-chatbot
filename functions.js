const fs = require('fs');

// Variables shared across modes
const pingIntervals = {};
const moderators = new Set();
let currentMode = 'openai'; // Default mode is 'openai'

// Variables specific to openai mode
let assistantKey = 'asst_uCBkRBD19dgYO896IXHhVEBh';
const userThreads = {};

// Variables specific to code mode
let knowledgeBase = '';
let currentKnowledgeBase = 'default';
const userMessageHistory = {};

// Load the default knowledge base at module initialization for code mode
loadKnowledgeBase(currentKnowledgeBase);

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
    const [hours, minutes] = timeString.split(':').map(Number);
    return (hours * 60 * 60 * 1000) + (minutes * 60 * 1000);
}

function setReminder(client, number, message, time) {
    const delay = parseTimeString(time);

    setTimeout(() => {
        client.sendMessage(`${number}@c.us`, message);
        console.log(`Reminder sent to ${number}: ${message}`);
    }, delay);
}

// OpenAI mode-specific functions
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
    const POLLING_INTERVAL = 1000;
    const MAX_RETRIES = 60;
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

// Code mode-specific functions
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
    const conversationHistory = userMessageHistory[senderNumber]?.join('\n') || '';
    const prompt = `KnowledgeBase:\n${knowledgeBase}\n\nConversation History:\n${conversationHistory}\n\nResponse:`;

    const response = await openai.chat.completions.create({
        model: 'gpt-4o-mini',
        messages: [{ role: 'user', content: prompt }],
    });

    return response.choices[0].message.content.trim();
}

function updateUserMessageHistory(senderNumber, message) {
    if (!userMessageHistory[senderNumber]) {
        userMessageHistory[senderNumber] = [];
    }
    userMessageHistory[senderNumber].push(message);
    if (userMessageHistory[senderNumber].length > 5) {
        userMessageHistory[senderNumber].shift();
    }
}

// Moderator management functions
function addModerator(number) {
    moderators.add(number);
    console.log(`Added ${number} as moderator.`);
}

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

// Handle commands and switching between modes
function handleCommand(client, assistantOrOpenAI, message, senderNumber, isAdmin, isModerator) {
    const messageText = message.body.toLowerCase();
    updateUserMessageHistory(senderNumber, message.body);

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
                        message.reply('Incorrect format. Please use !!remind "number" "message" "x:y".');
                    }
                    break;

                case isAdmin && messageText.startsWith('!!switch'):
                    const newMode = message.body.split('"')[1];
                    if (newMode === 'openai' || newMode === 'code') {
                        currentMode = newMode;
                        message.reply(`Switched to ${newMode} mode.`);
                    } else {
                        message.reply('Invalid mode. Use !!switch "openai" or !!switch "code".');
                    }
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

                default:
                    message.reply("Unknown command. Please check the available commands using !!menu.");
                    break;
            }
        } else {
            message.reply("You don't have permission to use commands.");
        }
    } else {
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
    }
}

function showMenu(isAdmin, mode) {
    if (mode === 'openai') {
        return isAdmin ? `
        *Commands Menu (Admin - OpenAI Mode):*
        - !!start  For starting bot
        - !!pause  For pausing bot
        - !!ping "number": Start pinging the specified number every 240 seconds
        - !!stop-ping "number": Stop pinging the specified number
        - !!menu: Show this command menu
        - !!remind "number" "message" "x:y": Set a reminder for the specified number
        - !!assist "Key": Change the Assistant API Key
        - !!switch "openai" or "code": Switch between modes
        - !!checkmoderators: List all current moderators
        - !!addmoderator "number": Add a moderator (Admin only)
        - !!removemoderator "number": Remove a moderator (Admin only)
        ` : `
        *Commands Menu (Moderator - OpenAI Mode):*
        - !!start  For starting bot
        - !!pause  For pausing bot
        - !!ping "number": Start pinging the specified number every 240 seconds
        - !!stop-ping "number": Stop pinging the specified number
        - !!menu: Show this command menu
        - !!remind "number" "message" "x:y": Set a reminder for the specified number
        `;
    } else {
        return isAdmin ? `
        *Commands Menu (Admin - Code Mode):*
        - !!start  For starting bot
        - !!pause  For pausing bot
        - !!ping "number": Start pinging the specified number every 240 seconds
        - !!stop-ping "number": Stop pinging the specified number
        - !!menu: Show this command menu
        - !!remind "number" "message" "x:y": Set a reminder for the specified number
        - !!knowledgebase "name": Switch to the specified knowledge base
        - !!switch "openai" or "code": Switch between modes
        - !!checkmoderators: List all current moderators
        - !!addmoderator "number": Add a moderator (Admin only)
        - !!removemoderator "number": Remove a moderator (Admin only)
        - !!kbadd "filename": Add a new knowledge base file (Admin only)
        - !!deletekb "filename": Delete a knowledge base file (Admin only)
        - !!listkb: List all knowledge base files (Admin only)
        ` : `
        *Commands Menu (Moderator - Code Mode):*
        - !!start  For starting bot
        - !!pause  For pausing bot
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
    sleep
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
