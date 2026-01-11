# AWS EC2 Deployment Guide for WebSocket Server

## 🛑 WHY WE ARE USING THIS GUIDE

You are using this guide because **Plivo requires a SECURE connection (wss://)**.

- **Elastic Beanstalk (Free)** only provides `ws://` (Insecure) -> Plivo hangs up.
- **Elastic Beanstalk (Paid)** provides `wss://` but costs ~$18/mo for a Load Balancer.
- **Manual EC2 (This Guide)** allows us to install **Certbot (Let's Encrypt)** for **FREE SSL**.

---

## Prerequisites

- AWS Account (free tier eligible)
- Your WebSocket server code
- Credit/Debit card for AWS verification (won't be charged if you stay in free tier)

---

## Part 1: Setting Up AWS Account

### Step 1: Create AWS Account

1. Go to <https://aws.amazon.com>
2. Click **"Create an AWS Account"**
3. Fill in:
   - Email address
   - Password
   - AWS account name
4. Choose **"Personal"** account type
5. Enter payment information (required for verification)
6. Verify your phone number
7. Choose **"Basic Support - Free"** plan

**✅ You now have an AWS account!**

---

## Part 2: Launching Your EC2 Instance

### Step 2: Access EC2 Dashboard

1. Log in to <https://console.aws.amazon.com>
2. In the search bar at top, type **"EC2"**
3. Click **"EC2"** (Virtual Servers in the Cloud)
4. Make sure you're in a region close to you (top-right corner)
   - Recommended: `ap-south-1` (Mumbai) if you are in India
   - Or `us-east-1` (N. Virginia) for general use

### Step 3: Launch Instance

1. Click the orange **"Launch Instance"** button
2. Configure as follows:

#### Name and Tags

- **Name:** `vantage-websocket-server`

#### Application and OS Images (AMI)

- **Quick Start:** Ubuntu
- **AMI:** Ubuntu Server 22.04 LTS (Free tier eligible)
- **Architecture:** 64-bit (x86)

#### Instance Type

- **Type:** `t2.micro` (Free tier eligible)
- **Details:** 1 vCPU, 1 GB RAM

#### Key Pair (Login)
>
> **IMPORTANT:** This is how you'll access your server!

1. Click **"Create new key pair"**
2. **Key pair name:** `vantage-websocket-key`
3. **Key pair type:** RSA
4. **Private key file format:**
   - **Windows:** `.ppk` (for PuTTY)
   - **Mac/Linux:** `.pem` (If using PowerShell/Terminal) -> **SELECT .PEM** (It is easier for newer Windows)
5. Click **"Create key pair"**
6. **SAVE THE DOWNLOADED FILE!** You can't download it again.
7. Move it to a safe location (e.g., `C:\Users\YourName\.ssh\` or just your Desktop for now)

#### Network Settings

Click **"Edit"** and configure:

1. **Auto-assign public IP:** Enable
2. **Firewall (Security Groups):** Create security group
3. **Security group name:** `vantage-websocket-sg`
4. **Description:** Security group for WebSocket server

**Security Group Rules:**

| Type | Protocol | Port Range | Source | Description |
|------|----------|------------|--------|-------------|
| SSH | TCP | 22 | My IP | SSH access |
| HTTP | TCP | 80 | Anywhere (0.0.0.0/0) | HTTP |
| HTTPS | TCP | 443 | Anywhere (0.0.0.0/0) | HTTPS |
| Custom TCP | TCP | 10000 | Anywhere (0.0.0.0/0) | WebSocket Port |

**How to add rules:**

1. Click **"Add security group rule"** for each rule
2. Select **Type** from dropdown
3. **Source:** Choose "My IP" for SSH, "Anywhere" for others
4. Add **Description**

#### Configure Storage

- **Size:** 8 GB (default)
- **Volume Type:** gp3 (default)

### Step 4: Launch

1. Review your configuration
2. Click **"Launch instance"**
3. Wait 1-2 minutes for instance to start
4. Click **"View all instances"**
5. Wait until **Instance State** shows **"Running"** (green dot)

**✅ Your server is now running!**

---

## Part 3: Connecting to Your Server

### Step 5: Get Connection Details

1. Select your instance (checkbox)
2. Click **"Connect"** button at top
3. Go to **"SSH client"** tab
4. Note your **Public IPv4 address** (e.g., `13.232.123.45`)

### Step 6: Connect via SSH (Windows PowerShell)

Open PowerShell and run these columns:

```powershell
# 1. Navigate to where you downloaded the key
cd C:\Users\YourName\Downloads\  # (Or wherever it is)

# 2. Connect (Replace with YOUR key name and YOUR IP)
ssh -i "vantage-websocket-key.pem" ubuntu@13.232.123.45
```

*(Type `yes` if asked about authenticity)*

**✅ You're now connected to your server!** (Prompt should change to `ubuntu@ip-...:~$`)

---

## Part 4: Installing Node.js

Copy and paste these commands into your SSH window one by one:

```bash
# 1. Update system
sudo apt update && sudo apt upgrade -y

# 2. Install Node.js 20
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs

# 3. Verify
node -v
# Should say v20.x.x
```

---

## Part 5: Uploading Your Code (SCP Method)

**Do this on your LOCAL Windows Computer (New PowerShell Window):**

1. Open a new PowerShell window (Keep the SSH one open).
2. Navigate to your project folder:
   `cd "d:\13_Projects\Portfolio Projects\Project 10 Quinite Vantage\vantage-main"`

3. Run this command to upload the `websocket-server` folder:
   *(Replace `C:\Path\To\Key.pem` and `YOUR_EC2_IP`)*

   ```powershell
   scp -i "C:\Path\To\vantage-websocket-key.pem" -r websocket-server ubuntu@YOUR_EC2_IP:~/
   ```

**Back in your SSH Window (EC2):**

```bash
# Check if it arrived
ls
# You should see 'websocket-server'

cd websocket-server

# Install dependencies
npm install
```

---

## Part 6: Configure Environment

```bash
# Create .env file
nano .env
```

**Paste your environment variables:**
*(Right-click in the terminal usually pastes)*

```env
PORT=10000
OPENAI_API_KEY=sk-proj-YOUR_KEY...
SUPABASE_URL=https://dlbxhbukzyygbabrujuv.supabase.co
SUPABASE_SERVICE_KEY=YOUR_SERVICE_KEY...
```

**Save:** Press `Ctrl+X`, then `Y`, then `Enter`.

---

## Part 7: Start Server with PM2

```bash
# Install PM2
sudo npm install -g pm2

# Start Server
pm2 start index.js --name "vantage-ws"

# Save list
pm2 save
pm2 startup
# (Run the command it gives you)
```

Your server is now running on Port 10000!

---

## Part 8: SSL Certificate (The Important Part!)

Now we convert `http://IP:10000` to `wss://your-domain.com`.

### 1. Install Nginx

```bash
sudo apt install nginx -y
```

### 2. Configure Nginx Proxy

```bash
sudo nano /etc/nginx/sites-available/default
```

**Delete everything and paste this:**

```nginx
server {
    listen 80;
    server_name _;

    location / {
        proxy_pass http://localhost:10000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
    }
}
```

**Save:** `Ctrl+X`, `Y`, `Enter`.

**Restart Nginx:**

```bash
sudo systemctl restart nginx
```

### 3. Setup SSL (Certbot) - REQUIRES A DOMAIN

**Do you have a domain?** (e.g., `api.myapp.com`)
If YES: Point the "A Record" of your domain to your EC2 IP Address.

Then run:

```bash
sudo apt install certbot python3-certbot-nginx -y
sudo certbot --nginx -d your-domain.com
```

Follow the prompts.

### ⚠️ IF YOU DO NOT HAVE A DOMAIN

You can use **Magic IP (nip.io)** to get a "fake" domain for SSL, OR use a service like No-IP.
- **Method:** Use `YOUR_IP.nip.io` (e.g., `13.232.123.45.nip.io`) as your domain name in Certbot!

```bash
# Example
sudo certbot --nginx -d 13.232.123.45.nip.io
```

---

## Part 9: Final Connection

1. **Update Local Next.js `.env`:**

    ```env
    # If using Domain:
    WS_URL=wss://your-domain.com

    # If using EC2 IP (No SSL yet - for testing):
    WS_URL=ws://YOUR_EC2_IP
    ```

2. **Restart Next.js & Test!**
