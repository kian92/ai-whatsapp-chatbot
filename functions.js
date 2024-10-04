const POLLING_INTERVAL = 1000;
const MAX_RETRIES = 60;
const moderators = new Set(); // Add any default moderator numbers here
let assistantKey = 'asst_ze2PHjbK3g1MwGuEW36LgVwF';
const userThreads = {};
const userMessages = {};
const userMessageQueue = {};
const userProcessingStatus = {};
const fs = require('fs');
const axios = require('axios');
const FormData = require('form-data');
const { MessageMedia } = require('whatsapp-web.js');
const path = require('path');

const userMessageQueues = {};
const userProcessingTimers = {};

// Add these constants at the top of the file
const IGNORE_LIST_FILE = path.join(__dirname, 'ignore_list.json');
const ignoreList = new Set();

// Add these functions to handle saving and loading the ignore list

function saveIgnoreList() {
    const ignoreArray = Array.from(ignoreList);
    fs.writeFileSync(IGNORE_LIST_FILE, JSON.stringify(ignoreArray), 'utf8');
}

function loadIgnoreList() {
    try {
        if (fs.existsSync(IGNORE_LIST_FILE)) {
            const data = fs.readFileSync(IGNORE_LIST_FILE, 'utf8');
            const ignoreArray = JSON.parse(data);
            ignoreList.clear();
            ignoreArray.forEach(number => ignoreList.add(number));
            console.log('Ignore list loaded successfully:', Array.from(ignoreList));
        } else {
            console.log('No ignore list file found. Starting with an empty list.');
        }
    } catch (error) {
        console.error('Error loading ignore list:', error);
    }
}

// Modify the addToIgnoreList function
function addToIgnoreList(number) {
    ignoreList.add(number);
    saveIgnoreList();
}

// Modify the removeFromIgnoreList function
function removeFromIgnoreList(number) {
    ignoreList.delete(number);
    saveIgnoreList();
}

// Add this function to check if a number is in the ignore list
function isIgnored(number) {
    return ignoreList.has(number);
}

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
            assistant_id: assistantKey,
            // Remove the tools parameter from here
        });

        await pollRunStatus(assistant, threadId, run.id);

        const messages = await assistant.beta.threads.messages.list(threadId);
        const latestMessage = messages.data[0];

        let response = '';
        let shouldScheduleAppointment = false;

        if (latestMessage.content && latestMessage.content.length > 0) {
            for (const content of latestMessage.content) {
                if (content.type === 'text') {
                    response += content.text.value.trim() + ' ';
                } else if (content.type === 'tool_calls') {
                    for (const toolCall of content.tool_calls) {
                        if (toolCall.function.name === 'scheduleAppointment') {
                            const args = JSON.parse(toolCall.function.arguments);
                            if (args.schedule) {
                                shouldScheduleAppointment = true;
                            }
                        }
                    }
                }
            }
        }

        if (shouldScheduleAppointment) {
            const appointmentResponse = await scheduleAppointment(senderNumber);
            response += appointmentResponse + ' ';
        }

        // Check if the response is "interested" or "Interested"
        if (["interested", "Interested"].includes(response.trim())) {
            addToIgnoreList(senderNumber);
            response = "Thank you for showing interest in scheduling a meeting. We will contact you shortly to confirm.";
        }

        // Log the generated response

        return response.trim() || "I'm sorry, I couldn't generate a response.";
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
            const response = await storeUserMessage(client, assistantOrOpenAI, senderNumber, message);
            return response;
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

function showMenu(isAdmin, isModerator) {
    try {
        if (isAdmin) {
            return `
*Commands Menu (Admin):*
- !!set-key: Update the assistant key
- !!add-mod: Add a moderator
- !!remove-mod: Remove a moderator
- !!list-mods: List all current moderators
- !!clear-threads: Clear all threads
- !!show-menu: Show the command menu
- !!start: Start the bot
- !!pause: Pause the bot
- !!no-assist: Disable AI assistance for a number
- !!ai-assist: Enable AI assistance for a number
            `;
        } else if (isModerator) {
            return `
*Commands Menu (Moderator):*
- !!show-menu: Show the command menu
- !!start: Start the bot
- !!pause: Pause the bot
- !!no-assist: Disable AI assistance for a number
- !!ai-assist: Enable AI assistance for a number
            `;
        } else {
            return `
*Commands Menu (User):*
- !!show-menu: Show the command menu
            `;
        }
    } catch (error) {
        console.error(`Error in showMenu: ${error.message}`);
        return "Sorry, unable to display the menu at this time.";
    }
}

