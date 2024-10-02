require('dotenv').config();
const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const OpenAI = require('openai');
const functions = require('./functions');

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
    
    // Start the periodic check for new messages
    setInterval(checkForNewMessages, 1000);
});

async function checkForNewMessages() {
    try {
        const chat = await client.getChatById(`${botNumber}@c.us`);
        const messages = await chat.fetchMessages({limit: 1});
        
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
    // Check if the message has already been processed
    if (processedMessageIds.has(message.id._serialized)) {
        return;
    }

    // Mark the message as processed
    processedMessageIds.add(message.id._serialized);

    const senderId = message.from;
    const senderNumber = senderId.split('@')[0];
    const messageText = message.body;

    const isAdmin = adminNumber.includes(senderNumber);
    const isModerator = functions.isModerator(senderNumber);
    const isBot = senderNumber === botNumber;

    console.log(`Processing message from ${senderNumber}. isAdmin: ${isAdmin}, isModerator: ${isModerator}, isBot: ${isBot}`);

    // Handle commands (including bot's own commands)
    if (messageText.toLowerCase().startsWith('!!')) {
        console.log(`Detected command: ${messageText}`);
        const response = await functions.handleCommand(client, assistant, message, senderNumber, isAdmin, isModerator, stopBot, startBot);
        console.log(`Command response: ${response}`);
        if (response) {
            if (!isBot) {
                await client.sendMessage(senderId, response);
            } else {
                console.log(`Bot command processed: ${messageText}`);
            }
        }
    } else if (isBotActive && !isBot) {
        // Check if the sender is in the ignore list
        if (functions.isIgnored(senderNumber)) {
            console.log(`Ignoring message from ${senderNumber} as they are in the ignore list`);
        } else {
            // Generate AI response for non-command messages (excluding bot's own messages)
            const response = await functions.generateResponseOpenAI(assistant, senderNumber, messageText);
            await client.sendMessage(senderId, response);
        }
    }
}

client.on('message_create', async (message) => {
    const senderId = message.from;
    const senderNumber = senderId.split('@')[0];

    // Process all messages, including those from the bot
    await processMessage(message);
});

client.on('error', (error) => {
    console.error('An error occurred:', error);
});

client.initialize();



