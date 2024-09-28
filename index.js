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

const adminNumber = '923499490427';
let isBotActive = true; // Control the bot's active state

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
});

client.on('message', async (message) => {
    const senderId = message.from;
    const senderNumber = senderId.split('@')[0];

    const isAdmin = senderNumber === adminNumber;
    const isModerator = functions.isModerator(senderNumber);

    const messageText = message.body.toLowerCase();

    // Handle bot start/stop commands directly in index.js
    if (messageText.startsWith('!!pause') && (isAdmin || isModerator)) {
        stopBot();
        message.reply('Bot has been paused.');
        return;
    }

    if (messageText.startsWith('!!start') && (isAdmin || isModerator)) {
        startBot();
        message.reply('Bot is now active.');
        return;
    }

    // Allow command processing even when bot is paused
    if (messageText.startsWith('!!')) {
        functions.handleCommand(client, assistant, message, senderNumber, isAdmin, isModerator);
        return; // Exit after handling command to avoid processing as a regular message
    }

    // Only process regular messages if the bot is active
    if (isBotActive) {
        await functions.handleCommand(client, assistant, message, senderNumber, isAdmin, isModerator);
    } else {
        console.log('Bot is paused, no response sent.');
    }
});

client.on('error', (error) => {
    console.error('An error occurred:', error);
});

client.initialize();




