class BridgeGame {
    constructor() {
        this.deck = [];
        this.players = {
            north: [],
            east: [],
            south: [],
            west: []
        };
        this.currentPlayer = 'south';
        this.gamePhase = 'waiting'; // waiting, bidding, playing, finished
        this.tricks = [];
        this.currentTrick = [];
        this.bids = [];
        this.contract = null;
        this.declarer = null;
        this.dummy = null;
        this.tricksWon = { ns: 0, ew: 0 };
        this.connection = null;
        this.playerId = null;
        this.roomCode = null;
        this.playerNames = {
            north: null,
            east: null,
            south: null,
            west: null
        };
        
        this.initializeGame();
        this.setupEventListeners();
    }

    initializeGame() {
        this.createDeck();
        this.updateUI();
    }

    createDeck() {
        const suits = ['♠', '♥', '♦', '♣'];
        const ranks = ['A', 'K', 'Q', 'J', '10', '9', '8', '7', '6', '5', '4', '3', '2'];
        
        this.deck = [];
        for (let suit of suits) {
            for (let rank of ranks) {
                this.deck.push({
                    suit: suit,
                    rank: rank,
                    value: this.getCardValue(rank),
                    color: (suit === '♥' || suit === '♦') ? 'red' : 'black'
                });
            }
        }
    }

    getCardValue(rank) {
        const values = {
            'A': 14, 'K': 13, 'Q': 12, 'J': 11, '10': 10,
            '9': 9, '8': 8, '7': 7, '6': 6, '5': 5, '4': 4, '3': 3, '2': 2
        };
        return values[rank];
    }

    shuffleDeck() {
        for (let i = this.deck.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [this.deck[i], this.deck[j]] = [this.deck[j], this.deck[i]];
        }
    }

    dealCards() {
        this.shuffleDeck();
        const playerOrder = ['north', 'east', 'south', 'west'];
        
        // Clear all hands
        for (let player of playerOrder) {
            this.players[player] = [];
        }
        
        // Deal 13 cards to each player
        for (let i = 0; i < 52; i++) {
            const player = playerOrder[i % 4];
            this.players[player].push(this.deck[i]);
        }
        
        // Sort hands
        for (let player of playerOrder) {
            this.players[player].sort((a, b) => {
                if (a.suit !== b.suit) {
                    return ['♠', '♥', '♦', '♣'].indexOf(a.suit) - ['♠', '♥', '♦', '♣'].indexOf(b.suit);
                }
                return b.value - a.value;
            });
        }
        
        this.gamePhase = 'bidding';
        this.currentPlayer = 'north';
        this.updateUI();
    }

    playCard(card, player) {
        if (this.gamePhase !== 'playing') return false;
        if (player !== this.currentPlayer) return false;
        
        // If connected to server, send card play to server
        if (this.connection && this.connection.readyState === WebSocket.OPEN) {
            this.sendToServer({
                type: 'play_card',
                card: card
            });
            return true;
        }
        
        // Local game logic (for single player mode)
        const playerHand = this.players[player];
        const cardIndex = playerHand.findIndex(c => c.suit === card.suit && c.rank === card.rank);
        
        if (cardIndex === -1) return false;
        
        // Remove card from player's hand
        playerHand.splice(cardIndex, 1);
        
        // Add to current trick
        this.currentTrick.push({ card, player });
        
        // Update UI
        this.displayPlayedCard(card, player);
        
        // Check if trick is complete
        if (this.currentTrick.length === 4) {
            setTimeout(() => {
                this.completeTrick();
            }, 1500);
        } else {
            this.currentPlayer = this.getNextPlayer(this.currentPlayer);
        }
        
        this.updateUI();
        return true;
    }

    completeTrick() {
        const winner = this.getTrickWinner();
        const winnerTeam = (winner === 'north' || winner === 'south') ? 'ns' : 'ew';
        
        this.tricksWon[winnerTeam]++;
        this.tricks.push([...this.currentTrick]);
        this.currentTrick = [];
        this.currentPlayer = winner;
        
        // Clear played cards display
        this.clearPlayedCards();
        
        // Check if hand is complete
        if (this.tricks.length === 13) {
            this.gamePhase = 'finished';
            this.showGameResult();
        }
        
        this.updateUI();
    }

