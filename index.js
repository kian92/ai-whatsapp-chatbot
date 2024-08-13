require('dotenv').config();
const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const OpenAI = require('openai');
const functions = require('./functions');
const fs = require('fs'); // To handle file operations

const openai = new OpenAI({
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

// Load the default knowledge base on startup
// functions.loadKnowledgeBase('default');

client.on('qr', (qr) => {
    qrcode.generate(qr, { small: true });
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
    if (messageText.startsWith('!!stop') && isAdmin) {
        stopBot();
        message.reply('Bot has been paused.');
        return;
    }

    if (messageText.startsWith('!!start') && isAdmin) {
        startBot();
        message.reply('Bot is now active.');
        return;
    }

    // Handle file uploads
    if (isAdmin && message.hasMedia && messageText.startsWith('!!kbadd')) {
        const kbName = messageText.split(' ')[1]; // Extract the knowledge base name
        if (!kbName) {
            message.reply('Please specify the name for the knowledge base file. Usage: !!kbadd [filename]');
            return;
        }

        const media = await message.downloadMedia(); // Download the media file
        const filePath = `./${kbName}.txt`; // Define where to save the file

        // Save the file
        fs.writeFile(filePath, media.data, { encoding: 'base64' }, (err) => {
            if (err) {
                console.error('Error saving knowledge base file:', err);
                message.reply('Failed to save the knowledge base file.');
            } else {
                console.log(`Saved knowledge base as ${filePath}`);
                message.reply(`Knowledge base file ${kbName}.txt has been saved successfully.`);
            }
        });

        return;
    }

    // Handle file deletion
    if (isAdmin && messageText.startsWith('!!deletekb')) {
        const kbName = messageText.split(' ')[1]; // Extract the knowledge base name
        if (!kbName) {
            message.reply('Please specify the name of the knowledge base file to delete. Usage: !!deletekb [filename]');
            return;
        }

        const filePath = `./${kbName}.txt`; // Define the file path
        if (fs.existsSync(filePath)) {
            fs.unlink(filePath, (err) => {
                if (err) {
                    console.error('Error deleting knowledge base file:', err);
                    message.reply('Failed to delete the knowledge base file.');
                } else {
                    console.log(`Deleted knowledge base file ${filePath}`);
                    message.reply(`Knowledge base file ${kbName}.txt has been deleted successfully.`);
                }
            });
        } else {
            message.reply(`File ${kbName}.txt does not exist.`);
        }

        return;
    }

    // Handle listing all .txt files in the directory
    if (isAdmin && messageText.startsWith('!!listkb')) {
        fs.readdir('./', (err, files) => {
            if (err) {
                console.error('Error listing knowledge base files:', err);
                message.reply('Failed to list knowledge base files.');
                return;
            }

            const txtFiles = files.filter(file => file.endsWith('.txt'));
            if (txtFiles.length > 0) {
                message.reply(`Knowledge base files in directory:\n${txtFiles.join('\n')}`);
            } else {
                message.reply('No knowledge base files found in the directory.');
            }
        });

        return;
    }

    // Only process other commands if the bot is active
    if (isBotActive) {
        functions.handleCommand(client, openai, message, senderNumber, isAdmin, isModerator);
    } else {
        console.log('Bot is paused, no response sent.');
    }
});

client.on('error', (error) => {
    console.error('An error occurred:', error);
});

client.initialize();




































// Older versions are below.



// require('dotenv').config();
// const fs = require('fs'); // Required to read files
// const readline = require('readline');
// const { Client, LocalAuth } = require('whatsapp-web.js');
// const qrcode = require('qrcode-terminal');
// const OpenAI = require('openai');

// // Initialize OpenAI API with the API key directly
// const openai = new OpenAI({
//   apiKey: process.env.OPENAI_API_KEY,
// });

// // Initialize WhatsApp client
// const client = new Client({
//     authStrategy: new LocalAuth(),
//     puppeteer: {
//         headless: true,
//         args: ['--no-sandbox'],
//     }
// });

// let knowledgeBase = ''; // Variable to store the knowledge base content
// const defaultKnowledgeBase = 'default'; // Default knowledge base file name
// let currentKnowledgeBase = defaultKnowledgeBase; // Track the current knowledge base in use

// // Function to load the knowledge base
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

// // Load the default knowledge base at startup
// loadKnowledgeBase(defaultKnowledgeBase);

// client.on('qr', (qr) => {
//     qrcode.generate(qr, { small: true });
// });

// client.on('ready', () => {
//     console.log('Client is ready!');
// });

// // Existing bot control code
// let isBotActive = true;
// let pingInterval;

// function stopBot() {
//     isBotActive = false;
//     console.log('Bot has been paused.');
// }

// function startBot() {
//     isBotActive = true;
//     console.log('Bot is now active.');
// }

// function startPinging() {
//     pingInterval = setInterval(() => {
//         client.sendMessage('923261467086@c.us', 'Pinging');
//         console.log('Sent "Pinging" to 923261467086@c.us');
//     }, 240000); // 240 seconds = 4 minutes
// }

// function stopPinging() {
//     clearInterval(pingInterval);
//     console.log('Stopped pinging.');
// }

// function showMenu() {
//     return `
//     *Commands Menu:*
//     - !!stop: Pause the bot
//     - !!start: Resume the bot
//     - !!ping: Start pinging 923467467086@c.us every 240 seconds
//     - !!menu: Show this command menu
//     - !!remind: Please use !!remind "number" "message" "x:y" (e.g., !!remind "923261467086" "Please pay your due." "00:01").
//     - !!knowledgebase "name": Switch to the specified knowledge base.
//     `;
// }

// const parseTimeString = (timeString) => {
//     const [hours, minutes] = timeString.split(':').map(Number);
//     return (hours * 60 * 60 * 1000) + (minutes * 60 * 1000); // Convert to milliseconds
// };

// const setReminder = (number, message, time) => {
//     const delay = parseTimeString(time);

//     setTimeout(() => {
//         client.sendMessage(number + '@c.us', message);
//         console.log(`Reminder sent to ${number}: ${message}`);
//     }, delay);
// };

// client.on('message', async (message) => {
//     const senderId = message.from;
//     const messageText = message.body.toLowerCase();

//     // Extract the phone number from the senderId (before '@')
//     const senderNumber = senderId.split('@')[0];

//     // Allow only commands from these specific numbers
//     if (senderNumber === '923499490427' || senderNumber === '923261467086') {
//         if (messageText.startsWith('!!remind')) {
//             const parts = message.body.split('"');
//             if (parts.length === 7) {
//                 const targetNumber = parts[1];
//                 const reminderMessage = parts[3];
//                 const time = parts[5];
//                 setReminder(targetNumber, reminderMessage, time);
//             } else {
//                 message.reply('Incorrect format. Please use !!remind "number" "message" "x:y" (e.g., !!remind "923467467086" "Please pay your due." "00:01").');
//             }
//             return;
//         }

//         if (messageText.startsWith('!!knowledgebase')) {
//             const kbName = message.body.split('"')[1];
//             if (kbName) {
//                 if (loadKnowledgeBase(kbName)) {
//                     message.reply(`Switched to knowledge base "${kbName}".`);
//                 } else {
//                     message.reply(`Knowledge base "${kbName}" does not exist.`);
//                 }
//             } else {
//                 message.reply('Please specify the knowledge base name like !!knowledgebase "name".');
//             }
//             return;
//         }

//         switch (messageText) {
//             case '!!stop':
//                 stopBot();
//                 message.reply('Bot has been paused.');
//                 return;
//             case '!!start':
//                 startBot();
//                 message.reply('Bot is now active.');
//                 return;
//             case '!!ping':
//                 startPinging();
//                 message.reply('Started pinging 923467467086@c.us every 240 seconds.');
//                 return;
//             case '!!menu':
//                 message.reply(showMenu());
//                 return;
//             default:
//                 break;
//         }
//     }

//     if (isBotActive) {
//         try {
//             const userQuery = message.body.toLowerCase();
//             const reply = await generateResponse(userQuery, knowledgeBase);
//             message.reply(reply);
//         } catch (error) {
//             console.error('Error while processing the message:', error);
//             message.reply("Sorry, something went wrong while processing your request.");
//         }
//     } else {
//         console.log('Bot is paused, no response sent.');
//     }
// });

// client.on('error', error => {
//     console.error('An error occurred:', error);
// });

// // Function to generate a response using OpenAI
// async function generateResponse(userQuery, knowledgeBase) {
//     // Combine user query with the knowledge base content
//     const prompt = `
    
//     KnowledgeBase:\n${knowledgeBase}\n\nUser Query: ${userQuery}\n\nResponse:`;

//     const response = await openai.chat.completions.create({
//         model: 'gpt-4o-mini',
//         messages: [{ role: 'user', content: prompt }],
//     });

//     return response.choices[0].message.content.trim();
// }

// // User message history to track last 10 messages
// const userMessageHistory = {};

// function getLastTenMessages(senderId, newMessage) {
//     if (!userMessageHistory[senderId]) {
//         userMessageHistory[senderId] = [];
//     }
//     userMessageHistory[senderId].push(newMessage);
    
//     // Ensure we only keep the last 10 messages
//     if (userMessageHistory[senderId].length > 10) {
//         userMessageHistory[senderId].shift();
//     }
    
//     return userMessageHistory[senderId].join('\n');
// }

// client.initialize();














































// require('dotenv').config();
// const { Client, LocalAuth } = require('whatsapp-web.js'); 
// const qrcode = require('qrcode-terminal');
// const OpenAI = require('openai');

// // Initialize OpenAI API with the API key directly
// const openai = new OpenAI({
//   apiKey: process.env.OPENAI_API_KEY,
// });

// // Initialize WhatsApp client
// const client = new Client({
//     authStrategy: new LocalAuth(),
//     puppeteer: {
//         headless: true,
//         args: ['--no-sandbox'],
//     }
// });
// // Existing code...

// client.initialize();

// client.on('qr', (qr) => {
//     qrcode.generate(qr, { small: true });
// });

// client.on('ready', () => {
//     console.log('Client is ready!');
// });

// //--------------------------------
// // Your new code starts here
// let isBotActive = true;
// let pingInterval;

// function stopBot() {
//     isBotActive = false;
//     console.log('Bot has been paused.');
// }

// function startBot() {
//     isBotActive = true;
//     console.log('Bot is now active.');
// }

// function startPinging() {
//     pingInterval = setInterval(() => {
//         client.sendMessage('923261467086@c.us', 'Pinging');
//         console.log('Sent "Pinging" to 923261467086@c.us');
//     }, 240000); // 240 seconds = 4 minutes
// }

// function stopPinging() {
//     clearInterval(pingInterval);
//     console.log('Stopped pinging.');
// }

// function showMenu() {
//     return `
//     *Commands Menu:*
//     - !!stop: Pause the bot
//     - !!start: Resume the bot
//     - !!ping: Start pinging 923467467086@c.us every 240 seconds
//     - !!menu: Show this command menu
//     - !!remind: Please use !!remind "number" "message" "x:y" (e.g., !!remind "923261467086" "Please pay your due." "00:01").
//     `;
// }

// const parseTimeString = (timeString) => {
//     const [hours, minutes] = timeString.split(':').map(Number);
//     return (hours * 60 * 60 * 1000) + (minutes * 60 * 1000); // Convert to milliseconds
// };

// const setReminder = (number, message, time) => {
//     const delay = parseTimeString(time);

//     setTimeout(() => {
//         client.sendMessage(number + '@c.us', message);
//         console.log(`Reminder sent to ${number}: ${message}`);
//     }, delay);
// };

// client.on('message', async (message) => {
//     const senderId = message.from;
//     const messageText = message.body.toLowerCase();

//     // Extract the phone number from the senderId (before '@')
//     const senderNumber = senderId.split('@')[0];

//     // Allow only commands from these specific numbers
//     if (senderNumber === '923499490427' || senderNumber === '923261467086') {
//         if (messageText.startsWith('!!remind')) {
//             const parts = message.body.split('"');
//             if (parts.length === 7) {
//                 const targetNumber = parts[1];
//                 const reminderMessage = parts[3];
//                 const time = parts[5];
//                 // The rest of your code...
//             } else {
//                 message.reply('Incorrect format. Please use !!remind "number" "message" "x:y" (e.g., !!remind "923467467086" "Please pay your due." "00:01").');
//             }
//             return;
//         }

//         switch (messageText) {
//             case '!!stop':
//                 stopBot();
//                 message.reply('Bot has been paused.');
//                 return;
//             case '!!start':
//                 startBot();
//                 message.reply('Bot is now active.');
//                 return;
//             case '!!ping':
//                 startPinging();
//                 message.reply('Started pinging 923467467086@c.us every 240 seconds.');
//                 return;
//             case '!!menu':
//                 message.reply(showMenu());
//                 return;
//             default:
//                 break;
//         }
//     }

//     if (isBotActive) {
//         try {
//             const userQuery = message.body.toLowerCase();
//             const reply = await generateResponse(userQuery);
//             message.reply(reply);
//         } catch (error) {
//             console.error('Error while processing the message:', error);
//             message.reply("Sorry, something went wrong while processing your request.");
//         }
//     } else {
//         console.log('Bot is paused, no response sent.');
//     }
// });

// client.on('error', error => {
//     console.error('An error occurred:', error);
// });

// //--------------------------------

// // Knowledge base stored as a chunk of text
// const knowledgeBase = `

// Instruction to add with every message: "Want Ai assistant like this? Contact us.
// - WhatsApp: 923346093321
// - WhatsApp: 923467467086 "

// About Metastore:
// Metastore offers affordable digital services. Below are the available services and their prices in PKR:

// 1. **Webflow CMS Site Plan (Yearly)**
//    - Official Price: 276$
//    - Metastore Price: 80$

// 2. **Netflix**
//    - 4 Screens UHD: 1750 PKR (Personal, Password Changeable, Replace Warranty, Renewable)
//    - 3 Screens UHD: 1350 PKR (Shared)
//    - 2 Screens UHD: 900 PKR (Shared)
//    - 1 Screen UHD: 450 PKR (Shared)

// 3. **Amazon Prime**
//    - 4 Screens UHD: 650 PKR (Personal, Password Changeable, Replace Warranty, 24/7 Support)
//    - 3 Screens UHD: 450 PKR (Shared)
//    - 2 Screens UHD: 350 PKR (Shared)
//    - 1 Screen UHD: 250 PKR (Shared)

// 4. **Github Pro with 96 Extra Tools**
//    - Yearly: 3500 PKR

// 5. **WhatsApp Numbers (OTP Prices)**
//    - USA: 650 PKR
//    - UK: 590 PKR
//    - +1 Country Code: 490 PKR
//    - Pakistan: 350 PKR
//    - India: 350 PKR
//    - Other Countries: Contact for pricing

// 6. **Social Media OTPs Available**

// 7. **Social Media Services**
//    - **TikTok:**
//      - 1K Views: 10 PKR
//      - 1K Hearts/Likes: 240 PKR
//      - 1K Followers: 590 PKR
//    - **Instagram:**
//      - 1K Followers: 420 PKR
//      - 1K Post Likes: 145 PKR
//      - 1K Video Views: 90 PKR
//    - **Facebook:**
//      - 1K Followers: 490 PKR
//      - 1K Page Likes + Followers: 590 PKR

// 8. **Grammarly / QuillBot / Turnitin**
//    - Grammarly: 
//      - 1 Month: 500 PKR
//      - Yearly Shared: 2000 PKR
//    - QuillBot: 
//      - 1 Month Shared: 500 PKR
//      - Yearly Shared: 2000 PKR
//    - Turnitin Pro AI: 
//      - 1 Month: 3000 PKR
//    - Turnitin Student Without AI: 
//      - Yearly: 2000 PKR

// 9. **LinkedIn Premium**
//    - 6 Months (Business Plan): 
//    - Sale Navigator 1 Month: 5600 PKR
//    - Recruiter Lite Yearly: 250$ (Approx. 6250 PKR)

// 10. **Freepik**
//     - 1 Device Package:
//       - 33 Downloads/Day
//       - 1 Month
//       - 27 Days Warranty
//       - Price: 1500 PKR
//     - Full Account:
//       - 100 Downloads/Day
//       - 3-4 Devices
//       - 1 Month
//       - 27 Days Warranty
//       - Price: 4000 PKR

// 11. **ChatGPT**
//     - Semi Private 1 Month Gold Membership: 2300 PKR

// 12. **Streaming Services**
//     - Disney Plus (1 Month with VPN, 1 Device): 500 PKR
//     - HBO Max (1 Month with VPN, 1 Device): 500 PKR
//     - Zee5: 400 PKR
//     - Sony Liv: 400 PKR
//     - Hotstar: 400 PKR
//     - Chaupal: 380 PKR

// 13. **VPNs**
//     - Nord VPN (1 Device): 380 PKR
//     - Hotspot Shield (1 Month): 380 PKR
//     - Express VPN Mobile (1 Month): 800 PKR
//     - Express VPN (PC, 1K): 1000 PKR

// 14. **Figma Pro**
//     - Yearly: 3500 PKR

// 15. **IPTV**
//     - Opplex (1 Month): 350 PKR
//     - Startshare (1 Month): 500 PKR

// 16. **Capcut Pro**
//     - 1 Month: 500 PKR

// 17. **Office 365**
//     - Yearly: 2000 PKR

// 18. **Adobe Creative Cloud**
//     - 1 Month: 2200 PKR
//     - 3 Months: 5500 PKR

// 19. **Canva Pro**
//     - 1 Month: 800 PKR
//     - Yearly: 8000 PKR

// 20. **YouTube Premium**
//     - 1 Month: 380 PKR
//     - Yearly: 4500 PKR

// 21. **Windows Keys**
//     - Windows 10: 2000 PKR
//     - Windows 11: 2000 PKR

// 22. **Other Services**
//     - App Development
//     - Website Design & Development
//     - Online Store Creation
//     - Social Media Ads
//     - Assignment & Article Work
//     - Unlimited Google Drive & OneDrive (Personal Mail) + Separate Mail

// 23. **Digital Product Bundle**

// **Contact:**
// - WhatsApp: 923346093321
// - WhatsApp: 923467467086

// `;

// // Function to generate a response using OpenAI
// const userMessageHistory = {};

// // Function to maintain and retrieve the last 10 messages of a user
// function getLastTenMessages(senderId, newMessage) {
//     if (!userMessageHistory[senderId]) {
//         userMessageHistory[senderId] = [];
//     }
//     userMessageHistory[senderId].push(newMessage);
    
//     // Ensure we only keep the last 10 messages
//     if (userMessageHistory[senderId].length > 10) {
//         userMessageHistory[senderId].shift();
//     }
    
//     return userMessageHistory[senderId].join('\n');
// }

// // Update the generateResponse function
// async function generateResponse(query, messageHistory) {
//     let prompt = `You are Metastore assistant.
//     Below are the last 10 messages exchanged with the user:
//     "${messageHistory}"
//     Reply to the following query based on the knowledge base: "${query}"\nKnowledge Base: ${knowledgeBase}
//     More instructions:
//     Reply short and in bullets.
//     Reply in friendly tone
//     Reply in same language as received in message.
//     Important: Check from internet and provide related knowledge along with our related service
//     Example question : I want to watch mirzapur
//     Example responses : You want to watch *Mirzapur* ? We've got you!  
//     *Amazon Prime Plans:*
// - 1 Screen UHD: 250 PKR
// - 2 Screens UHD: 350 PKR
// - 3 Screens UHD: 450 PKR
// - 4 Screens UHD: 650 PKR
//     `;

//     // Add a guiding response if the query seems unrelated to Metastore
//     prompt += "\n\nIf the query is unrelated to Metastore, politely suggest that the user explore Metastore's services or contact support.";

//     const response = await openai.chat.completions.create({
//         model: 'gpt-4o-mini',
//         messages: [{ role: 'user', content: prompt }],
//     });

//     return response.choices[0].message.content.trim();
// }
