const WebSocket = require('ws');
const http = require('http');
const fs = require('fs');
const path = require('path');

const server = http.createServer((req, res) => {
    // Health check
    if (req.url === '/health') {
        res.writeHead(200, { 'Content-Type': 'text/plain' });
        res.end('OK');
        return;
    }
    
    let filePath = req.url === '/' ? '/index.html' : req.url;
    const extname = path.extname(filePath);
    
    const mimeTypes = {
        '.html': 'text/html',
        '.css': 'text/css',
        '.js': 'text/javascript'
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
});

const wss = new WebSocket.Server({ server });

wss.on('connection', (ws) => {
    console.log('Client connected');
    
    ws.on('message', (message) => {
        console.log('Message received:', message.toString());
        // Echo back for testing
        ws.send(`Echo: ${message}`);
    });
    
    ws.on('close', () => {
        console.log('Client disconnected');
    });
});

const port = process.env.PORT || 3000;
console.log(`Starting simple server on port ${port}...`);

server.listen(port, '0.0.0.0', () => {
    console.log(`✅ Simple server running on port ${port}`);
});

server.on('error', (error) => {
    console.error('❌ Server error:', error);
});