    getTrickWinner() {
        if (this.currentTrick.length !== 4) return null;
        
        const leadSuit = this.currentTrick[0].card.suit;
        const trump = this.contract ? this.contract.suit : null;
        
        let winner = this.currentTrick[0];
        
        for (let play of this.currentTrick) {
            const card = play.card;
            
            // Trump beats non-trump
            if (trump && card.suit === trump && winner.card.suit !== trump) {
                winner = play;
            }
            // Higher trump beats lower trump
            else if (trump && card.suit === trump && winner.card.suit === trump) {
                if (card.value > winner.card.value) {
                    winner = play;
                }
            }
            // Higher card of lead suit beats lower card of lead suit (when no trump involved)
            else if (card.suit === leadSuit && winner.card.suit === leadSuit && 
                     (!trump || (winner.card.suit !== trump && card.suit !== trump))) {
                if (card.value > winner.card.value) {
                    winner = play;
                }
            }
        }
        
        return winner.player;
    }

    makeBid(bidString) {
        if (this.gamePhase !== 'bidding') return false;
        
        // If connected to server, send bid to server
        if (this.connection && this.connection.readyState === WebSocket.OPEN) {
            this.sendToServer({
                type: 'bid',
                bid: bidString
            });
            return true;
        }
        
        // Local game logic (for single player mode)
        const bid = {
            player: this.currentPlayer,
            bid: bidString,
            level: bidString === 'pass' ? 0 : parseInt(bidString[0]),
            suit: bidString === 'pass' ? null : bidString.slice(1)
        };
        
        this.bids.push(bid);
        this.updateBidHistory();
        
        if (bidString !== 'pass') {
            this.contract = bid;
            this.declarer = this.currentPlayer;
            this.dummy = this.getPartner(this.currentPlayer);
        }
        
        // Check if bidding is complete (3 consecutive passes after a bid)
        if (this.isBiddingComplete()) {
            this.gamePhase = 'playing';
            this.currentPlayer = this.getNextPlayer(this.declarer);
            this.showContract();
        } else {
            this.currentPlayer = this.getNextPlayer(this.currentPlayer);
        }
        
        this.updateUI();
        return true;
    }

    isBiddingComplete() {
        if (this.bids.length < 4) return false;
        
        const lastThree = this.bids.slice(-3);
        const allPass = lastThree.every(bid => bid.bid === 'pass');
        
        return allPass && this.contract !== null;
    }

    getNextPlayer(player) {
        const order = ['north', 'east', 'south', 'west'];
        const currentIndex = order.indexOf(player);
        return order[(currentIndex + 1) % 4];
    }

    getPartner(player) {
        const partners = {
            'north': 'south',
            'south': 'north',
            'east': 'west',
            'west': 'east'
        };
        return partners[player];
    }

