# Deployment Guide - Bridge Card Game

To allow people outside your local network to play your bridge game, you need to deploy it to a public server. Here are several options:

## Option 1: Deploy to Heroku (Easiest)

### Step 1: Install Heroku CLI
```bash
# Install Heroku CLI (if not already installed)
# Visit: https://devcenter.heroku.com/articles/heroku-cli
```

### Step 2: Deploy to Heroku
```bash
# Login to Heroku
heroku login

# Create a new Heroku app
heroku create your-bridge-game-name

# Deploy your code
git init
git add .
git commit -m "Initial commit"
git push heroku main
```

### Step 3: Share the URL
Your game will be available at: `https://your-bridge-game-name.herokuapp.com`

## Option 2: Deploy to Railway (Simple)

1. Go to [Railway.app](https://railway.app)
2. Connect your GitHub repository
3. Deploy automatically
4. Get your public URL

## Option 3: Deploy to Render (Free)

1. Go to [Render.com](https://render.com)
2. Create a new Web Service
3. Connect your GitHub repository
4. Build Command: `npm install`
5. Start Command: `npm start`

## Option 4: Deploy to DigitalOcean App Platform

1. Go to [DigitalOcean](https://www.digitalocean.com/products/app-platform/)
2. Create new app from GitHub
3. Configure build settings
4. Deploy

## Option 5: Port Forwarding (Temporary Solution)

If you want to quickly test with friends:

### Using ngrok (Recommended for testing)
```bash
# Install ngrok
npm install -g ngrok

# Start your local server
npm start

# In another terminal, expose port 3000
ngrok http 3000
```

This gives you a temporary public URL like: `https://abc123.ngrok.io`

### Router Port Forwarding (More permanent)
1. Access your router's admin panel (usually 192.168.1.1)
2. Find "Port Forwarding" or "Virtual Servers"
3. Forward external port 3000 to your computer's IP:3000
4. Share your public IP address with friends

## Option 6: Self-Hosting on VPS

### Requirements:
- VPS with Ubuntu/Debian
- Node.js installed
- Domain name (optional)

### Steps:
```bash
# Connect to your VPS
ssh user@your-server-ip

# Install Node.js
curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
sudo apt-get install -y nodejs

# Clone/upload your game files
git clone your-repo-url
cd bridge-card-game

# Install dependencies
npm install

# Install PM2 for process management
npm install -g pm2

# Start the application
pm2 start server.js --name bridge-game

# Set up auto-restart
pm2 startup
pm2 save
```

### Optional: Set up reverse proxy with Nginx
```bash
# Install Nginx
sudo apt update
sudo apt install nginx

# Create Nginx config
sudo nano /etc/nginx/sites-available/bridge-game

# Add this configuration:
server {
    listen 80;
    server_name your-domain.com;

    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
    }
}

# Enable the site
sudo ln -s /etc/nginx/sites-available/bridge-game /etc/nginx/sites-enabled/
sudo systemctl restart nginx
```

## Option 7: Using Cloudflare Tunnel (Advanced)

1. Install Cloudflare Tunnel
2. Create a tunnel to your local server
3. Get a public URL through Cloudflare

## Recommended Approach

For **beginners**: Use Heroku or Railway - they're the simplest.
For **testing**: Use ngrok for quick temporary access.
For **production**: Use a VPS with proper domain and SSL.

## Security Considerations

When deploying publicly:
- Consider adding rate limiting
- Implement user authentication if needed
- Use HTTPS in production
- Monitor for abuse

## Sharing Your Game

Once deployed, share the URL with friends:
- They can visit the URL in their browser
- Click "Connect to Game" 
- Enter their name and room code
- Start playing bridge together!

## Troubleshooting

**Common Issues:**
- WebSocket connection fails: Check if your hosting provider supports WebSockets
- Game doesn't load: Verify all files are deployed correctly
- Players can't connect: Ensure the WebSocket URL is correct for your hosting environment

**Testing your deployment:**
1. Visit your public URL
2. Try creating a room
3. Open another browser/device and join with the room code
4. Test the full game flow