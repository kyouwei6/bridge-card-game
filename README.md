# Bridge Card Game

A multiplayer bridge card game that can be played in a web browser with WebSocket support for real-time multiplayer gameplay.

## Features

- Complete bridge game implementation with bidding and card play
- Multiplayer support for up to 4 players
- Real-time synchronization via WebSocket
- Responsive web interface
- Single-player mode for testing

## Setup and Installation

1. Install dependencies:
```bash
npm install
```

2. Start the server:
```bash
npm start
```

3. Open your browser and go to `http://localhost:3000`

## How to Play

### Single Player Mode
1. Click "Start Game" to deal cards and begin bidding
2. Use the bidding buttons to make bids or pass
3. Once bidding is complete, click on your cards to play them
4. The game will automatically track tricks and scoring

### Multiplayer Mode
1. Click "Connect to Game"
2. Enter your player name
3. Either enter a room code to join an existing game, or leave it empty to create a new room
4. Share the room code with other players
5. Once 4 players have joined, click "Start Game" to begin
6. Follow the same bidding and card play rules as single player

## Game Rules

This implements standard bridge rules:
- 4 players (North, South, East, West) in partnerships (NS vs EW)
- Each player gets 13 cards
- Bidding phase to determine contract
- Card play phase with trick-taking
- Scoring based on contract fulfillment

## Technical Details

- Frontend: HTML5, CSS3, JavaScript
- Backend: Node.js with WebSocket (ws library)
- Real-time communication for multiplayer functionality
- Responsive design for desktop and mobile

## Files

- `index.html` - Main game interface
- `styles.css` - Game styling and layout
- `bridge-game.js` - Client-side game logic
- `server.js` - WebSocket server for multiplayer
- `package.json` - Node.js dependencies

## Contributing

Feel free to contribute improvements or bug fixes to enhance the game experience!