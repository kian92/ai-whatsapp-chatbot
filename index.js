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

let client;
const adminNumber = ['923499490427'];
console.log(adminNumber);
let isBotActive = true;
let botNumber = '';
let lastProcessedMessageTime = 0;
const processedMessageIds = new Set();

function initializeClient() {
    client = new Client({
        authStrategy: new LocalAuth(),
        puppeteer: {
            headless: true,
            args: ['--no-sandbox', '--disable-setuid-sandbox'],
        }
    });

    client.on('qr', (qr) => {
        qrcode.generate(qr, { small: true });
        console.log('Scan the QR code above to log in to WhatsApp');
    });

    client.on('ready', () => {
        console.log('Client is ready!');
        botNumber = client.info.wid.user;
        console.log(`Bot number: ${botNumber}`);

        if (!adminNumber.includes(botNumber)) {
            adminNumber.push(botNumber);
            console.log(`Bot number ${botNumber} added to admin list.`);
        }

        functions.loadIgnoreList();
        functions.loadSubjects();
        
        setInterval(checkForNewMessages, 1000);
        setInterval(checkForSubjectChanges, 24 * 60 * 60 * 1000);
    });

    client.on('disconnected', (reason) => {
        console.log('Client was disconnected', reason);
        setTimeout(initializeClient, 5000);
    });

    client.on('message_create', async (message) => {
        await processMessage(message);
    });

    client.on('error', (error) => {
        console.error('An error occurred:', error);
        if (error.message.includes('Session closed')) {
            console.log('Attempting to reconnect...');
            setTimeout(initializeClient, 5000);
        }
    });

    client.initialize().catch((error) => {
        console.error('Failed to initialize client:', error);
        setTimeout(initializeClient, 5000);
    });
}

async function checkForNewMessages() {
    try {
        if (!client.pupPage) {
            console.log('Client page not available, skipping message check');
            return;
        }

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
        if (error.message.includes('Session closed')) {
            console.log('Session closed, attempting to reconnect...');
            setTimeout(initializeClient, 5000);
        }
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
    if (error.message.includes('Session closed')) {
        console.log('Attempting to reconnect...');
        setTimeout(initializeClient, 5000);
    }
});

initializeClient();