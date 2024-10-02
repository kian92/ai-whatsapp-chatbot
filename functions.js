const POLLING_INTERVAL = 1000;
const MAX_RETRIES = 60;
const userMessageCounts = {};
let NO_LIMIT = false;
const moderators = new Set(); // Add any default moderator numbers here
const ignoreList = new Set();
let assistantKey = 'asst_ze2PHjbK3g1MwGuEW36LgVwF';
const userThreads = {};
const DEFAULT_MESSAGE_LIMIT = 1000; // Added default message limit
const userMessages = {};
const userMessageQueue = {};
const userProcessingStatus = {};
const fs = require('fs');
const axios = require('axios');
const FormData = require('form-data');
const { MessageMedia } = require('whatsapp-web.js');


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
                storeUserMessage(client, assistantOrOpenAI, senderNumber, message);

                // Remove the inactivity timer logic
                // if (userInactivityTimers[senderNumber]) {
                //     clearTimeout(userInactivityTimers[senderNumber]);
                //     delete userInactivityTimers[senderNumber];
                // }
            } else if (!ignoreList.has(senderNumber)) {
                message.reply(`Your message limit for today has been reached.\n- Please try again tomorrow or contact an admin to reset your limit.`);
            }
        }
    } catch (error) {
        console.error(`Error in handleCommand: ${error.message}`);
        try {
            await message.reply("An error occurred while processing your message. Our team has been notified.");
        } catch (replyError) {
            console.error(`Failed to send error reply: ${replyError.message}`);
        }
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
- !!pause: Stop the bot
            `;
        } else if (isModerator) {
            return `
*Commands Menu (Moderator):*
- !!un-sub: Unsubscribe from receiving messages
- !!sub: Resubscribe to receive messages
- !!show-menu: Show the command menu
- !!start: Start the bot
- !!pause: Stop the bot
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

async function storeUserMessage(client, assistantOrOpenAI, senderNumber, message) {
    if (!userMessages[senderNumber]) {
        userMessages[senderNumber] = [];
    }
    if (!userMessageQueue[senderNumber]) {
        userMessageQueue[senderNumber] = [];
    }

    let messageToStore = '';

    // Handle voice messages
    if (message.type === 'ptt' || message.type === 'audio') {
        try {
            const media = await message.downloadMedia();
            const audioBuffer = Buffer.from(media.data, 'base64');
            const transcription = await transcribeAudio(assistantOrOpenAI, audioBuffer);
            messageToStore = `Transcribed voice message: ${transcription}`;
        } catch (error) {
            console.error(`Error processing voice message: ${error.message}`);
            messageToStore = "Sorry, I couldn't process your voice message.";
        }
    } else if (message.type === 'document') {
        const mimeType = message.mimetype;
        if (mimeType === 'application/pdf' || (mimeType && mimeType.includes('word'))) {
            messageToStore = "CV is sent. " + (message.body || '');
        } else {
            messageToStore = `A document of type ${mimeType} was sent. ` + (message.body || '');
        }
    } else if (message.type === 'image') {
        // Ignore pictures
        console.log(`Ignored ${message.type} message from ${senderNumber}`);
        return;
    } else {
        // For text messages and other types
        messageToStore = message.body || `A message of type ${message.type} was received`;
    }

    if (userProcessingStatus[senderNumber]) {
        // If a message is being processed, add this message to the queue
        userMessageQueue[senderNumber].push(messageToStore);
    } else {
        // If no message is being processed, process this message immediately
        userMessages[senderNumber].push(messageToStore);
        processUserMessages(client, assistantOrOpenAI, senderNumber);
    }
}

async function processUserMessages(client, assistantOrOpenAI, senderNumber) {
    if (userMessages[senderNumber].length === 0) return;

    userProcessingStatus[senderNumber] = true;

    const combinedMessage = userMessages[senderNumber].join('\n');
    const isVoiceMessage = combinedMessage.startsWith('Transcribed voice message:');
    userMessages[senderNumber] = []; // Clear the messages

    try {
        const response = await generateResponseOpenAI(assistantOrOpenAI, senderNumber, combinedMessage);
        
        // Send text response for all message types
        await client.sendMessage(`${senderNumber}@c.us`, response);
        
        // Generate and send audio response only for voice messages
        if (isVoiceMessage) {
            const audioBuffer = await generateAudioResponse(assistantOrOpenAI, response);
            const media = new MessageMedia('audio/ogg', audioBuffer.toString('base64'), 'response.ogg');
            await client.sendMessage(`${senderNumber}@c.us`, media, { sendAudioAsVoice: true });
        }
    } catch (error) {
        console.error(`Error processing messages for ${senderNumber}: ${error.message}`);
        await client.sendMessage(`${senderNumber}@c.us`, "Sorry, an error occurred while processing your messages.");
    }

    userProcessingStatus[senderNumber] = false;

    // Process any queued messages
    if (userMessageQueue[senderNumber].length > 0) {
        userMessages[senderNumber] = userMessageQueue[senderNumber];
        userMessageQueue[senderNumber] = [];
        processUserMessages(client, assistantOrOpenAI, senderNumber);
    }
}

async function transcribeAudio(assistantOrOpenAI, audioBuffer) {
    const formData = new FormData();
    formData.append('file', audioBuffer, { filename: 'audio.ogg' });
    formData.append('model', 'whisper-1');

    const response = await axios.post('https://api.openai.com/v1/audio/transcriptions', formData, {
        headers: {
            ...formData.getHeaders(),
            'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
        },
    });

    return response.data.text;
}

async function generateAudioResponse(assistantOrOpenAI, text) {
    const response = await assistantOrOpenAI.audio.speech.create({
        model: "tts-1",
        voice: "alloy",
        input: text,
    });

    const buffer = Buffer.from(await response.arrayBuffer());
    return buffer;
}

module.exports = {
    showMenu,
    parseTimeString,
    generateResponseOpenAI,
    addModerator,
    removeModerator,
    isModerator,
    checkModerators,
    handleCommand,
    sleep,
    clearAllThreads,
    trackUserMessage,
    checkMessageLimit,
    storeUserMessage,
    processUserMessages,
    transcribeAudio,
    generateAudioResponse,
};