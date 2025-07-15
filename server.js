const WebSocket = require('ws');
const http = require('http');
const fs = require('fs');
const path = require('path');

class BridgeServer {
    constructor() {
        this.rooms = new Map();
        this.players = new Map();
        this.server = http.createServer(this.handleHttpRequest.bind(this));
        this.wss = new WebSocket.Server({ server: this.server });
        
        this.setupWebSocketHandlers();
    }

    handleHttpRequest(req, res) {
        let filePath = req.url === '/' ? '/index.html' : req.url;
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
            
            res.writeHead(200, { 'Content-Type': contentType });
            res.end(content);
        } catch (error) {
            res.writeHead(404, { 'Content-Type': 'text/plain' });
            res.end('Not Found');
        }
    }

    setupWebSocketHandlers() {
        this.wss.on('connection', (ws) => {
            console.log('New client connected');
            
            ws.on('message', (message) => {
                try {
                    const data = JSON.parse(message);
                    this.handleMessage(ws, data);
                } catch (error) {
                    console.error('Error parsing message:', error);
                }
            });
            
            ws.on('close', () => {
                this.handleDisconnect(ws);
            });
        });
    }

    handleMessage(ws, data) {
        switch (data.type) {
            case 'join_room':
                this.joinRoom(ws, data.roomCode, data.playerName);
                break;
            case 'create_room':
                this.createRoom(ws, data.playerName);
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
        }
    }

    createRoom(ws, playerName) {
        const roomCode = this.generateRoomCode();
        const room = {
            code: roomCode,
            players: [],
            gameState: {
                phase: 'waiting',
                deck: [],
                hands: {},
                currentPlayer: null,
                bids: [],
                contract: null,
                tricks: [],
                currentTrick: [],
                tricksWon: { ns: 0, ew: 0 }
            }
        };
        
        this.rooms.set(roomCode, room);
        this.joinRoom(ws, roomCode, playerName);
    }

    joinRoom(ws, roomCode, playerName) {
        const room = this.rooms.get(roomCode);
        if (!room) {
            ws.send(JSON.stringify({
                type: 'error',
                message: 'Room not found'
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
        this.players.set(ws, player);
        
        ws.send(JSON.stringify({
            type: 'joined_room',
            roomCode: roomCode,
            position: availablePosition,
            playersCount: room.players.length
        }));
        
        this.broadcastToRoom(roomCode, {
            type: 'player_joined',
            player: { name: playerName, position: availablePosition },
            playersCount: room.players.length
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
        if (!room || room.players.length < 4) return;
        
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
        
        const bid = {
            player: player.position,
            bid: data.bid,
            level: data.bid === 'pass' ? 0 : parseInt(data.bid[0]),
            suit: data.bid === 'pass' ? null : data.bid.slice(1)
        };
        
        room.gameState.bids.push(bid);
        
        if (data.bid !== 'pass') {
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

    handlePlayCard(ws, data) {
        const player = this.players.get(ws);
        if (!player) return;
        
        const room = this.rooms.get(player.roomCode);
        if (!room || room.gameState.phase !== 'playing') return;
        
        if (room.gameState.currentPlayer !== player.position) return;
        
        const hand = room.gameState.hands[player.position];
        const cardIndex = hand.findIndex(c => 
            c.suit === data.card.suit && c.rank === data.card.rank
        );
        
        if (cardIndex === -1) return;
        
        const card = hand.splice(cardIndex, 1)[0];
        room.gameState.currentTrick.push({ card, player: player.position });
        
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
                this.broadcastToRoom(player.roomCode, {
                    type: 'player_left',
                    player: { name: player.name, position: player.position },
                    playersCount: room.players.length
                });
                
                if (room.players.length === 0) {
                    this.rooms.delete(player.roomCode);
                }
            }
            this.players.delete(ws);
        }
    }

    generateRoomCode() {
        return Math.random().toString(36).substr(2, 6).toUpperCase();
    }

    start(port = process.env.PORT || 3000) {
        this.server.listen(port, () => {
            console.log(`Bridge server running on port ${port}`);
        });
    }
}

// Start the server
const server = new BridgeServer();
server.start();