const POLLING_INTERVAL = 1000;
const MAX_RETRIES = 60;
const moderators = new Set(); // Add any default moderator numbers here
let assistantKey = 'asst_OeiZPKfQ5FNrcbfaZqHIEcgt';
const userThreads = {};
const userMessages = {};
const userMessageQueue = {};
const userProcessingStatus = {};
const fs = require('fs');
const axios = require('axios');
const FormData = require('form-data');
const { MessageMedia } = require('whatsapp-web.js');
const path = require('path');
const OpenAI = require('openai');
const sheetsService = require('./sheetsService');

const userMessageQueues = {};
const userProcessingTimers = {};

// Add these constants at the top of the file
const IGNORE_LIST_FILE = path.join(__dirname, 'ignore_list.json');
const ignoreList = new Set();

// Add these functions to handle saving and loading the ignore list

function saveIgnoreList() {
    const ignoreArray = Array.from(ignoreList);
    fs.writeFileSync(IGNORE_LIST_FILE, JSON.stringify(ignoreArray, null, 2), 'utf8');
    console.log('Ignore list saved successfully.');
}

function loadIgnoreList() {
    try {
        if (fs.existsSync(IGNORE_LIST_FILE)) {
            const data = fs.readFileSync(IGNORE_LIST_FILE, 'utf8');
            if (data.trim() === '') {
                console.log('Ignore list file is empty. Initializing with an empty array.');
                ignoreList.clear();
                saveIgnoreList();
            } else {
                const ignoreArray = JSON.parse(data);
                ignoreList.clear();
                ignoreArray.forEach(number => ignoreList.add(number));
                console.log('Ignore list loaded successfully:', Array.from(ignoreList));
            }
        } else {
            console.log('No ignore list file found. Creating a new one with an empty array.');
            ignoreList.clear();
            saveIgnoreList();
        }
    } catch (error) {
        console.error('Error loading ignore list:', error);
        console.log('Initializing ignore list with an empty array.');
        ignoreList.clear();
        saveIgnoreList();
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

// Modify the isIgnored function
function isIgnored(number) {
    return ignoreList.has(number);
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

async function pollRunStatus(client, threadId, runId) {
    let retries = 0;
    while (retries < MAX_RETRIES) {
        try {
            const run = await client.beta.threads.runs.retrieve(threadId, runId);
            if (run.status === "completed" || run.status === "requires_action") {
                return run;
            } else if (run.status === "failed" || run.status === "cancelled") {
                throw new Error(`Run ${runId} ${run.status}`);
            }
            await sleep(POLLING_INTERVAL);
            retries++;
        } catch (error) {
            console.error(`Error polling run status: ${error.message}`);
            throw error;
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
//
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
                            removeFromIgnoreList(recipientNumber);
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
                            addToIgnoreList(recipientNumber);
                            return getTemplateMessage(recipientNumber); // Send the template message after enabling AI assistance
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
    // Check if the sender is the bot itself
    if (senderNumber === client.info.wid.user) {
        return null;
    }

    // Check if the user is in the ignore list (meaning they should be ignored)
    if (isIgnored(senderNumber)) {
        return null;
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
    } else if (message.type === 'document' || message.type === 'image') {
        // Ignore documents and images
        console.log(`Ignored ${message.type} message from ${senderNumber}`);
        return null;
    } else {
        // For text messages and other types
        messageToStore = message.body || `A message of type ${message.type} was received`;
    }

    // Process the message directly with OpenAI
    const response = await processUserMessages(client, assistantOrOpenAI, senderNumber, messageToStore);
    if (response) {
        await client.sendMessage(`${senderNumber}@c.us`, response);
    }
    return null;
}

async function processUserMessages(client, assistantOrOpenAI, senderNumber, message) {
    if (senderNumber === 'status' || !senderNumber) return null;

    const isVoiceMessage = message.startsWith('Transcribed voice message:');
    console.log(`[Process] Processing message from ${senderNumber}: ${message}`);

    try {
        // Generate OpenAI response
        const response = await generateResponseOpenAI(assistantOrOpenAI, senderNumber, message, assistantKey);
        console.log(`[Process] Got response for ${senderNumber}`);

        // Format sender number
        const formattedSenderNumber = `${senderNumber}@c.us`;
        if (!formattedSenderNumber.match(/^\d+@c\.us$/)) {
            throw new Error(`Invalid sender number format: ${formattedSenderNumber}`);
        }

        // First send the text response
        if (response.text) {
            console.log(`[Process] Sending text response to ${senderNumber}`);
            await client.sendMessage(formattedSenderNumber, response.text);
        }

        // Then send any images
        if (response.images && response.images.length > 0) {
            console.log(`[Process] Sending ${response.images.length} images to ${senderNumber}`);
            for (const imageData of response.images) {
                const media = new MessageMedia(
                    imageData.mimeType,
                    imageData.data,
                    imageData.filename
                );
                await client.sendMessage(formattedSenderNumber, media);
            }
        }

        // Handle voice messages
        if (isVoiceMessage) {
            console.log(`[Process] Processing voice message for ${senderNumber}`);
            const audioBuffer = await generateAudioResponse(assistantOrOpenAI, response.text);
            const media = new MessageMedia('audio/ogg', audioBuffer.toString('base64'), 'response.ogg');
            await client.sendMessage(formattedSenderNumber, media, { sendAudioAsVoice: true });
        }

        return null; // Return null since we've already sent the messages

    } catch (error) {
        console.error(`[Process] Error processing messages for ${senderNumber}:`, error);
        return "Sorry, an error occurred while processing your messages.";
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

async function getRelevantImage(query) {
    const picsFolder = path.join(__dirname, 'pics');

    try {
        if (!fs.existsSync(picsFolder)) {
            return null;
        }

        const images = fs.readdirSync(picsFolder)
            .filter(file => /\.(jpg|jpeg|png|gif)$/i.test(file));

        if (images.length === 0) {
            return null;
        }

        // Simple string similarity function
        const similarity = (str1, str2) => {
            str1 = str1.toLowerCase();
            str2 = str2.toLowerCase();
            const len1 = str1.length;
            const len2 = str2.length;
            const matrix = Array(len1 + 1).fill().map(() => Array(len2 + 1).fill(0));

            for (let i = 0; i <= len1; i++) matrix[i][0] = i;
            for (let j = 0; j <= len2; j++) matrix[0][j] = j;

            for (let i = 1; i <= len1; i++) {
                for (let j = 1; j <= len2; j++) {
                    const cost = str1[i - 1] === str2[j - 1] ? 0 : 1;
                    matrix[i][j] = Math.min(
                        matrix[i - 1][j] + 1,
                        matrix[i][j - 1] + 1,
                        matrix[i - 1][j - 1] + cost
                    );
                }
            }
            return 1 - (matrix[len1][len2] / Math.max(len1, len2));
        };

        const imageScores = images.map(img => ({
            image: img,
            score: similarity(query, path.parse(img).name)
        }));

        const bestMatch = imageScores.reduce((prev, current) =>
            (prev.score > current.score) ? prev : current
        );

        if (bestMatch.score > 0.3) {
            const imagePath = path.join(picsFolder, bestMatch.image);
            const imageData = fs.readFileSync(imagePath);
            const mimeType = `image/${path.extname(bestMatch.image).substring(1)}`;
            
            return {
                data: imageData.toString('base64'),
                mimeType: mimeType,
                filename: bestMatch.image
            };
        }
        return null;
    } catch (error) {
        console.error('Error in getRelevantImage:', error);
        return null;
    }
}

async function appendUserToSheet(name, phoneNumber) {
    try {
        const exists = await sheetsService.checkIfPhoneExists(phoneNumber);
        if (!exists) {
            const success = await sheetsService.appendUserData(name, phoneNumber);
            return success ? "User data added to sheet successfully" : "Failed to add user data";
        }
        return "Phone number already exists in the sheet";
    } catch (error) {
        console.error('[Sheets] Error in appendUserToSheet:', error);
        return "Error processing user data";
    }
}

// Modify the generateResponseOpenAI function to handle image responses better
async function generateResponseOpenAI(assistant, senderNumber, userMessage, assistantKey, retryCount = 0) {
    const MAX_RETRIES = 2;
    let threadId;
    
    try {
        if (!userMessage) {
            throw new Error('Empty message received.');
        }

        console.log(`[OpenAI] Processing message from ${senderNumber}: ${userMessage}`);

        if (userThreads[senderNumber]) {
            threadId = userThreads[senderNumber];
            console.log(`[OpenAI] Using existing thread: ${threadId}`);
        } else {
            const chat = await assistant.beta.threads.create();
            threadId = chat.id;
            userThreads[senderNumber] = threadId;
            console.log(`[OpenAI] Created new thread: ${threadId}`);
        }

        await assistant.beta.threads.messages.create(threadId, {
            role: 'user',
            content: userMessage
        });
        console.log(`[OpenAI] Added user message to thread`);

        const run = await assistant.beta.threads.runs.create(threadId, {
            assistant_id: assistantKey,
            tools: [{
                type: "function",
                function: {
                    name: "getRelevantImage",
                    description: "Get a relevant image from the pics folder based on the query (e.g We are 3 people,3,4, I want to go to tibet, or when the first time tibet is discuessed in any way",
                    parameters: {
                        type: "object",
                        properties: {
                            query: {
                                type: "string",
                                description: "The search query to find a relevant image based on context or the place or anything related, (Get a relevant image from the pics folder based on the query (e.g We are 3 people,3,4, I want to go to tibet, or when the first time tibet is discuessed in any way )"
                            }
                        },
                        required: ["query"]
                    }
                }
            },
            {
                type: "function",
                function: {
                    name: "appendUserToSheet",
                    description: "Append user data to Google Sheet",
                    parameters: {
                        type: "object",
                        properties: {
                            name: {
                                type: "string",
                                description: "User's name to be added"
                            },
                            phoneNumber: {
                                type: "string",
                                description: "User's phone number"
                            }
                        },
                        required: ["name", "phoneNumber"]
                    }
                }
            }]
        });
        console.log(`[OpenAI] Created run: ${run.id}`);

        const startTime = Date.now();
        const timeout = 30000;
        const maxQueuedTime = 10000; // 10 seconds max wait for queued state
        let queuedStartTime = null;

        while (true) {
            if (Date.now() - startTime > timeout) {
                throw new Error("Request timed out");
            }

            const runStatus = await assistant.beta.threads.runs.retrieve(threadId, run.id);
            console.log(`[OpenAI] Run status: ${runStatus.status}`);

            if (runStatus.status === 'completed') {
                break;
            } else if (runStatus.status === 'requires_action') {
                console.log(`[OpenAI] Function calling required`);
                const toolCalls = runStatus.required_action.submit_tool_outputs.tool_calls;
                const toolOutputs = [];

                for (const toolCall of toolCalls) {
                    const functionName = toolCall.function.name;
                    const args = JSON.parse(toolCall.function.arguments);
                    console.log(`[OpenAI] Calling function: ${functionName} with args:`, args);

                    let result;
                    if (functionName === 'getRelevantImage') {
                        result = await getRelevantImage(args.query);
                    } else if (functionName === 'appendUserToSheet') {
                        result = await appendUserToSheet(args.name, args.phoneNumber);
                    } else {
                        const func = module.exports[functionName];
                        if (typeof func === 'function') {
                            result = await func(args.query);
                        }
                    }

                    if (result && result.data && result.mimeType) {
                        // Store the image data in a temporary object linked to the thread
                        if (!global.pendingImages) global.pendingImages = {};
                        if (!global.pendingImages[threadId]) global.pendingImages[threadId] = [];
                        
                        global.pendingImages[threadId].push(result);
                        console.log(`[OpenAI] Image found and stored for later sending`);
                        
                        // Send a simple success message to OpenAI
                        toolOutputs.push({
                            tool_call_id: toolCall.id,
                            output: "Image found successfully"
                        });
                    } else {
                        toolOutputs.push({
                            tool_call_id: toolCall.id,
                            output: result ? result.toString() : `No result from ${functionName}`
                        });
                    }
                }

                await assistant.beta.threads.runs.submitToolOutputs(
                    threadId,
                    run.id,
                    { tool_outputs: toolOutputs }
                );
                console.log(`[OpenAI] Submitted tool outputs`);
            } else if (runStatus.status === 'failed' || runStatus.status === 'cancelled') {
                throw new Error(`Run ${run.id} ${runStatus.status}`);
            } else if (runStatus.status === 'queued') {
                // Track how long we've been in queued state
                if (!queuedStartTime) {
                    queuedStartTime = Date.now();
                } else if (Date.now() - queuedStartTime > maxQueuedTime) {
                    // If queued for too long, cancel the run and try again
                    try {
                        await assistant.beta.threads.runs.cancel(threadId, run.id);
                    } catch (cancelError) {
                        console.error('[OpenAI] Error cancelling run:', cancelError);
                    }
                    throw new Error("Request was queued for too long");
                }
            } else {
                // Reset queued timer for other states
                queuedStartTime = null;
            }

            // Adjust sleep time based on status
            const sleepTime = runStatus.status === 'queued' ? 2000 : 1000;
            await sleep(sleepTime);
        }

        const messages = await assistant.beta.threads.messages.list(threadId);
        const latestMessage = messages.data[0];
        console.log(`[OpenAI] Retrieved latest message`);

        let response = '';
        if (latestMessage.content && latestMessage.content.length > 0) {
            for (const content of latestMessage.content) {
                if (content.type === 'text') {
                    response += content.text.value.trim() + ' ';
                }
            }
        }

        // Return both the text response and any pending images
        return {
            text: response.trim() || "I'm sorry, I couldn't generate a response.",
            images: global.pendingImages?.[threadId] || []
        };

    } catch (error) {
        console.error(`[OpenAI] Error in generateResponseOpenAI (attempt ${retryCount + 1}):`, error);
        
        // Retry logic for specific errors
        if (retryCount < MAX_RETRIES && 
            (error.message.includes("queued for too long") || 
             error.message.includes("Request timed out"))) {
            console.log(`[OpenAI] Retrying request (attempt ${retryCount + 1})`);
            return generateResponseOpenAI(assistant, senderNumber, userMessage, assistantKey, retryCount + 1);
        }
        
        // Error responses based on the type of error
        if (error.message.includes("queued for too long")) {
            return {
                text: "I'm experiencing high traffic right now. Please try again in a few moments.",
                images: []
            };
        }
        
        return {
            text: "Sorry, something went wrong while processing your request. Please try again.",
            images: []
        };
    } finally {
        // Clean up stored images only if we have a threadId
        if (threadId && global.pendingImages?.[threadId]) {
            delete global.pendingImages[threadId];
        }
    }
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
    getRelevantImage,
    appendUserToSheet,
};