    setupEventListeners() {
        // Start game button
        document.getElementById('start-game').addEventListener('click', () => {
            if (this.connection && this.connection.readyState === WebSocket.OPEN) {
                this.sendToServer({ type: 'start_game' });
            } else {
                this.dealCards();
            }
        });

        // New game button
        document.getElementById('new-game').addEventListener('click', () => {
            this.resetGame();
        });

        // Connect button
        document.getElementById('connect').addEventListener('click', () => {
            this.connectToGame();
        });

        // Bid buttons
        document.querySelectorAll('.bid-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const bid = e.target.dataset.bid;
                this.makeBid(bid);
            });
        });

        // Position change buttons
        document.querySelectorAll('.position-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const newPosition = e.target.dataset.position;
                this.changePosition(newPosition);
            });
        });

        // Card click handlers will be added dynamically
    }

    updateUI() {
        // Update game phase
        document.getElementById('game-phase').textContent = this.getPhaseText();
        
        // Update current player
        document.getElementById('current-player').textContent = this.currentPlayer;
        
        // Update cards display
        this.displayCards();
        
        // Update controls
        this.updateControls();
        
        // Update score
        this.updateScore();
    }

    getPhaseText() {
        switch (this.gamePhase) {
            case 'waiting': return 'Waiting for game to start';
            case 'bidding': return 'Bidding phase';
            case 'playing': return 'Playing cards';
            case 'finished': return 'Game finished';
            default: return 'Unknown phase';
        }
    }

    displayCards() {
        const actualPositions = ['north', 'east', 'south', 'west'];
        
        actualPositions.forEach(actualPosition => {
            const relativePosition = this.getRelativePosition(actualPosition);
            const container = document.getElementById(`${relativePosition}-cards`);
            
            if (container) {
                container.innerHTML = '';
                
                const cards = this.players[actualPosition] || [];
                
                cards.forEach((card, index) => {
                    const cardElement = this.createCardElement(card, actualPosition);
                    
                    // Only make player's own cards clickable
                    const playerPosition = this.playerId || 'south';
                    if (actualPosition === playerPosition) {
                        cardElement.addEventListener('click', () => {
                            if (this.gamePhase === 'playing' && this.currentPlayer === playerPosition) {
                                if (this.playCard(card, playerPosition)) {
                                    cardElement.remove();
                                }
                            }
                        });
                    }
                    
                    container.appendChild(cardElement);
                });
            }
        });
    }

    createCardElement(card, position) {
        const cardDiv = document.createElement('div');
        cardDiv.className = `card ${card.color}`;
        
        // Check if this card should be visible to the player
        const playerPosition = this.playerId || 'south';
        const isPlayerOwnCards = position === playerPosition;
        const isDummyCards = (this.gamePhase === 'playing' && position === this.dummy);
        const isPlayedCard = position === 'played';
        
        // Show card face if it's player's own cards, dummy cards, or played cards
        if (isPlayerOwnCards || isDummyCards || isPlayedCard) {
            // Check if card has valid data
            if (card.rank && card.suit) {
                cardDiv.innerHTML = `
                    <div>${card.rank}</div>
                    <div>${card.suit}</div>
                    <div>${card.rank}</div>
                `;
            } else {
                // Fallback for cards without data
                cardDiv.className += ' card-back';
                cardDiv.textContent = 'BRIDGE';
            }
        } else {
            // Show card back for opponents
            cardDiv.className += ' card-back';
            cardDiv.textContent = 'BRIDGE';
        }
        
        return cardDiv;
    }

    displayPlayedCard(card, player) {
        const container = document.getElementById(`${player}-played`);
        container.innerHTML = '';
        
        const cardElement = this.createCardElement(card, 'played');
        container.appendChild(cardElement);
    }

    clearPlayedCards() {
        ['north', 'east', 'south', 'west'].forEach(position => {
            document.getElementById(`${position}-played`).innerHTML = '';
        });
    }

    updateControls() {
        const startBtn = document.getElementById('start-game');
        const newGameBtn = document.getElementById('new-game');
        const biddingArea = document.getElementById('bidding-area');
        
        startBtn.disabled = this.gamePhase !== 'waiting';
        newGameBtn.disabled = false;
        
        biddingArea.style.display = this.gamePhase === 'bidding' ? 'block' : 'none';
        
        // Enable/disable bid buttons
        document.querySelectorAll('.bid-btn').forEach(btn => {
            const playerPosition = this.playerId || 'south';
            btn.disabled = this.gamePhase !== 'bidding' || this.currentPlayer !== playerPosition;
        });
    }

    updateBidHistory() {
        const historyDiv = document.getElementById('bid-history');
        historyDiv.innerHTML = '';
        
        this.bids.forEach(bid => {
            const bidDiv = document.createElement('div');
            bidDiv.textContent = `${bid.player}: ${bid.bid}`;
            historyDiv.appendChild(bidDiv);
        });
        
        historyDiv.scrollTop = historyDiv.scrollHeight;
    }

    updateScore() {
        const scoreElement = document.getElementById('score');
        scoreElement.textContent = `NS: ${this.tricksWon.ns} | EW: ${this.tricksWon.ew}`;
    }

    showContract() {
        if (this.contract) {
            const contractText = `${this.contract.level}${this.contract.suit} by ${this.declarer}`;
            document.getElementById('game-phase').textContent = `Contract: ${contractText}`;
        }
    }

    showGameResult() {
        const nsScore = this.tricksWon.ns;
        const ewScore = this.tricksWon.ew;
        
        let result = '';
        if (this.contract) {
            const needed = 6 + this.contract.level;
            const declarerTeam = (this.declarer === 'north' || this.declarer === 'south') ? 'ns' : 'ew';
            const made = declarerTeam === 'ns' ? nsScore : ewScore;
            
            if (made >= needed) {
                result = `Contract made! ${this.contract.level}${this.contract.suit} by ${this.declarer}`;
            } else {
                result = `Contract failed. Down ${needed - made}`;
            }
        } else {
            result = 'Game completed';
        }
        
        alert(result);
    }

    resetGame() {
        this.gamePhase = 'waiting';
        this.currentPlayer = 'south';
        this.tricks = [];
        this.currentTrick = [];
        this.bids = [];
        this.contract = null;
        this.declarer = null;
        this.dummy = null;
        this.tricksWon = { ns: 0, ew: 0 };
        
        for (let player in this.players) {
            this.players[player] = [];
        }
        
        this.clearPlayedCards();
        this.updateUI();
        document.getElementById('bid-history').innerHTML = '';
    }

    connectToGame() {
        const playerName = prompt('Enter your name:');
        if (!playerName) return;
        
        const roomCode = prompt('Enter room code (leave empty to create new room):');
        
        const wsUrl = window.location.protocol === 'https:' ? 'wss://' : 'ws://';
        const wsHost = window.location.host || 'localhost:3000';
        this.connection = new WebSocket(wsUrl + wsHost);
        
        this.connection.onopen = () => {
            document.getElementById('connection-status').textContent = 'Connected';
            document.getElementById('connection-status').className = 'connected';
            
            if (roomCode) {
                this.connection.send(JSON.stringify({
                    type: 'join_room',
                    roomCode: roomCode,
                    playerName: playerName
                }));
            } else {
                this.connection.send(JSON.stringify({
                    type: 'create_room',
                    playerName: playerName
                }));
            }
        };
        
        this.connection.onmessage = (event) => {
            const data = JSON.parse(event.data);
            this.handleServerMessage(data);
        };
        
        this.connection.onclose = () => {
            document.getElementById('connection-status').textContent = 'Disconnected';
            document.getElementById('connection-status').className = 'disconnected';
        };
        
        this.connection.onerror = (error) => {
            console.error('WebSocket error:', error);
            alert('Connection failed. Make sure the server is running.');
        };
    }

    handleServerMessage(data) {
        switch (data.type) {
            case 'joined_room':
                this.roomCode = data.roomCode;
                this.playerId = data.position;
                if (data.playerNames) {
                    this.playerNames = data.playerNames;
                }
                document.getElementById('room-code').textContent = data.roomCode;
                document.getElementById('current-player').textContent = `${data.position} (${data.playersCount}/4)`;
                this.updatePlayerNames();
                break;
                
            case 'player_joined':
                if (data.playerNames) {
                    this.playerNames = data.playerNames;
                }
                this.updatePlayerNames();
                alert(`${data.player.name} joined as ${data.player.position}`);
                break;
                
            case 'room_full':
                alert(data.message);
                break;
                
            case 'game_state':
                this.updateFromServerState(data.gameState);
                break;
                
            case 'player_left':
                if (data.playerNames) {
                    this.playerNames = data.playerNames;
                }
                this.updatePlayerNames();
                alert(`${data.player.name} left the game`);
                break;
                
            case 'position_changed':
                // Check if this was the current player who changed position
                if (data.player.oldPosition === this.playerId) {
                    this.playerId = data.player.newPosition;
                }
                
                if (data.playerNames) {
                    this.playerNames = data.playerNames;
                }
                this.updatePlayerNames();
                this.displayCards(); // Refresh card display with new positioning
                break;
                
            case 'error':
                alert(`Error: ${data.message}`);
                break;
        }
    }

    updateFromServerState(gameState) {
        this.gamePhase = gameState.phase;
        this.currentPlayer = gameState.currentPlayer;
        this.bids = gameState.bids;
        this.contract = gameState.contract;
        this.declarer = gameState.declarer;
        this.tricks = gameState.tricks;
        this.currentTrick = gameState.currentTrick;
        this.tricksWon = gameState.tricksWon;
        
        // Update player names if provided
        if (gameState.playerNames) {
            this.playerNames = gameState.playerNames;
        }
        
        // Update player hands
        if (gameState.playerHand) {
            this.players[this.playerId] = gameState.playerHand;
        }
        
        // Update other players' card counts
        Object.keys(gameState.hands).forEach(position => {
            if (position !== this.playerId) {
                const cardCount = gameState.hands[position].length;
                this.players[position] = new Array(cardCount).fill({ suit: '', rank: '', color: 'black' });
            }
        });
        
        // Update trick display
        this.clearPlayedCards();
        gameState.currentTrick.forEach(play => {
            this.displayPlayedCard(play.card, play.player);
        });
        
        this.updateUI();
        this.updateBidHistory();
        this.updatePlayerNames();
    }

    sendToServer(message) {
        if (this.connection && this.connection.readyState === WebSocket.OPEN) {
            this.connection.send(JSON.stringify(message));
        }
    }

    getRelativePosition(actualPosition) {
        if (!this.playerId) return actualPosition;
        
        const positions = ['north', 'east', 'south', 'west'];
        const playerIndex = positions.indexOf(this.playerId);
        const targetIndex = positions.indexOf(actualPosition);
        
        // Calculate relative position (south is always the player)
        const relativeIndex = (targetIndex - playerIndex + 4) % 4;
        const relativePositions = ['south', 'west', 'north', 'east'];
        
        return relativePositions[relativeIndex];
    }

    getActualPosition(relativePosition) {
        if (!this.playerId) return relativePosition;
        
        const positions = ['north', 'east', 'south', 'west'];
        const relativePositions = ['south', 'west', 'north', 'east'];
        const playerIndex = positions.indexOf(this.playerId);
        const relativeIndex = relativePositions.indexOf(relativePosition);
        
        // Calculate actual position
        const actualIndex = (playerIndex + relativeIndex) % 4;
        
        return positions[actualIndex];
    }

    updatePlayerNames() {
        const positions = ['north', 'east', 'south', 'west'];
        
        positions.forEach(position => {
            const relativePos = this.getRelativePosition(position);
            const nameElement = document.getElementById(`${relativePos}-name`);
            const labelElement = document.getElementById(`${relativePos}-label`);
            
            if (nameElement) {
                const playerName = this.playerNames[position];
                nameElement.textContent = playerName || '-';
                
                // Update label to show relative direction
                if (labelElement && this.playerId) {
                    const isYou = position === this.playerId;
                    const relativeDirection = relativePos.charAt(0).toUpperCase() + relativePos.slice(1);
                    labelElement.textContent = isYou ? `${relativeDirection} (You)` : relativeDirection;
                }
            }
        });
        
        // Update position controls
        this.updatePositionControls();
    }

    updatePositionControls() {
        const positionControls = document.getElementById('position-controls');
        const positionButtons = document.querySelectorAll('.position-btn');
        
        if (this.connection && this.connection.readyState === WebSocket.OPEN && this.playerId) {
            positionControls.style.display = 'block';
            
            positionButtons.forEach(btn => {
                const position = btn.dataset.position;
                
                // Reset classes
                btn.className = 'position-btn';
                btn.disabled = false;
                
                // Mark current position
                if (position === this.playerId) {
                    btn.classList.add('current');
                    btn.disabled = false; // Allow switching away from current position
                }
                
                // Mark occupied positions (except current player)
                else if (this.playerNames[position]) {
                    btn.classList.add('occupied');
                    btn.disabled = true;
                }
            });
        } else {
            positionControls.style.display = 'none';
        }
    }

    changePosition(newPosition) {
        if (!this.connection || this.connection.readyState !== WebSocket.OPEN) {
            alert('Not connected to a game');
            return;
        }
        
        if (newPosition === this.playerId) {
            return; // Already in this position
        }
        
        if (this.playerNames[newPosition]) {
            alert('Position is already occupied');
            return;
        }
        
        if (this.gamePhase !== 'waiting') {
            alert('Cannot change position after game has started');
            return;
        }
        
        this.sendToServer({
            type: 'change_position',
            newPosition: newPosition
        });
    }
}

// Initialize the game when the page loads
document.addEventListener('DOMContentLoaded', () => {
    const game = new BridgeGame();
    
    // Make game globally accessible for debugging
    window.bridgeGame = game;
});