import { Server } from 'socket.io';

// In-memory storage for rooms and players
const rooms = new Map();
const players = new Map();

// Generate random room code
function generateRoomCode() {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
    let code = '';
    for (let i = 0; i < 4; i++) {
        code += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    
    // Avoid duplicates
    if (rooms.has(code)) {
        return generateRoomCode();
    }
    return code;
}

// Clean up empty rooms periodically
setInterval(() => {
    const now = Date.now();
    for (const [roomCode, room] of rooms.entries()) {
        if (room.players.length === 0 && now - (room.lastActivity || 0) > 5 * 60 * 1000) {
            rooms.delete(roomCode);
            console.log(`Cleaned up empty room: ${roomCode}`);
        }
    }
}, 60 * 1000);

export default function SocketHandler(req, res) {
    if (res.socket.server.io) {
        console.log('Socket is already running');
    } else {
        console.log('Socket is initializing');
        const io = new Server(res.socket.server, {
            path: '/api/socket.io',
            addTrailingSlash: false,
            cors: {
                origin: "*",
                methods: ["GET", "POST"]
            }
        });
        
        res.socket.server.io = io;
        
        io.on('connection', (socket) => {
            console.log('New client connected:', socket.id);
            
            // Store player information
            players.set(socket.id, {
                id: socket.id,
                name: 'Anonymous',
                room: null,
                isPlayer1: false,
                connectedAt: Date.now()
            });
            
            // Set player name
            socket.on('set_name', (data) => {
                const player = players.get(socket.id);
                if (player) {
                    player.name = data.name || 'Anonymous';
                    players.set(socket.id, player);
                    console.log(`Player ${socket.id} set name to: ${player.name}`);
                }
            });
            
            // Create a new room
            socket.on('create_room', () => {
                const player = players.get(socket.id);
                if (!player) return;
                
                const roomCode = generateRoomCode();
                
                const room = {
                    code: roomCode,
                    players: [player],
                    gameState: {
                        player1Health: 100,
                        player2Health: 100,
                        gameActive: false,
                        currentTurn: 'player1',
                        round: 1,
                        player1Wins: 0,
                        player2Wins: 0
                    },
                    createdAt: Date.now(),
                    lastActivity: Date.now()
                };
                
                rooms.set(roomCode, room);
                player.room = roomCode;
                player.isPlayer1 = true;
                players.set(socket.id, player);
                
                socket.join(roomCode);
                console.log(`Room ${roomCode} created by ${player.name}`);
                
                socket.emit('room_created', { roomCode });
                io.to(roomCode).emit('player_joined', { 
                    players: room.players,
                    playerId: socket.id
                });
            });
            
            // Join an existing room
            socket.on('join_room', (data) => {
                const player = players.get(socket.id);
                if (!player) return;
                
                const room = rooms.get(data.roomCode);
                if (!room) {
                    socket.emit('room_not_found');
                    return;
                }
                
                if (room.players.length >= 2) {
                    socket.emit('room_full');
                    return;
                }
                
                // Add player to room
                player.room = data.roomCode;
                player.isPlayer1 = false;
                players.set(socket.id, player);
                room.players.push(player);
                room.lastActivity = Date.now();
                
                socket.join(data.roomCode);
                console.log(`Player ${player.name} joined room ${data.roomCode}`);
                
                socket.emit('room_joined', { roomCode: data.roomCode });
                io.to(data.roomCode).emit('player_joined', { 
                    players: room.players,
                    playerId: socket.id
                });
            });
            
            // Leave room
            socket.on('leave_room', (data) => {
                const player = players.get(socket.id);
                if (!player || !player.room) return;
                
                const room = rooms.get(player.room);
                if (room) {
                    // Remove player from room
                    room.players = room.players.filter(p => p.id !== socket.id);
                    room.lastActivity = Date.now();
                    
                    // If room is empty, delete it
                    if (room.players.length === 0) {
                        rooms.delete(player.room);
                        console.log(`Room ${player.room} deleted (empty)`);
                    } else {
                        // Update remaining players
                        io.to(player.room).emit('player_left', { players: room.players });
                        console.log(`Player ${player.name} left room ${player.room}`);
                        
                        // Reset game if one player leaves
                        room.gameState.gameActive = false;
                        room.gameState.player1Health = 100;
                        room.gameState.player2Health = 100;
                    }
                }
                
                player.room = null;
                players.set(socket.id, player);
                socket.leave(data.roomCode);
            });
            
            // Start game
            socket.on('start_game', (data) => {
                const room = rooms.get(data.roomCode);
                if (!room || room.players.length !== 2) return;
                
                room.gameState.gameActive = true;
                room.gameState.player1Health = 100;
                room.gameState.player2Health = 100;
                room.gameState.currentTurn = 'player1';
                room.lastActivity = Date.now();
                
                console.log(`Game started in room ${data.roomCode}`);
                
                io.to(data.roomCode).emit('game_start', {
                    players: room.players,
                    gameState: room.gameState
                });
            });
            
            // Handle game actions
            socket.on('game_action', (data) => {
                const room = rooms.get(data.roomCode);
                if (!room || !room.gameState.gameActive) return;
                
                const player = players.get(socket.id);
                if (!player) return;
                
                // Determine if it's this player's turn
                const isPlayer1 = room.players[0].id === socket.id;
                const expectedTurn = isPlayer1 ? 'player1' : 'player2';
                
                if (room.gameState.currentTurn !== expectedTurn) {
                    socket.emit('error', { message: 'Not your turn!' });
                    return;
                }
                
                room.lastActivity = Date.now();
                
                // Calculate damage based on action
                let damage = 0;
                switch(data.action) {
                    case 'punch':
                        damage = Math.floor(Math.random() * 15) + 5; // 5-20 damage
                        break;
                    case 'kick':
                        damage = Math.floor(Math.random() * 20) + 10; // 10-30 damage
                        break;
                    case 'special':
                        damage = Math.floor(Math.random() * 25) + 15; // 15-40 damage
                        break;
                    default:
                        damage = 10;
                }
                
                // Apply damage
                if (data.player === 'player1') {
                    room.gameState.player2Health = Math.max(0, room.gameState.player2Health - damage);
                } else {
                    room.gameState.player1Health = Math.max(0, room.gameState.player1Health - damage);
                }
                
                // Switch turns
                room.gameState.currentTurn = data.player === 'player1' ? 'player2' : 'player1';
                
                // Broadcast action to all players in room
                io.to(data.roomCode).emit('game_action', {
                    action: data.action,
                    player: data.player,
                    damage: damage
                });
                
                // Check for winner
                let winner = null;
                if (room.gameState.player1Health <= 0) {
                    winner = 'player2';
                    room.gameState.player2Wins++;
                    room.gameState.gameActive = false;
                } else if (room.gameState.player2Health <= 0) {
                    winner = 'player1';
                    room.gameState.player1Wins++;
                    room.gameState.gameActive = false;
                }
                
                // Send game state update
                io.to(data.roomCode).emit('game_update', {
                    player1Health: room.gameState.player1Health,
                    player2Health: room.gameState.player2Health,
                    currentTurn: room.gameState.currentTurn,
                    winner: winner,
                    player1Wins: room.gameState.player1Wins,
                    player2Wins: room.gameState.player2Wins
                });
                
                if (winner) {
                    console.log(`Round ended in room ${data.roomCode}. Winner: ${winner}`);
                }
            });
            
            // Restart game
            socket.on('restart_game', (data) => {
                const room = rooms.get(data.roomCode);
                if (!room || room.players.length !== 2) return;
                
                room.gameState.player1Health = 100;
                room.gameState.player2Health = 100;
                room.gameState.gameActive = true;
                room.gameState.currentTurn = 'player1';
                room.gameState.round++;
                room.lastActivity = Date.now();
                
                console.log(`Game restarted in room ${data.roomCode}, Round ${room.gameState.round}`);
                
                io.to(data.roomCode).emit('game_start', {
                    players: room.players,
                    gameState: room.gameState
                });
            });
            
            // Handle disconnection
            socket.on('disconnect', () => {
                console.log('Client disconnected:', socket.id);
                
                const player = players.get(socket.id);
                if (player && player.room) {
                    const room = rooms.get(player.room);
                    if (room) {
                        // Remove player from room
                        room.players = room.players.filter(p => p.id !== socket.id);
                        room.lastActivity = Date.now();
                        
                        // If room is empty, delete it
                        if (room.players.length === 0) {
                            rooms.delete(player.room);
                            console.log(`Room ${player.room} deleted (empty after disconnect)`);
                        } else {
                            // Notify remaining players
                            io.to(player.room).emit('player_left', { players: room.players });
                            console.log(`Player ${player.name} disconnected from room ${player.room}`);
                            
                            // Reset game state
                            room.gameState.gameActive = false;
                        }
                    }
                }
                
                players.delete(socket.id);
            });
        });
    }
    
    res.end();
}