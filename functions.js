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

const userMessageQueues = {};
const userProcessingTimers = {};

// Add this function to generate a random delay between 10 and 30 seconds
function getRandomDelay() {
    return Math.floor(Math.random() * (30000 - 10000 + 1) + 10000);
}

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

async function handleCommand(client, assistantOrOpenAI, message, senderNumber, isAdmin, isModerator, stopBot, startBot) {
    try {
        let messageText = message.body.trim();
        const [command, ...args] = messageText.split(' ');
        const lowerCommand = command.toLowerCase();

        if (ignoreList.has(senderNumber) && !['!!sub', '!!bot', '!!ai-assist'].includes(lowerCommand)) {
            return null;
        }

        if (lowerCommand.startsWith('!!')) {
            if (lowerCommand === '!!show-menu') {
                return showMenu(isAdmin, isModerator);
            } else if (hasPermission(senderNumber, lowerCommand, isAdmin, isModerator)) {
                switch (lowerCommand) {
                    case '!!set-key':
                        const newAssistantKey = extractQuotedString(args.join(' '));
                        if (newAssistantKey) {
                            assistantKey = newAssistantKey;
                            return 'Assistant key has been updated.';
                        } else {
                            return 'Please provide a valid assistant key using !!set-key "YourKey".';
                        }

                    case '!!add-mod':
                        const newModerator = extractQuotedString(args.join(' '));
                        if (newModerator) {
                            addModerator(newModerator);
                            return `${newModerator} is now a moderator.`;
                        } else {
                            return 'Please specify the number to add as a moderator: !!add-mod "number".';
                        }

                    case '!!remove-mod':
                        const moderatorToRemove = extractQuotedString(args.join(' '));
                        if (moderatorToRemove) {
                            removeModerator(moderatorToRemove);
                            return `${moderatorToRemove} is no longer a moderator.`;
                        } else {
                            return 'Please specify the number to remove as a moderator: !!remove-mod "number".';
                        }

                    case '!!list-mods':
                        const moderatorsList = checkModerators();
                        return `Current moderators are: ${moderatorsList.join(', ')}`;

                    case '!!set-limit':
                        const [targetNumber, newLimit] = extractMultipleQuotedStrings(args.join(' '));
                        if (targetNumber && newLimit) {
                            setUserMessageLimit(targetNumber, parseInt(newLimit, 10));
                            return `Message limit for ${targetNumber} has been set to ${newLimit}.`;
                        } else {
                            return 'Please use the correct format: !!set-limit "number" "limit".';
                        }

                    case '!!remove-limit':
                        NO_LIMIT = true;
                        return 'Message limit has been removed for all users.';

                    case '!!enforce-limit':
                        NO_LIMIT = false;
                        resetUserMessageLimits();
                        return 'Message limit has been enforced for all users.';

                    case '!!clear-threads':
                        clearAllThreads();
                        return 'All threads have been cleared.';

                    case '!!show-menu':
                        if (isAdmin) {
                            return showMenu(true, false); // Admin menu
                        } else if (isModerator) {
                            return showMenu(false, true); // Moderator menu
                        } else {
                            return showMenu(false, false); // User menu
                        }

                    case '!!un-sub':
                    case '!!live-chat':
                        ignoreList.add(senderNumber);
                        return 'You have been unsubscribed from receiving messages from this Ai Assistant.\n- Use !!sub or !!bot to Subscribe Ai Assistant again.';

                    case '!!sub':
                    case '!!bot':
                        ignoreList.delete(senderNumber);
                        return 'You have been re-subscribed to receive messages from this Ai Assistant.\n- Use !!live-chat or !!un-sub to  UnSubscribe Ai Assistant';

                    case '!!pause':
                        if (isAdmin || isModerator) {
                            stopBot();
                            return 'Bot has been paused.';
                        } else {
                            return "You don't have permission to use this command.";
                        }

                    case '!!start':
                        if (isAdmin || isModerator) {
                            startBot();
                            return 'Bot has been started.';
                        } else {
                            return "You don't have permission to use this command.";
                        }

                    case '!!no-assist':
                        if (isAdmin || isModerator) {
                            const chat = await message.getChat();
                            if (chat.isGroup) {
                                return "This command cannot be used in a group chat.";
                            }
                            const recipientNumber = chat.id.user;
                            addToIgnoreList(recipientNumber);
                            return `AI assistance disabled for ${recipientNumber}.`;
                        } else {
                            return "You don't have permission to use this command.";
                        }

                    case '!!ai-assist':
                        if (isAdmin || isModerator) {
                            const chat = await message.getChat();
                            if (chat.isGroup) {
                                return "This command cannot be used in a group chat.";
                            }
                            const recipientNumber = chat.id.user;
                            removeFromIgnoreList(recipientNumber);
                            return `AI assistance enabled for ${recipientNumber}.`;
                        } else {
                            return "You don't have permission to use this command.";
                        }

                    default:
                        return "Unknown command. Please check the available commands using !!show-menu.";
                }
            } else {
                return "You don't have permission to use this command.";
            }
        } else {
            if (!ignoreList.has(senderNumber) && checkMessageLimit(senderNumber, isAdmin)) {
                trackUserMessage(senderNumber);
                const response = await storeUserMessage(client, assistantOrOpenAI, senderNumber, message);
                return response; // Return the response
            } else if (!ignoreList.has(senderNumber)) {
                const response = `Your message limit for today has been reached.\n- Please try again tomorrow or contact an admin to reset your limit.`;
                message.reply(response);
                return response; // Return the response
            }
        }
    } catch (error) {
        console.error(`Error in handleCommand: ${error.message}`);
        return "An error occurred while processing your message. Our team has been notified.";
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
- !!pause: Pause the bot
- !!no-assist: Disable AI assistance for a number
- !!ai-assist: Enable AI assistance for a number
            `;
        } else if (isModerator) {
            return `
*Commands Menu (Moderator):*
- !!un-sub: Unsubscribe from receiving messages
- !!sub: Resubscribe to receive messages
- !!show-menu: Show the command menu
- !!start: Start the bot
- !!pause: Pause the bot
- !!no-assist: Disable AI assistance for a number
- !!ai-assist: Enable AI assistance for a number
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
    // Check if the sender is the bot itself
    if (senderNumber === client.info.wid.user) {
        console.log(`Ignoring bot's own non-command message from ${senderNumber}`);
        return null;
    }

    if (!userMessageQueues[senderNumber]) {
        userMessageQueues[senderNumber] = [];
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
        return null; // No immediate response
    } else {
        // For text messages and other types
        messageToStore = message.body || `A message of type ${message.type} was received`;
    }

    userMessageQueues[senderNumber].push(messageToStore);

    // If there's no processing timer for this user, set one
    if (!userProcessingTimers[senderNumber]) {
        const delay = getRandomDelay();
        userProcessingTimers[senderNumber] = setTimeout(() => {
            processUserMessages(client, assistantOrOpenAI, senderNumber);
        }, delay);
    }

    return null; // No immediate response
}

async function processUserMessages(client, assistantOrOpenAI, senderNumber) {
    if (userMessageQueues[senderNumber].length === 0) return;

    const combinedMessage = userMessageQueues[senderNumber].join('\n');
    const isVoiceMessage = combinedMessage.startsWith('Transcribed voice message:');
    userMessageQueues[senderNumber] = []; // Clear the queue

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

        // Clear the processing timer
        delete userProcessingTimers[senderNumber];

        // If there are more messages in the queue, set a new timer
        if (userMessageQueues[senderNumber].length > 0) {
            const delay = getRandomDelay();
            userProcessingTimers[senderNumber] = setTimeout(() => {
                processUserMessages(client, assistantOrOpenAI, senderNumber);
            }, delay);
        }

    } catch (error) {
        console.error(`Error processing messages for ${senderNumber}: ${error.message}`);
        const errorResponse = "Sorry, an error occurred while processing your messages.";
        await client.sendMessage(`${senderNumber}@c.us`, errorResponse);
        
        // Clear the processing timer
        delete userProcessingTimers[senderNumber];
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

function isIgnored(senderNumber) {
    return ignoreList.has(senderNumber);
}

function addToIgnoreList(number) {
    ignoreList.add(number);
}

function removeFromIgnoreList(number) {
    ignoreList.delete(number);
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
    isIgnored,
    addToIgnoreList,
    removeFromIgnoreList,
};