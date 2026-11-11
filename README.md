# Pookie Play

A starter Discord music bot with slash commands and a small web dashboard.

## Requirements
- Node.js 22.12+ (required by the current stable discord voice package documentation)
- A Discord application and bot
- A server where you have permission to add the bot

## Setup
1. Download or clone this repository.
2. Run `npm install`.
3. Copy `.env.example` to `.env`.
4. Fill in `DISCORD_TOKEN`, `CLIENT_ID`, and (optionally) `GUILD_ID` in your local `.env`.
5. Run `npm start`.

Never upload your real `.env` file or share your bot token.

## Commands
- `/join` joins your current voice channel.
- `/leave` leaves voice.
- `/play query` attempts to play a YouTube search result or URL.
- `/pause`, `/resume`, `/skip`, `/stop`, `/volume`.

## Dashboard
Open `http://localhost:3000`. This starter dashboard is a local status/control page, not a hosted public control panel.

## Important limitations
- Spotify links are not streamed. Spotify does not provide a general-purpose full-track playback stream API; Spotify support would require permitted metadata lookup and a separately licensed/allowed audio source.
- YouTube playback through third-party libraries can break and may be subject to platform terms. Verify current terms and library compatibility before public deployment.
- Free hosting providers may sleep or restrict persistent Discord voice connections.
- This is a learning starter, not a production-ready service. Add authentication, persistent sessions, rate limits, monitoring, and secure deployment configuration before exposing a dashboard publicly.
