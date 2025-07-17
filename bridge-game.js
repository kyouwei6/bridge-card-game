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
        this.trickLeader = null;
        this.playersCount = 0;
        
        this.initializeGame();
        this.setupEventListeners();
        this.loadSavedSettings();
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

    isValidBid(bidString) {
        if (bidString === 'pass') return true;
        
        // Special bids
        if (bidString === 'double' || bidString === 'redouble') {
            // TODO: Implement proper double/redouble validation
            return true;
        }
        
        const currentBid = this.getBidValue(bidString);
        
        // Find the last non-pass bid
        let lastBid = null;
        for (let i = this.bids.length - 1; i >= 0; i--) {
            if (this.bids[i].bid !== 'pass') {
                lastBid = this.getBidValue(this.bids[i].bid);
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

    isValidCardPlay(card, player) {
        if (this.gamePhase !== 'playing') return false;
        if (player !== this.currentPlayer) return false;
        
        const playerHand = this.players[player];
        const cardIndex = playerHand.findIndex(c => c.suit === card.suit && c.rank === card.rank);
        
        if (cardIndex === -1) return false; // Player doesn't have this card
        
        // If this is the first card of the trick, any card is valid
        if (this.currentTrick.length === 0) return true;
        
        // Get the suit that was led
        const leadSuit = this.currentTrick[0].card.suit;
        
        // If playing the same suit as led, it's valid
        if (card.suit === leadSuit) return true;
        
        // If playing a different suit, check if player has any cards of the lead suit
        const hasLeadSuit = playerHand.some(c => c.suit === leadSuit);
        
        // If player has cards of the lead suit, they must play them
        if (hasLeadSuit) return false;
        
        // If player has no cards of the lead suit, they can play any card
        return true;
    }

    playCard(card, player) {
        if (this.gamePhase !== 'playing') return false;
        if (player !== this.currentPlayer) return false;
        
        // Validate card play according to bridge rules
        if (!this.isValidCardPlay(card, player)) {
            if (this.currentTrick.length > 0) {
                const leadSuit = this.currentTrick[0].card.suit;
                const suitName = this.getSuitName(leadSuit);
                alert(`You must follow suit. Please play a ${suitName} card if you have one.`);
            }
            return false;
        }
        
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
        
        // Track who led the trick
        if (this.currentTrick.length === 1) {
            this.trickLeader = player;
        }
        
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

    getSuitName(suit) {
        const suitNames = {
            '♠': 'Spades',
            '♥': 'Hearts', 
            '♦': 'Diamonds',
            '♣': 'Clubs'
        };
        return suitNames[suit] || suit;
    }

    completeTrick() {
        const winner = this.getTrickWinner();
        const winnerTeam = (winner === 'north' || winner === 'south') ? 'ns' : 'ew';
        
        this.tricksWon[winnerTeam]++;
        this.tricks.push([...this.currentTrick]);
        this.currentTrick = [];
        this.currentPlayer = winner;
        this.trickLeader = null;
        
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
        
        // Validate bid before sending/processing
        if (!this.isValidBid(bidString)) {
            alert('Invalid bid. Bid must be higher than the last bid.');
            return false;
        }
        
        // If connected to server, send bid to server
        if (this.connection && this.connection.readyState === WebSocket.OPEN) {
            this.sendToServer({
                type: 'bid',
                bid: bidString
            });
            return true;
        }
        
        // Local game logic (for single player mode)
        const bidInfo = this.getBidValue(bidString);
        const bid = {
            player: this.currentPlayer,
            bid: bidString,
            level: bidInfo.level,
            suit: bidInfo.suit
        };
        
        this.bids.push(bid);
        this.updateBidHistory();
        
        if (bidString !== 'pass' && bidString !== 'double' && bidString !== 'redouble') {
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

        // Issue report button
        document.getElementById('issue-report').addEventListener('click', () => {
            this.showIssueReport();
        });

        // Chat functionality
        document.getElementById('send-chat').addEventListener('click', () => {
            this.sendChatMessage();
        });

        document.getElementById('chat-input').addEventListener('keypress', (e) => {
            if (e.key === 'Enter') {
                this.sendChatMessage();
            }
        });

        // Copy link button
        document.getElementById('copy-link').addEventListener('click', () => {
            this.copyShareableLink();
        });

        // Settings button
        document.getElementById('settings').addEventListener('click', () => {
            this.showSettings();
        });

        // Settings modal close button
        document.getElementById('close-settings').addEventListener('click', () => {
            this.hideSettings();
        });

        // Color selection buttons
        document.querySelectorAll('.color-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                this.changeBackgroundColor(e.target.dataset.color);
            });
        });

        // Save name button
        document.getElementById('save-name').addEventListener('click', () => {
            this.savePlayerName();
        });

        // Close modal when clicking outside
        document.getElementById('settings-modal').addEventListener('click', (e) => {
            if (e.target.id === 'settings-modal') {
                this.hideSettings();
            }
        });

        // Card click handlers will be added dynamically
    }

    updateUI() {
        // Update game phase
        document.getElementById('game-phase').textContent = this.getPhaseText();
        
        // Update current player with enhanced display
        this.updateCurrentPlayerDisplay();
        
        // Update cards display
        this.displayCards();
        
        // Update controls
        this.updateControls();
        
        // Update score
        this.updateScore();
        
        // Update trick leader display
        this.updateTrickLeaderDisplay();
        
        // Update trump display
        this.updateTrumpDisplay();
        
        // Update chat status
        this.updateChatStatus();
    }

    getPhaseText() {
        switch (this.gamePhase) {
            case 'waiting': return 'Waiting for game to start';
            case 'bidding': return 'Bidding phase';
            case 'playing': return 'Playing cards';
            case 'finished': return this.getWinningTeamText();
            default: return 'Unknown phase';
        }
    }
    
    getWinningTeamText() {
        const nsScore = this.tricksWon.ns;
        const ewScore = this.tricksWon.ew;
        
        let winningTeam = '';
        let winningPlayers = '';
        
        if (this.contract) {
            const needed = 6 + this.contract.level;
            const declarerTeam = (this.declarer === 'north' || this.declarer === 'south') ? 'ns' : 'ew';
            const made = declarerTeam === 'ns' ? nsScore : ewScore;
            
            if (made >= needed) {
                winningTeam = declarerTeam;
            } else {
                winningTeam = declarerTeam === 'ns' ? 'ew' : 'ns';
            }
        } else {
            // No contract, highest score wins
            if (nsScore > ewScore) {
                winningTeam = 'ns';
            } else if (ewScore > nsScore) {
                winningTeam = 'ew';
            } else {
                return 'Game finished - Tie!';
            }
        }
        
        // Get winning players
        if (winningTeam === 'ns') {
            const northName = this.playerNames.north || 'North';
            const southName = this.playerNames.south || 'South';
            winningPlayers = `${northName} & ${southName}`;
        } else {
            const eastName = this.playerNames.east || 'East';
            const westName = this.playerNames.west || 'West';
            winningPlayers = `${eastName} & ${westName}`;
        }
        
        return `Winners: ${winningPlayers}`;
    }
    
    updateCurrentPlayerDisplay() {
        const currentPlayerEl = document.getElementById('current-player');
        
        // Remove previous player highlights
        document.querySelectorAll('.current-player-highlight').forEach(el => {
            el.classList.remove('current-player-highlight');
        });
        
        if (this.gamePhase === 'playing' || this.gamePhase === 'bidding') {
            const playerName = this.playerNames[this.currentPlayer] || 'Unknown';
            const position = this.currentPlayer.charAt(0).toUpperCase() + this.currentPlayer.slice(1);
            currentPlayerEl.textContent = `${position} (${playerName}) is ${this.gamePhase === 'playing' ? 'playing card' : 'bidding'}`;
            
            // Highlight current player's area
            const relativePosition = this.getRelativePosition(this.currentPlayer);
            const playerNameDisplay = document.getElementById(`${relativePosition}-name`);
            if (playerNameDisplay) {
                playerNameDisplay.classList.add('current-player-highlight');
            }
        } else {
            currentPlayerEl.textContent = '';
        }
    }
    
    updateTrickLeaderDisplay() {
        // Clear any existing trick leader indicators
        document.querySelectorAll('.trick-leader-indicator').forEach(el => el.remove());
        
        if (this.trickLeader && this.gamePhase === 'playing') {
            const relativePosition = this.getRelativePosition(this.trickLeader);
            const playerArea = document.querySelector(`.${relativePosition}-player`);
            
            if (playerArea) {
                const indicator = document.createElement('div');
                indicator.className = 'trick-leader-indicator';
                indicator.textContent = '🃏 Led this trick';
                indicator.style.cssText = `
                    position: absolute;
                    top: -25px;
                    left: 50%;
                    transform: translateX(-50%);
                    background: #ff9800;
                    color: white;
                    padding: 2px 8px;
                    border-radius: 10px;
                    font-size: 12px;
                    font-weight: bold;
                    white-space: nowrap;
                    z-index: 10;
                `;
                playerArea.style.position = 'relative';
                playerArea.appendChild(indicator);
            }
        }
    }
    
    updateTrumpDisplay() {
        const trumpElement = document.getElementById('trump-suit');
        if (this.contract && this.contract.suit) {
            const suitSymbols = {
                'c': '♣',
                'd': '♦', 
                'h': '♥',
                's': '♠'
            };
            const trumpSymbol = suitSymbols[this.contract.suit] || this.contract.suit;
            trumpElement.textContent = trumpSymbol;
            trumpElement.style.color = (this.contract.suit === 'h' || this.contract.suit === 'd') ? '#d32f2f' : '#000';
        } else {
            trumpElement.textContent = 'None';
            trumpElement.style.color = '#666';
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
                    
                    // Only add to container if cardElement is not null
                    if (cardElement) {
                        // Only make player's own cards clickable
                        const playerPosition = this.playerId || 'south';
                        if (actualPosition === playerPosition) {
                            cardElement.addEventListener('click', () => {
                                if (this.gamePhase === 'playing' && this.currentPlayer === playerPosition) {
                                    if (this.playCard(card, playerPosition)) {
                                        // Refresh the entire display instead of just removing the element
                                        this.displayCards();
                                    }
                                }
                            });
                        }
                        
                        container.appendChild(cardElement);
                    }
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
            // Don't show card backs for other players - return null
            return null;
        }
        
        return cardDiv;
    }

    displayPlayedCard(card, player) {
        const relativePosition = this.getRelativePosition(player);
        const container = document.getElementById(`${relativePosition}-played`);
        container.innerHTML = '';
        
        const cardElement = this.createCardElement(card, 'played');
        container.appendChild(cardElement);
    }

    clearPlayedCards() {
        ['north', 'east', 'south', 'west'].forEach(position => {
            const relativePosition = this.getRelativePosition(position);
            document.getElementById(`${relativePosition}-played`).innerHTML = '';
        });
    }

    updateControls() {
        const startBtn = document.getElementById('start-game');
        const newGameBtn = document.getElementById('new-game');
        const connectBtn = document.getElementById('connect');
        const biddingArea = document.getElementById('bidding-area');
        
        // Hide/show buttons based on game phase
        if (this.gamePhase === 'waiting') {
            startBtn.style.display = 'inline-block';
            newGameBtn.style.display = 'inline-block';
            connectBtn.style.display = 'inline-block';
            // Only enable start button if room is full (4 players)
            startBtn.disabled = this.playersCount < 4;
            if (this.playersCount < 4) {
                startBtn.textContent = `Start Game (${this.playersCount}/4)`;
                startBtn.title = 'Need 4 players to start the game';
            } else {
                startBtn.textContent = 'Start Game';
                startBtn.title = 'All players ready! Click to start the game';
            }
        } else if (this.gamePhase === 'bidding' || this.gamePhase === 'playing') {
            startBtn.style.display = 'none';
            connectBtn.style.display = 'none';
            newGameBtn.style.display = 'inline-block';
            newGameBtn.disabled = false;
        } else {
            startBtn.style.display = 'inline-block';
            newGameBtn.style.display = 'inline-block';
            connectBtn.style.display = 'inline-block';
            startBtn.disabled = this.gamePhase !== 'waiting' || this.playersCount < 4;
            if (this.playersCount < 4) {
                startBtn.textContent = `Start Game (${this.playersCount}/4)`;
                startBtn.title = 'Need 4 players to start the game';
            } else {
                startBtn.textContent = 'Start Game';
                startBtn.title = 'All players ready! Click to start the game';
            }
        }
        
        biddingArea.style.display = this.gamePhase === 'bidding' ? 'block' : 'none';
        
        // Enable/disable bid buttons based on validity
        this.updateBidButtons();
    }

    updateBidButtons() {
        const playerPosition = this.playerId || 'south';
        const isBiddingPhase = this.gamePhase === 'bidding';
        const isPlayerTurn = this.currentPlayer === playerPosition;
        
        document.querySelectorAll('.bid-btn').forEach(btn => {
            const bidString = btn.dataset.bid;
            
            if (!isBiddingPhase || !isPlayerTurn) {
                btn.disabled = true;
            } else {
                const isValid = this.isValidBid(bidString);
                btn.disabled = !isValid;
                
                // Add visual styling for invalid bids
                if (isValid) {
                    btn.classList.remove('invalid');
                } else {
                    btn.classList.add('invalid');
                }
            }
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
        let winningTeam = '';
        let winningPlayers = '';
        let winReason = '';
        
        if (this.contract) {
            const needed = 6 + this.contract.level;
            const declarerTeam = (this.declarer === 'north' || this.declarer === 'south') ? 'ns' : 'ew';
            const made = declarerTeam === 'ns' ? nsScore : ewScore;
            
            if (made >= needed) {
                winningTeam = declarerTeam;
                const overtricks = made - needed;
                result = `Contract made! ${this.contract.level}${this.getSuitSymbol(this.contract.suit)} by ${this.declarer}`;
                winReason = overtricks > 0 ? `Made with ${overtricks} overtrick${overtricks > 1 ? 's' : ''}` : 'Made exactly';
            } else {
                winningTeam = declarerTeam === 'ns' ? 'ew' : 'ns';
                const down = needed - made;
                result = `Contract failed. Down ${down}`;
                winReason = `Defeated the contract by ${down} trick${down > 1 ? 's' : ''}`;
            }
        } else {
            // No contract, highest score wins
            if (nsScore > ewScore) {
                winningTeam = 'ns';
                winReason = `Won by ${nsScore - ewScore} trick${nsScore - ewScore > 1 ? 's' : ''}`;
            } else if (ewScore > nsScore) {
                winningTeam = 'ew';
                winReason = `Won by ${ewScore - nsScore} trick${ewScore - nsScore > 1 ? 's' : ''}`;
            } else {
                result = 'Game ended in a tie!';
                winReason = 'Both teams scored equally';
                const finalResult = `${result}\n\n${winReason}\nFinal Score - NS: ${nsScore}, EW: ${ewScore}`;
                alert(finalResult);
                return;
            }
            result = 'Game completed';
        }
        
        // Get winning players
        if (winningTeam === 'ns') {
            const northName = this.playerNames.north || 'North';
            const southName = this.playerNames.south || 'South';
            winningPlayers = `${northName} (North) and ${southName} (South)`;
        } else {
            const eastName = this.playerNames.east || 'East';
            const westName = this.playerNames.west || 'West';
            winningPlayers = `${eastName} (East) and ${westName} (West)`;
        }
        
        const finalResult = `🎉 GAME OVER 🎉\n\n${result}\n\nWINNERS: ${winningPlayers}\nReason: ${winReason}\n\nFinal Score - NS: ${nsScore}, EW: ${ewScore}`;
        alert(finalResult);
    }
    
    getSuitSymbol(suit) {
        const symbols = {
            'c': '♣',
            'd': '♦',
            'h': '♥',
            's': '♠'
        };
        return symbols[suit] || suit;
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
        this.trickLeader = null;
        // Don't reset playersCount as it should persist between games
        
        for (let player in this.players) {
            this.players[player] = [];
        }
        
        this.clearPlayedCards();
        this.updateUI();
        document.getElementById('bid-history').innerHTML = '';
        
        // Reset trump display
        document.getElementById('trump-suit').textContent = 'None';
        document.getElementById('trump-suit').style.color = '#666';
        
        // Reset score display
        this.updateScore();
    }

    connectToGame() {
        const savedName = localStorage.getItem('bridgePlayerName');
        const playerName = savedName || prompt('Enter your name:');
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
                this.playersCount = data.playersCount;
                if (data.playerNames) {
                    this.playerNames = data.playerNames;
                }
                document.getElementById('room-code').textContent = data.roomCode;
                document.getElementById('current-player').textContent = `${data.position} (${data.playersCount}/4)`;
                this.updatePlayerNames();
                
                // Update URL with room code
                this.updateUrlWithRoomCode(data.roomCode);
                
                // Update UI to show chat now that we have a room
                this.updateUI();
                
                // Show welcome message in chat
                this.addSystemMessage(`Welcome to the room! You are ${data.position.charAt(0).toUpperCase() + data.position.slice(1)}.`);
                break;
                
            case 'player_joined':
                this.playersCount = data.playersCount;
                if (data.playerNames) {
                    this.playerNames = data.playerNames;
                }
                this.updatePlayerNames();
                this.updateUI(); // Update start button state
                
                // Show join message in chat
                this.addSystemMessage(`${data.player.name} joined as ${data.player.position.charAt(0).toUpperCase() + data.player.position.slice(1)}`);
                break;
                
            case 'room_full':
                this.addSystemMessage(data.message);
                break;
                
            case 'game_state':
                // Check if game is starting
                if (this.gamePhase === 'waiting' && data.gameState.phase !== 'waiting') {
                    this.addSystemMessage('Game is starting! Chat is now disabled.');
                }
                this.updateFromServerState(data.gameState);
                break;
                
            case 'player_left':
                this.playersCount = data.playersCount;
                if (data.playerNames) {
                    this.playerNames = data.playerNames;
                }
                this.updatePlayerNames();
                this.updateUI(); // Update start button state
                
                // Show leave message in chat
                this.addSystemMessage(`${data.player.name} left the game`);
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
                
            case 'chat_message':
                this.addChatMessage(data.sender, data.message);
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
        this.trickLeader = gameState.trickLeader;
        
        // Update player names if provided
        if (gameState.playerNames) {
            this.playerNames = gameState.playerNames;
        }
        
        // Update player hands
        if (gameState.playerHand) {
            this.players[this.playerId] = gameState.playerHand;
        }
        
        // Update other players' card counts (don't create fake cards)
        Object.keys(gameState.hands).forEach(position => {
            if (position !== this.playerId) {
                const cardCount = gameState.hands[position].length;
                // Just store the count, don't create fake card objects
                this.playerCardCounts = this.playerCardCounts || {};
                this.playerCardCounts[position] = cardCount;
                // Clear other players' cards since we don't show them
                this.players[position] = [];
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
                
                // Update label to show ACTUAL position (not relative)
                if (labelElement) {
                    const isYou = position === this.playerId;
                    const actualDirection = position.charAt(0).toUpperCase() + position.slice(1);
                    labelElement.textContent = isYou ? `${actualDirection} (You)` : actualDirection;
                }
            }
        });
        
        // Update position controls
        this.updatePositionControls();
    }

    updatePositionControls() {
        const positionControls = document.getElementById('position-controls');
        const positionButtons = document.querySelectorAll('.position-btn');
        
        // Hide position controls during bidding, playing, or finished phases
        if (this.gamePhase !== 'waiting') {
            positionControls.style.display = 'none';
            return;
        }
        
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

    showIssueReport() {
        const message = `If you encounter any issues or have suggestions, please contact us at:

📧 Email: yiy26063@gmail.com

Please include:
• Description of the issue
• Steps to reproduce (if applicable)
• Browser and device information
• Room code (if in a game)

Thank you for helping us improve the game!`;
        
        alert(message);
    }

    updateChatStatus() {
        const chatSection = document.getElementById('chat-section');
        const chatInput = document.getElementById('chat-input');
        const sendButton = document.getElementById('send-chat');
        const chatStatus = document.getElementById('chat-status');
        
        if (this.connection && this.connection.readyState === WebSocket.OPEN && this.roomCode) {
            if (this.gamePhase === 'waiting') {
                chatSection.style.display = 'block';
                chatInput.disabled = false;
                sendButton.disabled = false;
                chatStatus.textContent = 'Chat available until game starts';
                chatStatus.classList.remove('disabled');
            } else if (this.gamePhase === 'finished') {
                chatSection.style.display = 'block';
                chatInput.disabled = false;
                sendButton.disabled = false;
                chatStatus.textContent = 'Game finished - Chat available';
                chatStatus.classList.remove('disabled');
            } else {
                chatSection.style.display = 'none';
            }
        } else {
            chatSection.style.display = 'none';
        }
    }

    sendChatMessage() {
        const chatInput = document.getElementById('chat-input');
        const message = chatInput.value.trim();
        
        if (!message || (this.gamePhase !== 'waiting' && this.gamePhase !== 'finished')) return;
        
        if (this.connection && this.connection.readyState === WebSocket.OPEN) {
            this.sendToServer({
                type: 'chat_message',
                message: message
            });
            chatInput.value = '';
        } else {
            // Local message for testing
            this.addChatMessage('You', message);
            chatInput.value = '';
        }
    }

    addChatMessage(sender, text) {
        const chatMessages = document.getElementById('chat-messages');
        const messageDiv = document.createElement('div');
        messageDiv.className = 'chat-message';
        
        const timestamp = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        
        messageDiv.innerHTML = `
            <div class="sender">${sender}</div>
            <div class="text">${text}</div>
            <div class="timestamp">${timestamp}</div>
        `;
        
        chatMessages.appendChild(messageDiv);
        chatMessages.scrollTop = chatMessages.scrollHeight;
    }

    addSystemMessage(text) {
        const chatMessages = document.getElementById('chat-messages');
        const messageDiv = document.createElement('div');
        messageDiv.className = 'chat-message system-message';
        
        const timestamp = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        
        messageDiv.innerHTML = `
            <div class="sender">System</div>
            <div class="text">${text}</div>
            <div class="timestamp">${timestamp}</div>
        `;
        
        chatMessages.appendChild(messageDiv);
        chatMessages.scrollTop = chatMessages.scrollHeight;
    }

    checkUrlForRoomCode() {
        const urlParams = new URLSearchParams(window.location.search);
        const roomCode = urlParams.get('room');
        
        if (roomCode) {
            // Auto-prompt for player name and join room
            setTimeout(() => {
                const playerName = prompt(`Join room ${roomCode}. Enter your name:`);
                if (playerName) {
                    this.autoJoinRoom(roomCode, playerName);
                }
            }, 500);
        }
    }

    autoJoinRoom(roomCode, playerName) {
        const wsUrl = window.location.protocol === 'https:' ? 'wss://' : 'ws://';
        const wsHost = window.location.host || 'localhost:3000';
        this.connection = new WebSocket(wsUrl + wsHost);
        
        this.connection.onopen = () => {
            document.getElementById('connection-status').textContent = 'Connected';
            document.getElementById('connection-status').className = 'connected';
            
            this.connection.send(JSON.stringify({
                type: 'join_room',
                roomCode: roomCode,
                playerName: playerName
            }));
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

    updateUrlWithRoomCode(roomCode) {
        const newUrl = `${window.location.origin}${window.location.pathname}?room=${roomCode}`;
        window.history.pushState({ roomCode }, `Bridge Game - Room ${roomCode}`, newUrl);
        
        // Show shareable link
        this.showShareableLink(newUrl);
    }

    showShareableLink(url) {
        const linkElement = document.getElementById('shareable-link');
        const containerElement = document.getElementById('shareable-link-container');
        
        if (linkElement && containerElement) {
            linkElement.textContent = url;
            containerElement.style.display = 'block';
            this.shareableUrl = url; // Store for copying
        }
    }

    copyShareableLink() {
        if (this.shareableUrl) {
            navigator.clipboard.writeText(this.shareableUrl).then(() => {
                const copyBtn = document.getElementById('copy-link');
                const originalText = copyBtn.textContent;
                copyBtn.textContent = '✓';
                copyBtn.style.background = '#27ae60';
                
                setTimeout(() => {
                    copyBtn.textContent = originalText;
                    copyBtn.style.background = '#16a085';
                }, 2000);
            }).catch(() => {
                // Fallback for older browsers
                const textArea = document.createElement('textarea');
                textArea.value = this.shareableUrl;
                document.body.appendChild(textArea);
                textArea.select();
                document.execCommand('copy');
                document.body.removeChild(textArea);
                
                alert('Link copied to clipboard!');
            });
        }
    }

    // Settings functionality
    showSettings() {
        const modal = document.getElementById('settings-modal');
        modal.style.display = 'block';
        
        // Load current settings
        this.loadCurrentSettings();
    }

    hideSettings() {
        const modal = document.getElementById('settings-modal');
        modal.style.display = 'none';
    }

    loadCurrentSettings() {
        // Load saved background color
        const savedColor = localStorage.getItem('bridgeBackgroundColor') || '#FFC1E0';
        document.querySelectorAll('.color-btn').forEach(btn => {
            btn.classList.remove('selected');
            if (btn.dataset.color === savedColor) {
                btn.classList.add('selected');
            }
        });

        // Load saved player name
        const savedName = localStorage.getItem('bridgePlayerName') || '';
        document.getElementById('player-name-input').value = savedName;
    }

    changeBackgroundColor(color) {
        document.body.style.background = color;
        localStorage.setItem('bridgeBackgroundColor', color);
        
        // Update button selection
        document.querySelectorAll('.color-btn').forEach(btn => {
            btn.classList.remove('selected');
            if (btn.dataset.color === color) {
                btn.classList.add('selected');
            }
        });
    }

    savePlayerName() {
        const nameInput = document.getElementById('player-name-input');
        const newName = nameInput.value.trim();
        
        if (!newName) {
            alert('Please enter a valid name');
            return;
        }
        
        if (newName.length > 20) {
            alert('Name must be 20 characters or less');
            return;
        }
        
        localStorage.setItem('bridgePlayerName', newName);
        
        // Update current player name if connected
        if (this.connection && this.connection.readyState === WebSocket.OPEN) {
            // Update the displayed name
            const playerPosition = this.playerId;
            if (playerPosition) {
                this.playerNames[playerPosition] = newName;
                this.updatePlayerNames();
            }
        }
        
        alert('Name saved successfully!');
        this.hideSettings();
    }

    // Load settings on initialization
    loadSavedSettings() {
        // Load background color
        const savedColor = localStorage.getItem('bridgeBackgroundColor');
        if (savedColor) {
            document.body.style.background = savedColor;
        }
        
        // Load player name
        const savedName = localStorage.getItem('bridgePlayerName');
        if (savedName) {
            // Will be used when connecting to games
        }
    }
}

// Initialize the game when the page loads
document.addEventListener('DOMContentLoaded', () => {
    const game = new BridgeGame();
    
    // Make game globally accessible for debugging
    window.bridgeGame = game;
    
    // Check for room code in URL and auto-join
    game.checkUrlForRoomCode();
});