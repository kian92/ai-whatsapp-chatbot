const { google } = require('googleapis');
const path = require('path');

// Import credentials directly from key.json
const CREDENTIALS = require('./key.json');
const SHEET_ID = '1yiwVKpVNMGXx16DM8SO0CrSV7rOPwhdWJW64_o05dbA';

class SheetsService {
    constructor() {
        this.auth = new google.auth.GoogleAuth({
            credentials: CREDENTIALS,
            scopes: ['https://www.googleapis.com/auth/spreadsheets']
        });
        this.sheets = google.sheets({ version: 'v4', auth: this.auth });
    }

    async appendUserData(name, phoneNumber) {
        try {
            const range = 'Sheet1!A:B'; // Assuming first sheet and columns A & B
            const values = [[name, phoneNumber]];

            const response = await this.sheets.spreadsheets.values.append({
                spreadsheetId: SHEET_ID,
                range: range,
                valueInputOption: 'USER_ENTERED',
                resource: {
                    values: values
                }
            });

            console.log('[Sheets] Data appended successfully:', response.data);
            return true;
        } catch (error) {
            console.error('[Sheets] Error appending data:', error);
            return false;
        }
    }

    async checkIfPhoneExists(phoneNumber) {
        try {
            const range = 'Sheet1!B:B'; // Column B for phone numbers
            const response = await this.sheets.spreadsheets.values.get({
                spreadsheetId: SHEET_ID,
                range: range
            });

            const numbers = response.data.values || [];
            return numbers.flat().includes(phoneNumber);
        } catch (error) {
            console.error('[Sheets] Error checking phone number:', error);
            return false;
        }
    }
}

module.exports = new SheetsService();



