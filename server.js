const WebSocket = require('ws');
const http = require('http');
const fs = require('fs');
const path = require('path');

class BridgeServer {
    constructor() {
        this.rooms = new Map();
        this.players = new Map();
        this.actionLogs = []; // In-memory storage for action logs
        this.server = http.createServer(this.handleHttpRequest.bind(this));
        this.wss = new WebSocket.Server({ server: this.server });
        
        this.setupWebSocketHandlers();
    }

    handleHttpRequest(req, res) {
        const clientIP = this.getClientIP(req);
        
        // Health check endpoint for Render
        if (req.url === '/health') {
            this.logAction(clientIP, 'health_check', '/health');
            res.writeHead(200, { 'Content-Type': 'text/plain' });
            res.end('OK');
            return;
        }
        
        // Action logs endpoint
        if (req.url === '/logs') {
            this.logAction(clientIP, 'view_logs', '/logs');
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({
                logs: this.getActionLogs(50),
                total: this.actionLogs.length
            }));
            return;
        }
        
        // Logs by IP endpoint
        if (req.url.startsWith('/logs/ip/')) {
            const ip = req.url.split('/logs/ip/')[1];
            this.logAction(clientIP, 'view_logs_by_ip', `/logs/ip/${ip}`, { target_ip: ip });
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({
                logs: this.getLogsByIP(ip, 25),
                ip: ip
            }));
            return;
        }
        
        // Room browser endpoint
        if (req.url === '/api/rooms') {
            this.logAction(clientIP, 'browse_rooms', '/api/rooms');
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({
                rooms: this.getAllRooms()
            }));
            return;
        }
        
        // Parse URL to remove query parameters for file serving
        const url = new URL(req.url, `http://${req.headers.host}`);
        let filePath = url.pathname === '/' ? '/index.html' : url.pathname;
        
        // If the request is for the root with query parameters, serve index.html
        if (url.pathname === '/' && url.searchParams.has('room')) {
            filePath = '/index.html';
        }
        
        const extname = path.extname(filePath);
        
        const mimeTypes = {
            '.html': 'text/html',
            '.css': 'text/css',
            '.js': 'text/javascript',
            '.json': 'application/json'
        };
        
        const contentType = mimeTypes[extname] || 'text/plain';
        
        try {
            const fullPath = path.join(__dirname, filePath);
            const content = fs.readFileSync(fullPath);
            
            // Only log non-static file requests
            if (filePath === '/index.html' || filePath === '/admin.html') {
                this.logAction(clientIP, 'page_request', filePath);
            }
            
            res.writeHead(200, { 'Content-Type': contentType });
            res.end(content);
        } catch (error) {
            // If file not found and it's a potential route, serve index.html for client-side routing
            if (error.code === 'ENOENT' && !extname) {
                try {
                    const indexPath = path.join(__dirname, '/index.html');
                    const indexContent = fs.readFileSync(indexPath);
                    res.writeHead(200, { 'Content-Type': 'text/html' });
                    res.end(indexContent);
                    return;
                } catch (indexError) {
                    // Fall through to 404
                }
            }
            
            res.writeHead(404, { 'Content-Type': 'text/plain' });
            res.end('Not Found');
        }
    }

    setupWebSocketHandlers() {
        this.wss.on('connection', (ws, req) => {
            const clientIP = this.getClientIP(req);
            console.log(`New client connected from ${clientIP}`);
            
            this.logAction(clientIP, 'websocket_connect', '/websocket');
            
            ws.on('message', (message) => {
                try {
                    const data = JSON.parse(message);
                    this.handleMessage(ws, data, clientIP);
                } catch (error) {
                    console.error('Error parsing message:', error);
                    this.logAction(clientIP, 'websocket_error', '/websocket', { error: error.message });
                }
            });
            
            ws.on('close', () => {
                this.logAction(clientIP, 'websocket_disconnect', '/websocket');
                this.handleDisconnect(ws);
            });
        });
    }

    handleMessage(ws, data, clientIP) {
        // Only log important actions to reduce noise
        const importantActions = ['join_room', 'create_room', 'start_game', 'bid', 'play_card'];
        if (importantActions.includes(data.type)) {
            this.logAction(clientIP, `websocket_${data.type}`, '/websocket', { 
                action: data.type,
                room_code: data.roomCode || 'N/A'
            });
        }
        
        switch (data.type) {
            case 'join_room':
                this.joinRoom(ws, data.roomCode, data.playerName, data.password);
                break;
            case 'create_room':
                this.createRoom(ws, data.playerName, data.password);
                break;
            case 'game_action':
                this.handleGameAction(ws, data);
                break;
            case 'bid':
                this.handleBid(ws, data);
                break;
            case 'play_card':
                this.handlePlayCard(ws, data);
                break;
            case 'start_game':
                this.startGame(ws);
                break;
            case 'change_position':
                this.handleChangePosition(ws, data);
                break;
            case 'chat_message':
                this.handleChatMessage(ws, data);
                break;
            case 'update_name':
                this.handleUpdateName(ws, data);
                break;
        }
    }

    createRoom(ws, playerName, password = null) {
        const roomCode = this.generateRoomCode();
        const room = {
            code: roomCode,
            password: password,
            players: [],
            playerNames: {
                north: null,
                east: null,
                south: null,
                west: null
            },
            gameState: {
                phase: 'waiting',
                deck: [],
                hands: {},
                currentPlayer: null,
                bids: [],
                contract: null,
                tricks: [],
                currentTrick: [],
                tricksWon: { ns: 0, ew: 0 },
                trickLeader: null
            }
        };
        
        this.rooms.set(roomCode, room);
        this.joinRoom(ws, roomCode, playerName, password);
    }

    joinRoom(ws, roomCode, playerName, password = null) {
        const room = this.rooms.get(roomCode);
        if (!room) {
            ws.send(JSON.stringify({
                type: 'error',
                message: 'Room not found'
            }));
            return;
        }
        
        // Check password if room has one
        if (room.password && room.password !== password) {
            ws.send(JSON.stringify({
                type: 'error',
                message: 'Incorrect password'
            }));
            return;
        }
        
        if (room.players.length >= 4) {
            ws.send(JSON.stringify({
                type: 'error',
                message: 'Room is full'
            }));
            return;
        }
        
        // Check for duplicate names
        const existingPlayer = room.players.find(p => p.name.toLowerCase() === playerName.toLowerCase());
        if (existingPlayer) {
            ws.send(JSON.stringify({
                type: 'error',
                message: `Name "${playerName}" is already taken in this room. Please choose a different name.`
            }));
            return;
        }
        
        const positions = ['north', 'east', 'south', 'west'];
        const availablePosition = positions.find(pos => 
            !room.players.some(p => p.position === pos)
        );
        
        const player = {
            ws: ws,
            name: playerName,
            position: availablePosition,
            roomCode: roomCode
        };
        
        room.players.push(player);
        room.playerNames[availablePosition] = playerName;
        this.players.set(ws, player);
        
        ws.send(JSON.stringify({
            type: 'joined_room',
            roomCode: roomCode,
            position: availablePosition,
            playersCount: room.players.length,
            playerNames: room.playerNames
        }));
        
        this.broadcastToRoom(roomCode, {
            type: 'player_joined',
            player: { name: playerName, position: availablePosition },
            playersCount: room.players.length,
            playerNames: room.playerNames
        });
        
        if (room.players.length === 4) {
            this.broadcastToRoom(roomCode, {
                type: 'room_full',
                message: 'All players joined. Ready to start!'
            });
        }
    }

    startGame(ws) {
        const player = this.players.get(ws);
        if (!player) return;
        
        const room = this.rooms.get(player.roomCode);
        if (!room || room.players.length < 4) {
            ws.send(JSON.stringify({
                type: 'error',
                message: 'Cannot start game. Need 4 players to start.'
            }));
            return;
        }
        
        this.dealCards(room);
        room.gameState.phase = 'bidding';
        room.gameState.currentPlayer = 'north';
        
        this.broadcastGameState(room);
    }

    dealCards(room) {
        const deck = this.createDeck();
        this.shuffleDeck(deck);
        
        const positions = ['north', 'east', 'south', 'west'];
        const hands = {};
        
        positions.forEach(pos => hands[pos] = []);
        
        for (let i = 0; i < 52; i++) {
            const position = positions[i % 4];
            hands[position].push(deck[i]);
        }
        
        // Sort hands
        positions.forEach(pos => {
            hands[pos].sort((a, b) => {
                if (a.suit !== b.suit) {
                    return ['♠', '♥', '♦', '♣'].indexOf(a.suit) - ['♠', '♥', '♦', '♣'].indexOf(b.suit);
                }
                return b.value - a.value;
            });
        });
        
        room.gameState.hands = hands;
    }

    createDeck() {
        const suits = ['♠', '♥', '♦', '♣'];
        const ranks = ['A', 'K', 'Q', 'J', '10', '9', '8', '7', '6', '5', '4', '3', '2'];
        const deck = [];
        
        for (let suit of suits) {
            for (let rank of ranks) {
                deck.push({
                    suit: suit,
                    rank: rank,
                    value: this.getCardValue(rank),
                    color: (suit === '♥' || suit === '♦') ? 'red' : 'black'
                });
            }
        }
        
        return deck;
    }

    getCardValue(rank) {
        const values = {
            'A': 14, 'K': 13, 'Q': 12, 'J': 11, '10': 10,
            '9': 9, '8': 8, '7': 7, '6': 6, '5': 5, '4': 4, '3': 3, '2': 2
        };
        return values[rank];
    }

    getBidValue(bidString) {
        if (bidString === 'pass' || bidString === 'double' || bidString === 'redouble') {
            return { level: 0, suit: bidString, value: 0 };
        }
        
        const level = parseInt(bidString[0]);
        const suit = bidString.slice(1);
        
        // Suit values: clubs=1, diamonds=2, hearts=3, spades=4
        const suitValues = { 'c': 1, 'd': 2, 'h': 3, 's': 4 };
        const suitValue = suitValues[suit] || 0;
        
        // Calculate overall bid value (level * 5 + suit value)
        const value = level * 5 + suitValue;
        
        return { level, suit, value };
    }

    isValidBid(bidString, gameState) {
        if (bidString === 'pass') return true;
        
        // Special bids
        if (bidString === 'double' || bidString === 'redouble') {
            // TODO: Implement proper double/redouble validation
            return true;
        }
        
        const currentBid = this.getBidValue(bidString);
        
        // Find the last non-pass bid
        let lastBid = null;
        for (let i = gameState.bids.length - 1; i >= 0; i--) {
            if (gameState.bids[i].bid !== 'pass') {
                lastBid = this.getBidValue(gameState.bids[i].bid);
                break;
            }
        }
        
        // If no previous bids, any level 1+ bid is valid
        if (!lastBid) {
            return currentBid.level >= 1 && currentBid.level <= 7;
        }
        
        // New bid must be higher than last bid
        return currentBid.value > lastBid.value && currentBid.level >= 1 && currentBid.level <= 7;
    }

    shuffleDeck(deck) {
        for (let i = deck.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [deck[i], deck[j]] = [deck[j], deck[i]];
        }
    }

    handleBid(ws, data) {
        const player = this.players.get(ws);
        if (!player) return;
        
        const room = this.rooms.get(player.roomCode);
        if (!room || room.gameState.phase !== 'bidding') return;
        
        if (room.gameState.currentPlayer !== player.position) return;
        
        // Validate bid on server side
        if (!this.isValidBid(data.bid, room.gameState)) {
            ws.send(JSON.stringify({
                type: 'error',
                message: 'Invalid bid. Bid must be higher than the last bid.'
            }));
            return;
        }
        
        const bidInfo = this.getBidValue(data.bid);
        const bid = {
            player: player.position,
            bid: data.bid,
            level: bidInfo.level,
            suit: bidInfo.suit
        };
        
        room.gameState.bids.push(bid);
        
        if (data.bid !== 'pass' && data.bid !== 'double' && data.bid !== 'redouble') {
            room.gameState.contract = bid;
            room.gameState.declarer = player.position;
        }
        
        if (this.isBiddingComplete(room.gameState)) {
            room.gameState.phase = 'playing';
            room.gameState.currentPlayer = this.getNextPlayer(room.gameState.declarer);
        } else {
            room.gameState.currentPlayer = this.getNextPlayer(player.position);
        }
        
        this.broadcastGameState(room);
    }

    isValidCardPlay(card, playerPosition, room) {
        const hand = room.gameState.hands[playerPosition];
        const cardIndex = hand.findIndex(c => 
            c.suit === card.suit && c.rank === card.rank
        );
        
        if (cardIndex === -1) return false; // Player doesn't have this card
        
        // If this is the first card of the trick, any card is valid
        if (room.gameState.currentTrick.length === 0) return true;
        
        // Get the suit that was led
        const leadSuit = room.gameState.currentTrick[0].card.suit;
        
        // If playing the same suit as led, it's valid
        if (card.suit === leadSuit) return true;
        
        // If playing a different suit, check if player has any cards of the lead suit
        const hasLeadSuit = hand.some(c => c.suit === leadSuit);
        
        // If player has cards of the lead suit, they must play them
        if (hasLeadSuit) return false;
        
        // If player has no cards of the lead suit, they can play any card
        return true;
    }

    handlePlayCard(ws, data) {
        const player = this.players.get(ws);
        if (!player) return;
        
        const room = this.rooms.get(player.roomCode);
        if (!room || room.gameState.phase !== 'playing') return;
        
        if (room.gameState.currentPlayer !== player.position) return;
        
        // Validate card play according to bridge rules
        if (!this.isValidCardPlay(data.card, player.position, room)) {
            ws.send(JSON.stringify({
                type: 'error',
                message: 'Invalid card play. You must follow suit if you have cards of the led suit.'
            }));
            return;
        }
        
        const hand = room.gameState.hands[player.position];
        const cardIndex = hand.findIndex(c => 
            c.suit === data.card.suit && c.rank === data.card.rank
        );
        
        if (cardIndex === -1) return;
        
        const card = hand.splice(cardIndex, 1)[0];
        room.gameState.currentTrick.push({ card, player: player.position });
        
        // Track who led the trick
        if (room.gameState.currentTrick.length === 1) {
            room.gameState.trickLeader = player.position;
        }
        
        if (room.gameState.currentTrick.length === 4) {
            setTimeout(() => {
                this.completeTrick(room);
            }, 1500);
        } else {
            room.gameState.currentPlayer = this.getNextPlayer(player.position);
        }
        
        this.broadcastGameState(room);
    }

    completeTrick(room) {
        const winner = this.getTrickWinner(room.gameState);
        const winnerTeam = (winner === 'north' || winner === 'south') ? 'ns' : 'ew';
        
        room.gameState.tricksWon[winnerTeam]++;
        room.gameState.tricks.push([...room.gameState.currentTrick]);
        room.gameState.currentTrick = [];
        room.gameState.currentPlayer = winner;
        room.gameState.trickLeader = null;
        
        if (room.gameState.tricks.length === 13) {
            room.gameState.phase = 'finished';
        }
        
        this.broadcastGameState(room);
    }

    getTrickWinner(gameState) {
        const trick = gameState.currentTrick;
        if (trick.length !== 4) return null;
        
        const leadSuit = trick[0].card.suit;
        const trump = gameState.contract ? gameState.contract.suit : null;
        
        let winner = trick[0];
        
        for (let play of trick) {
            const card = play.card;
            
            if (trump && card.suit === trump && winner.card.suit !== trump) {
                winner = play;
            } else if (trump && card.suit === trump && winner.card.suit === trump) {
                if (card.value > winner.card.value) {
                    winner = play;
                }
            } else if (card.suit === leadSuit && winner.card.suit === leadSuit && 
                       (!trump || (winner.card.suit !== trump && card.suit !== trump))) {
                if (card.value > winner.card.value) {
                    winner = play;
                }
            }
        }
        
        return winner.player;
    }

    isBiddingComplete(gameState) {
        if (gameState.bids.length < 4) return false;
        
        const lastThree = gameState.bids.slice(-3);
        const allPass = lastThree.every(bid => bid.bid === 'pass');
        
        return allPass && gameState.contract !== null;
    }

    getNextPlayer(player) {
        const order = ['north', 'east', 'south', 'west'];
        const currentIndex = order.indexOf(player);
        return order[(currentIndex + 1) % 4];
    }

    broadcastGameState(room) {
        room.players.forEach(player => {
            const playerHand = room.gameState.hands[player.position] || [];
            
            player.ws.send(JSON.stringify({
                type: 'game_state',
                gameState: {
                    ...room.gameState,
                    playerHand: playerHand
                }
            }));
        });
    }

    broadcastToRoom(roomCode, message) {
        const room = this.rooms.get(roomCode);
        if (room) {
            room.players.forEach(player => {
                player.ws.send(JSON.stringify(message));
            });
        }
    }

    handleDisconnect(ws) {
        const player = this.players.get(ws);
        if (player) {
            const room = this.rooms.get(player.roomCode);
            if (room) {
                room.players = room.players.filter(p => p.ws !== ws);
                room.playerNames[player.position] = null;
                this.broadcastToRoom(player.roomCode, {
                    type: 'player_left',
                    player: { name: player.name, position: player.position },
                    playersCount: room.players.length,
                    playerNames: room.playerNames
                });
                
                if (room.players.length === 0) {
                    this.rooms.delete(player.roomCode);
                }
            }
            this.players.delete(ws);
        }
    }

    handleChangePosition(ws, data) {
        const player = this.players.get(ws);
        if (!player) return;
        
        const room = this.rooms.get(player.roomCode);
        if (!room) return;
        
        // Check if game has started
        if (room.gameState.phase !== 'waiting') {
            ws.send(JSON.stringify({
                type: 'error',
                message: 'Cannot change position after game has started'
            }));
            return;
        }
        
        // Check if new position is available
        if (room.playerNames[data.newPosition]) {
            ws.send(JSON.stringify({
                type: 'error',
                message: 'Position is already occupied'
            }));
            return;
        }
        
        // Clear old position
        room.playerNames[player.position] = null;
        
        // Update to new position
        const oldPosition = player.position;
        player.position = data.newPosition;
        room.playerNames[data.newPosition] = player.name;
        
        // Update player in rooms array
        const playerIndex = room.players.findIndex(p => p.ws === ws);
        if (playerIndex !== -1) {
            room.players[playerIndex] = player;
        }
        
        // Notify all players in room
        this.broadcastToRoom(player.roomCode, {
            type: 'position_changed',
            player: { name: player.name, oldPosition, newPosition: data.newPosition },
            playerNames: room.playerNames
        });
    }

    handleChatMessage(ws, data) {
        const player = this.players.get(ws);
        if (!player) return;
        
        const room = this.rooms.get(player.roomCode);
        if (!room) return;
        
        // Only allow chat during waiting and finished phases
        if (room.gameState.phase !== 'waiting' && room.gameState.phase !== 'finished') {
            ws.send(JSON.stringify({
                type: 'error',
                message: 'Chat is only available before the game starts and after the game ends'
            }));
            return;
        }
        
        // Validate message
        if (!data.message || data.message.trim().length === 0) return;
        if (data.message.length > 200) return;
        
        // Broadcast chat message to all players in room
        this.broadcastToRoom(player.roomCode, {
            type: 'chat_message',
            sender: player.name,
            message: data.message.trim()
        });
    }

    handleUpdateName(ws, data) {
        const player = this.players.get(ws);
        if (!player) return;
        
        const room = this.rooms.get(player.roomCode);
        if (!room) return;
        
        // Validate new name
        if (!data.newName || data.newName.trim().length === 0) return;
        if (data.newName.length > 20) return;
        
        const newName = data.newName.trim();
        const oldName = player.name;
        
        // Check for duplicate names (excluding current player)
        const existingPlayer = room.players.find(p => 
            p.name.toLowerCase() === newName.toLowerCase() && p.ws !== ws
        );
        if (existingPlayer) {
            ws.send(JSON.stringify({
                type: 'error',
                message: `Name "${newName}" is already taken in this room. Please choose a different name.`
            }));
            return;
        }
        
        // Update player name
        player.name = newName;
        room.playerNames[player.position] = newName;
        
        // Broadcast name change to all players in room
        this.broadcastToRoom(player.roomCode, {
            type: 'name_updated',
            position: player.position,
            oldName: oldName,
            newName: newName,
            playerNames: room.playerNames
        });
    }

    generateRoomCode() {
        return Math.random().toString(36).substring(2, 8).toUpperCase();
    }

    // Action logging system
    getClientIP(req) {
        return req.headers['x-forwarded-for'] || 
               req.headers['x-real-ip'] || 
               req.connection.remoteAddress || 
               req.socket.remoteAddress || 
               (req.connection.socket ? req.connection.socket.remoteAddress : null) ||
               'unknown';
    }

    logAction(ip, action, path, details = {}) {
        const logEntry = {
            timestamp: new Date().toISOString(),
            ip: ip,
            action: action,
            path: path,
            details: details
        };
        
        this.actionLogs.push(logEntry);
        
        // Keep only last 100 entries to prevent memory issues
        if (this.actionLogs.length > 100) {
            this.actionLogs = this.actionLogs.slice(-100);
        }
        
        console.log(`[${logEntry.timestamp}] ${ip} - ${action} on ${path}`);
        
        return logEntry;
    }


    getActionLogs(limit = 50) {
        return this.actionLogs.slice(-limit).reverse(); // Most recent first
    }

    getLogsByIP(ip, limit = 25) {
        return this.actionLogs
            .filter(log => log.ip === ip)
            .slice(-limit)
            .reverse();
    }

    getAllRooms() {
        const rooms = [];
        for (const [code, room] of this.rooms) {
            rooms.push({
                code: code,
                status: room.gameState.phase,
                playerCount: room.players.length,
                hasPassword: !!room.password,
                players: room.playerNames
            });
        }
        return rooms;
    }

    start(port = process.env.PORT || 3000) {
        console.log(`Starting bridge server on port ${port}...`);
        
        this.server.listen(port, '0.0.0.0', () => {
            console.log(`✅ Bridge server successfully running on port ${port}`);
            console.log(`📍 Health check available at /health`);
        });
        
        this.server.on('error', (error) => {
            console.error('❌ Server error:', error);
        });
    }
}

// Start the server
const server = new BridgeServer();
server.start();