async function storeUserMessage(client, assistantOrOpenAI, senderNumber, message) {
    // Check if the sender is the bot itself or in the ignore list
    if (senderNumber === client.info.wid.user || isIgnored(senderNumber)) {
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
        let documentType;
        if (mimeType === 'application/pdf') {
            documentType = 'PDF';
        } else if (mimeType && mimeType.includes('word')) {
            documentType = 'Word document';
        } else {
            documentType = `document of type ${mimeType}`;
        }

        const response = await handleDocument(documentType, senderNumber);
        await client.sendMessage(`${senderNumber}@c.us`, response);
        return null;
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

    // Log the message to be stored

    return null; // No immediate response
}

async function processUserMessages(client, assistantOrOpenAI, senderNumber) {
    // Ignore messages from "status"
    if (senderNumber === 'status' || !senderNumber || userMessageQueues[senderNumber].length === 0) return;

    const combinedMessage = userMessageQueues[senderNumber].join('\n');
    const isVoiceMessage = combinedMessage.startsWith('Transcribed voice message:');
    userMessageQueues[senderNumber] = []; // Clear the queue

    try {
        const response = await generateResponseOpenAI(assistantOrOpenAI, senderNumber, combinedMessage);

        // Validate senderNumber format
        const formattedSenderNumber = `${senderNumber}@c.us`;
        if (!formattedSenderNumber.match(/^\d+@c\.us$/)) {
            throw new Error(`Invalid sender number format: ${formattedSenderNumber}`);
        }

        // Send text response for all message types
        await client.sendMessage(formattedSenderNumber, response);

        // Generate and send audio response only for voice messages
        if (isVoiceMessage) {
            const audioBuffer = await generateAudioResponse(assistantOrOpenAI, response);
            const media = new MessageMedia('audio/ogg', audioBuffer.toString('base64'), 'response.ogg');
            await client.sendMessage(formattedSenderNumber, media, { sendAudioAsVoice: true });
        }

    } catch (error) {
        if (error.message.includes('invalid wid')) {
            console.warn(`Invalid WID error for ${senderNumber}: ${error.message}`);
            // Optionally, you can add logic to handle this specific error, such as notifying an admin
        } else {
            console.error(`Error processing messages for ${senderNumber}: ${error.message}`);
            const errorResponse = "Sorry, an error occurred while processing your messages.";
            await client.sendMessage(`${senderNumber}@c.us`, errorResponse);
        }
    } finally {
        // Clear the processing timer
        delete userProcessingTimers[senderNumber];

        // If there are more messages in the queue, set a new timer
        if (userMessageQueues[senderNumber].length > 0) {
            const delay = getRandomDelay();
            userProcessingTimers[senderNumber] = setTimeout(() => {
                processUserMessages(client, assistantOrOpenAI, senderNumber);
            }, delay);
        }
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

// Add these new functions
async function handleDocument(documentType, senderNumber) {
    console.log(`Handling document of type ${documentType} from ${senderNumber}`);
    addToIgnoreList(senderNumber);
    return `Thank you for sending the Document. Our team will review it and get back to you soon.`;
}

async function scheduleAppointment(senderNumber) {
    console.log(`Scheduling appointment for ${senderNumber}`);
    addToIgnoreList(senderNumber);
    return "Thank you for your interest in scheduling an appointment. Our team will contact you shortly at this number to arrange a suitable time. If you have any specific preferences or requirements, please let us know when we reach out to you.";
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
    storeUserMessage,
    processUserMessages,
    transcribeAudio,
    generateAudioResponse,
    loadIgnoreList,
    isIgnored,
    addToIgnoreList,
    removeFromIgnoreList,
    handleDocument,
    scheduleAppointment,
};