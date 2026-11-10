# 🤖 LP Bot — Personal Telegram & VK Userbot

[![Node.js Version](https://img.shields.io/badge/node-%3E%3D18.0.0-brightgreen.svg)](https://nodejs.org/)
[![License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Platform](https://img.shields.io/badge/platform-Windows%20%7C%20Linux-lightgrey.svg)]()

> 📖 **Language versions**: [Русский (README.md)](README.md) | **English**

---

## 📌 Table of Contents
1. [What is LP Bot and Why Do You Need It?](#1-what-is-lp-bot-and-why-do-you-need-it)
2. [Quick Start & Launch](#2-quick-start--launch)
   - [Option A: Portable Launch via Batch Scripts (.bat)](#option-a-portable-launch-via-batch-scripts-bat)
   - [Option B: Standalone Release Executable (.exe)](#option-b-standalone-release-executable-exe)
3. [How to Get Telegram API ID and API Hash](#3-how-to-get-telegram-api-id-and-api-hash)
4. [Connecting VK (Token & SSH Tunnel)](#4-connecting-vk-token--ssh-tunnel)
5. [Interface: Web Panel, GUI, and Command Prefix Setup](#5-interface-web-panel-gui-and-command-prefix-setup)
6. [Security and Sensitive Files](#6-security-and-sensitive-files)

---

## 1. What is LP Bot and Why Do You Need It?

**LP Bot** (Long Poll Userbot) is your personal automation assistant running directly from your personal **Telegram** and **VK (VKontakte)** accounts.

Unlike standard Telegram bots that require a separate `@bot` username and can only operate when invited to groups or messaged directly, a userbot turns your existing personal account into an automated powerhouse:

* ⚡ **Instant In-Chat Commands**: Execute dozens of utility commands in any chat or dialogue (ping test, chat analytics, message deletion, QR codes, calculator, and more).
* 📝 **Automated Triggers**: The bot automatically replies with customized answers when trigger words are detected in incoming messages.
* 📁 **Reusable Message Templates**: Save lengthy text guides, links, or media messages and send them in one click or with a short alias (e.g., `.template price`).
* 🤖 **DeepSeek AI Integration**: Connect cutting-edge LLMs (DeepSeek Chat / Coder) to answer questions, brainstorm, or assist you directly inside your chat threads.
* 🖥️ **Dual Control Interfaces**: Manage everything through a sleek desktop application (Electron GUI) or an in-browser Web Control Panel with live graphs and toggle switches.
* 🔒 **100% Privacy & Local Storage**: Everything runs locally on your computer. Your chat history, credentials, and session files are stored in a local SQLite database and are never sent to external third-party servers.

---

## 2. Quick Start & Launch

### Prerequisites:
* A PC running **Windows 10/11** (or Linux/macOS).
* **Node.js** (version 18 LTS or later) installed — download it for free from [nodejs.org](https://nodejs.org/).
* Your Telegram developer credentials (`api_id` and `api_hash`) — [how to get them in 2 minutes](#3-how-to-get-telegram-api-id-and-api-hash).

---

### Option A: Portable Launch via Batch Scripts (.bat)

Ideal when running from source code or an unzipped folder.

#### Step 1. Install Dependencies
Open the project directory, hold `Shift`, right-click on an empty area, and select **"Open PowerShell window here"** (or open Windows Terminal).

Run:
```bash
npm install
```
This downloads all necessary modules for the bot core and the Electron GUI.

#### Step 2. Prepare Configuration Files
Copy the sample configuration templates:
```cmd
copy config.example.json config.json
copy settings.example.json settings.json
```
Open `config.json` with Notepad and enter your `telegramApiId` and `telegramApiHash` ([see instructions below](#3-how-to-get-telegram-api-id-and-api-hash)).

#### Step 3. First-Time Launch & Authorization (Console Required!)
> [!IMPORTANT]
> **Your initial login must be completed in the terminal!** The bot needs to prompt you for your phone number, the Telegram login code, and your 2FA password. The desktop GUI cannot handle this initial standard input.

Run:
```cmd
start.bat
```
*(Or run `npm start` in your terminal)*.

1. The terminal will ask for your phone number: enter it in international format (e.g., `+1234567890`).
2. Telegram will send an official service message containing your login code: enter it into the terminal.
3. If two-step verification (2FA cloud password) is enabled on your account, enter your password.
4. Upon successful authorization, the bot generates a `session.txt` file. All future starts will connect automatically without prompting!

#### Step 4. Launching the Desktop Window (GUI)
Once the login session is established, you can start the desktop dashboard:
```cmd
gui\start_gui.bat
```
This brings up the Electron interface with **"Start Bot"** / **"Stop"** buttons, RAM and uptime graphs, Telegram/VK status badges, and real-time logs.

---

### Option B: Standalone Release Executable (.exe)

If you downloaded a pre-compiled standalone release (`lpbot.exe`):

1. Place `lpbot.exe` in a dedicated directory (e.g., `C:\LP-bot`).
2. In the same folder, ensure `config.json` (with your `telegramApiId` and `telegramApiHash`) and `settings.json` are present.
3. **First-time login**: Open a terminal in that folder and run:
   ```cmd
   lpbot.exe --console
   ```
   Follow the prompts to enter your phone number and SMS/Telegram code to generate `session.txt`.
4. **Routine usage**: Double-click `lpbot.exe`.
   - The desktop window opens automatically.
   - A system tray icon appears in the Windows taskbar.
   - Closing the window minimizes the bot to the tray. To terminate the bot completely, right-click the tray icon and choose **"Quit"**.

---

## 3. How to Get Telegram API ID and API Hash

Telegram allows user applications to connect securely via their official MTProto protocol. Obtaining your developer keys takes less than 2 minutes:

1. Open your web browser and go to the official Telegram developer portal: [https://my.telegram.org](https://my.telegram.org).
2. Under **Phone number**, type your Telegram account phone number in full international format (e.g., `+1234567890`) and click **Next**.
3. Check your Telegram app for a confirmation message from Telegram containing a code. Copy it, paste it into the **Confirmation code** box on the web page, and click **Sign In**.
4. In the menu that appears, click on **"API development tools"**.
5. If creating an app for the first time, fill out the simple registration form:
   * **App title**: Any name you prefer (e.g., `MyUserbotClient`).
   * **Short name**: A short alphanumeric string (e.g., `myuserbot`).
   * **Platform**: Select `Desktop` or `Other`.
   * Click **Create application** (or "Save changes").
6. You will see your credentials:
   * `App api_id`: An integer (e.g., `12345678`).
   * `App api_hash`: A 32-character hexadecimal string (e.g., `0123456789abcdef0123456789abcdef`).
7. Open `config.json` in your bot folder and paste your values:
   ```json
   {
     "telegramApiId": 12345678,
     "telegramApiHash": "0123456789abcdef0123456789abcdef",
     "panelHost": "127.0.0.1",
     "panelPort": 3005
   }
   ```
8. Save the file (`Ctrl+S`).

> [!CAUTION]
> **Never share your `api_hash` or `session.txt` with anyone!** They grant direct access to your Telegram account.

---

## 4. Connecting VK (Token & SSH Tunnel)

LP Bot can seamlessly bridge and operate across both Telegram and VKontakte simultaneously.

### 4.1. Obtaining Your VK User Token
The VK client requires an authorized user access token with permissions for messages (`messages`, `offline`).

1. Obtain your user token through a verified OAuth helper or standard mobile client token generator (the token starts with `vk1.a...`).
2. Provide the token using one of two methods:
   * **Method 1 (Recommended)**: Set it in `config.json` inside the `"vk"` section:
     ```json
     "vk": {
       "userToken": "vk1.a.your_token_here",
       "proxy": "socks5h://127.0.0.1:1080",
       "prefix": "*",
       "trustedIds": [12345678]
     }
     ```
   * **Method 2**: Set an environment variable prior to running:
     ```cmd
     set VK_USER_TOKEN=vk1.a.your_token_here
     ```
3. If no VK token is specified, the VK client remains safely disabled while Telegram continues working normally.

### 4.2. Why Use an SSH Tunnel?
VK security systems tie active sessions to your home IP address. If your bot runs on a remote cloud server (VPS/VDS), VK may trigger captcha verification (code 14) or temporarily freeze the session due to foreign IP changes.

To prevent this, LP Bot includes a secure reverse tunnel tool (`tools/vk_tunnel.py`):
```
[Bot on Server] ──> SOCKS5 (127.0.0.1:1080) ──> [SSH Tunnel] ──> [Your Home PC] ──> [VK Servers]
```
* **Fail-Closed Protection**: VK traffic routes strictly through the local proxy `127.0.0.1:1080`. If the tunnel connection drops, the bot immediately halts outbound VK requests rather than risking a direct connection that could compromise your token.
* **Strict Whitelist**: Only legitimate VK domains (`*.vk.com`, `*.vk.ru`, `*.userapi.com`) on port 443 are routed through the tunnel.

---

## 5. Interface: Web Panel, GUI, and Command Prefix Setup

### 5.1. Desktop Application (Electron GUI)
Launch via `gui\start_gui.bat` or by clicking `lpbot.exe`.
* **Zero External Dependencies**: The GUI uses a self-contained local SVG icon sprite (6.1 KB) and requires no external CDNs or web fonts.
* **4-Color Status Lights**:
  * 🟢 **Green** — Connected & processing updates.
  * 🟡 **Yellow** — Reconnecting or temporary anti-captcha backoff.
  * 🔴 **Red** — Network error or tunnel dropped.
  * ⚪ **Gray** — Module disabled (e.g., VK token not set).

---

### 5.2. Web Control Panel (Port 3005)
The web interface launches automatically whenever the bot runs. Open any browser and navigate to:
👉 **[http://127.0.0.1:3005](http://127.0.0.1:3005)**

#### Panel Sections:
| Section | Description |
|---|---|
| 📊 **Dashboard (`/`)** | Live overview: bot status, memory usage, uptime, VK Long Poll status |
| ⚙️ **Settings (`/settings`)** | Command prefix, auto-read mentions, auto-status, dynamic cover |
| 🔔 **Triggers (`/triggers`)** | Add auto-reply phrases and configure bot response variations |
| 📁 **Templates (`/templates`)** | View and manage pre-saved message snippets and media templates |
| 🎯 **Commands (`/commands`)** | Complete searchable command reference with syntax and examples |
| 🤖 **DeepSeek AI (`/deepseek`)** | Set AI API key, switch models (`chat`/`coder`), and test connections |
| 📋 **Logs (`/logs`)** | Real-time console event stream with log-level filtering and search |
| 📈 **Statistics (`/stats`)** | Historical usage metrics, trigger activations, VK tunnel health |
| 💾 **Export (`/export`)** | Download clean JSON backups of your triggers, templates, and flags |

> [!WARNING]
> By design, the web panel does not require a password to ensure frictionless local usage and binds strictly to `127.0.0.1`. **Do not change `panelHost` to `0.0.0.0`** and never forward port 3005 to the public internet!

---

### 5.3. Setting the Command Prefix (Smart Quote Normalization)
The command prefix is the symbol preceding any bot command (e.g., `*ping` or `.help`).

1. Open the web panel at **[Settings](http://127.0.0.1:3005/settings)** (or open the "Settings" tab in the GUI).
2. In the **"Command Prefix"** field, type 1 to 3 special symbols (defaults are `*` or `‘`).
3. **Smart Quote Auto-Replacement**:
   Mobile keyboards on iOS and Android frequently replace plain single apostrophes (`'`) with curved typographic quotes (`’` or `‘`).
   LP Bot has built-in smart quote normalization: regardless of whether you type `'`, `‘`, `’`, or `ʼ`, the bot understands your command identically. No more broken commands from phone auto-correct!
4. Click **"Save Settings"**. The prefix updates immediately across both Telegram and VK without requiring a bot restart.

---

## 6. Security and Sensitive Files

All personal credentials remain securely stored in your local bot directory:

| File | Purpose | Sensitivity Level |
|---|---|---|
| `session.txt` | Telegram authorized session key | 🔴 **Strictly Secret** (never commit or share) |
| `config.json` | API ID, API Hash, VK token | 🔴 **Strictly Secret** (contains tokens) |
| `settings.json` | Prefix, preferences, DeepSeek API key | 🔴 **Strictly Secret** (contains AI key) |
| `bot_database.sqlite` | SQLite database (triggers, templates) | 🟡 **Personal Data** |
| `settings.example.json` | Safe defaults template | 🟢 Public File |
| `config.example.json` | Safe config template | 🟢 Public File |

> [!TIP]
> In-chat code inspection commands (`*код ...` in Telegram and `код показать` in VK) feature hardcoded path sanitization: any attempt to view, modify, or restore files matching credentials or database patterns is automatically rejected.

---

## 💡 Quick Start In-Chat Commands

Send these from your Telegram account in any chat:
* `*команды` — Show the full interactive command list.
* `*тест` — Test bot responsiveness and latency.
* `*триггер add hello Hello! How can I assist you?` — Set up a simple auto-reply for "hello".
* `*шаб + info` *(in reply to any message)* — Save the replied message as a template named `info`.
* `*шаб info` — Send the saved template into the chat.
* `*дип What is quantum computing?` — Ask DeepSeek AI a quick question.

---

## 📄 License
This project is licensed under the MIT License. You are free to run, modify, and customize LP Bot for personal use.
