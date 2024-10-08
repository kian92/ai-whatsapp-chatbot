require('dotenv').config();
const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const OpenAI = require('openai');
const functions = require('./functions');
const fs = require('fs');
const path = require('path');

const assistant = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
});

const client = new Client({
    authStrategy: new LocalAuth(),
    puppeteer: {
        headless: true,
        args: ['--no-sandbox'],
    }
});

const adminNumber = ['923499490427'];
console.log(adminNumber); // Example usage
let isBotActive = true; // Control the bot's active state

// Add these variables to store the last messages
let lastBotMessage = '';
let lastHumanMessage = '';

// Get the bot's own number after client is ready
let botNumber = '';

// Add this variable to store the timestamp of the last processed message
let lastProcessedMessageTime = 0;

// Add this Set to keep track of processed message IDs
const processedMessageIds = new Set();

function stopBot() {
    isBotActive = false;
    console.log('Bot has been paused.');
}

function startBot() {
    isBotActive = true;
    console.log('Bot is now active.');
}

client.on('qr', (qr) => {
    // Generate and display QR code in the terminal
    qrcode.generate(qr, { small: true });
    console.log('Scan the QR code above to log in to WhatsApp');
});

client.on('ready', () => {
    console.log('Client is ready!');
    botNumber = client.info.wid.user; // Get the bot's own number
    console.log(`Bot number: ${botNumber}`);

    // Add the bot number to the list of admin numbers
    if (!adminNumber.includes(botNumber)) {
        adminNumber.push(botNumber);
        console.log(`Bot number ${botNumber} added to admin list.`);
    }

    // Load the ignore list
    functions.loadIgnoreList();
    
    // Load subjects initially
    functions.loadSubjects();
    
    // Start the periodic check for new messages
    setInterval(checkForNewMessages, 1000);

    // Check for subject changes every 24 hours
    setInterval(checkForSubjectChanges, 24 * 60 * 60 * 1000);
});

async function checkForNewMessages() {
    try {
        const chat = await client.getChatById(`${botNumber}@c.us`);
        const messages = await chat.fetchMessages({ limit: 1 });

        if (messages.length > 0) {
            const latestMessage = messages[0];

            // Only process messages from the bot's number
            if (latestMessage.from === `${botNumber}@c.us`) {
                // Check if this message is newer than the last processed message and hasn't been processed yet
                if (latestMessage.timestamp > lastProcessedMessageTime && !processedMessageIds.has(latestMessage.id._serialized)) {
                    lastProcessedMessageTime = latestMessage.timestamp;

                    // Process the message
                    await processMessage(latestMessage);
                }
            }
        }
    } catch (error) {
        console.error('Error checking for new messages:', error);
    }
}

async function processMessage(message) {
    // Ignore e2e_notification messages
    if (message.type === 'e2e_notification') {
        console.log('Ignoring e2e_notification message');
        return;
    }

    // Check if the message has already been processed
    if (processedMessageIds.has(message.id._serialized)) {
        return;
    }

    // Mark the message as processed
    processedMessageIds.add(message.id._serialized);

    const senderId = message.from;
    const senderNumber = senderId.split('@')[0];
    const messageText = message.body || ''; // Add a default empty string if body is undefined

    const isAdmin = adminNumber.includes(senderNumber);
    const isModerator = functions.isModerator(senderNumber);
    const isBot = senderNumber === botNumber;

    if (messageText.toLowerCase().startsWith('!!')) {
        const response = await functions.handleCommand(client, assistant, message, senderNumber, isAdmin, isModerator, stopBot, startBot);
        if (response && !isBot) {
            await client.sendMessage(senderId, response);
        }
    } else if (isBotActive && !isBot && !functions.isIgnored(senderNumber)) {
        // Only process messages for users in the ignore list (reverse logic)
        const response = await functions.storeUserMessage(client, assistant, senderNumber, message);
        if (response) {
            await client.sendMessage(senderId, response);
        }
    } else if (isBot) {
        // No action needed for bot's own message
    }
}

// Modify the checkForSubjectChanges function:
function checkForSubjectChanges() {
    console.log('Checking for subject changes (24-hour interval)');
    const currentSubjects = functions.getCurrentSubjects();
    const subjectsJson = JSON.stringify(currentSubjects);
    
    // Use the SUBJECTS_FILE from functions
    fs.writeFile(functions.SUBJECTS_FILE, subjectsJson, (err) => {
        if (err) {
            console.error('Error writing subjects file:', err);
        } else {
            console.log('Subjects file updated');
        }
    });

    // Reload subjects after writing the file
    functions.reloadSubjects();
}

client.on('message_create', async (message) => {
    await processMessage(message);
});

client.on('error', (error) => {
    console.error('An error occurred:', error);
});

client.initialize();