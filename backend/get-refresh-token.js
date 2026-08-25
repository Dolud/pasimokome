const { google } = require('googleapis');
const http = require('http');
const url = require('url');
require('dotenv').config({ path: require('path').join(__dirname, '../config/.env') });

const SCOPES = ['https://www.googleapis.com/auth/spreadsheets.readonly', 'https://www.googleapis.com/auth/userinfo.email'];
const REDIRECT_URI = 'http://localhost:3000/auth/google/callback';

const oauth2Client = new google.auth.OAuth2(
  process.env.GOOGLE_CLIENT_ID,
  process.env.GOOGLE_CLIENT_SECRET,
  REDIRECT_URI
);

const authUrl = oauth2Client.generateAuthUrl({
  access_type: 'offline',
  scope: SCOPES,
  prompt: 'consent'
});

console.log('\n=== Google OAuth Setup ===\n');
console.log('1. Open this URL in your browser:\n');
console.log(authUrl);
console.log('\n2. After authorizing, you will be redirected to a localhost URL.');
console.log('3. Copy the FULL redirect URL and paste it below.\n');

process.stdout.write('Paste redirect URL here: ');

let inputData = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', async (chunk) => {
  inputData += chunk;

  if (inputData.includes('\n')) {
    const fullUrl = inputData.trim();

    try {
      const parsed = url.parse(fullUrl, true);
      const code = parsed.query.code;

      if (!code) {
        console.error('No authorization code found in URL.');
        process.exit(1);
      }

      const { tokens } = await oauth2Client.getToken(code);
      console.log('\n=== Success! ===\n');
      console.log('Add this to your .env file:\n');
      console.log(`GOOGLE_REFRESH_TOKEN=${tokens.refresh_token}`);
      console.log('\nDone. You can close this script.');
    } catch (error) {
      console.error('Error exchanging code:', error.message);
    }

    process.exit(0);
  }
});
