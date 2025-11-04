# Hydra HTLC Demo

> **Cross-Head HTLC (Hash Time-Locked Contract) Demo on Cardano Hydra Heads**

Demo video:
![Hydra HTLC Demo Video](https://pub-814516bdb07540dc88999a158d4f7f04.r2.dev/hydra/HTLC.mp4)

Vietnamese: [README_VI.md](./README_VI.md)

Client Screenshot:
![Hydra HTLC Demo UI](./docs/client.png)

Server Screenshot:
![Hydra HTLC Demo Server](./docs/server-demo.png)

This project demonstrates how to implement and use HTLC (Hash Time-Locked Contract) to perform atomic swaps between different Hydra Heads. It's a Layer 2 solution that enables fast and secure payments between separate payment channels.

## 🎯 Key Features

- ✅ **Cross-Head Transactions**: Transfer assets between different Hydra Heads
- 🔐 **HTLC Smart Contract**: Ensures atomic transactions (either fully successful or refunded)
- ⏱️ **Timeout Protection**: Automatic refund after lock timeout
- 🤖 **Automated Watcher**: Service that automatically monitors and processes HTLC transactions
- 🎨 **Web Interface**: User-friendly interface for interacting with HTLC

## 🏗️ Architecture

```
hydra-htlc-demo/
├── client/          # Frontend (Nuxt.js + Vue 3)
├── server/          # Backend (NestJS) - HTLC Watcher Service
├── onchain/         # Smart Contracts (Aiken)
├── infra/           # Infrastructure (Docker Compose for Hydra Nodes)
└── docs/            # Documentation
```

### Components

1. **Client (Frontend)**
   - Framework: Nuxt 3 + Vue 3
   - UI: Shadcn/ui + Tailwind CSS
   - Features: Create HTLC, Claim, Refund, Faucet

2. **Server (Backend)**
   - Framework: NestJS
   - Role: Watcher service automatically handles cross-head transactions
   - Auto-refunds timeout UTxOs every 10 seconds

3. **Onchain (Smart Contracts)**
   - Language: Aiken
   - Contract: HTLC validator with Claim/Refund logic

4. **Infrastructure**
   - 3 separate offline Hydra Heads (with 1 node each)
   - Running on Docker containers

## 📋 System Requirements

- **Node.js** >= 18
- **pnpm** (package manager)
- **Docker** and **Docker Compose**
- **Aiken** (for compiling smart contracts)

## 🚀 Installation

### 1. Clone Repository

```bash
git clone <repository-url>
cd hydra-htlc-demo
```

### 2. Install Dependencies

#### Client
```bash
cd client
pnpm install
```

#### Server
```bash
cd ../server
pnpm install
```

## 🎮 Running the Project

### Option 1: Using Scripts (Recommended)

The project provides scripts for easy execution:

```bash
# 1. Start infrastructure (Hydra Heads)
./run-infra.sh

# 2. Start server (Watcher Service)
./run-server.sh

# 3. Start client (Web UI)
./run-client.sh
```

### Option 2: Manual Step-by-Step

#### Step 1: Start Infrastructure

```bash
cd infra
docker-compose up
```

This will start 3 Hydra Heads:
- Head 1: API port `4001`, WebSocket port `5001`
- Head 2: API port `4002`, WebSocket port `5002`
- Head 3: API port `4003`, WebSocket port `5003`

#### Step 2: Start Server

```bash
cd server
pnpm install
pnpm run start:dev
```

Server will run on port `3068` (default).

#### Step 3: Start Client

```bash
cd client
pnpm install
pnpm dev
```

Client will run at `http://localhost:3000`.

## 💡 How to Use

### 1. Access Web Interface

Open browser and navigate to: `http://localhost:3000`

The interface is divided into 3 main sections:
- **Left Sidebar**: Select Hydra Head and Lightning Channels
- **Center Panel (SENDER)**: Form to create HTLC transactions
- **Right Panel (HTLC UTXOs)**: List of active HTLCs

### 2. Wallet & Balance Information

In the top right corner, you'll see:
- **Wallet Address**: Click the copy icon to copy address
- **Balance**: Current ADA balance
- **Avatar**: User icon

### 3. Select Hydra Head

In the left sidebar, select the Hydra Head you want to use:
- **Hydra Head x01** (default)
- **Hydra Head x02**
- **Hydra Head x03**

Each Head displays:
- **ID**: Unique Head ID
- **Seed**: Offline head seed

### 4. Create HTLC Transaction

In the **SENDER** panel (center screen), fill in the information:

#### a. Target Head
- Select destination Hydra Head from "Select target head" dropdown
- This is the Head you want to transfer funds to

#### b. Recipient Address
- Enter recipient wallet address
- **Paste** button available to paste from clipboard

#### c. Amount (ADA)
- Enter amount of ADA to send (default is 0)
- **Paste** button available to paste value

#### d. HTLC Timeout (minutes)
- Enter timeout in minutes (default is 60)
- After this time, HTLC can be refunded

#### e. HTLC Hashed
- Click **Generate** button to automatically create preimage and hash
- Will display 2 values:
  - **Preimage**: Original secret string (**Copy** button to copy)
  - **Hash**: Hash value of preimage (**Copy** button to copy)

#### f. Send Transaction
- Click purple **SEND** button at the bottom of form
- Wait for transaction to be processed

> **💡 Tip**: Save the **Preimage** so the recipient can claim!

### 5. View HTLC UTXOs

In the **HTLC UTXOs** panel (right side), you'll see a list of HTLCs:

Each HTLC displays:
- **ID**: UTxO identifier
- **from**: Sender address (shows "you" note if it's yours)
- **to**: Recipient address
- **amount**: ADA amount
- **timeout**: Expiration time (YYYY-MM-DD HH:MM:SS)
- **hash**: Preimage hash (copy icon available)
- **remaining**: Remaining time (countdown)

Each HTLC has an orange **Refund** button if you're the sender.

### 6. Claim HTLC

To claim HTLC:
1. Click on HTLC item in the list (if you're the recipient)
2. Dialog will appear requesting **Preimage**
3. Enter preimage shared by the sender
4. Click **Claim** to receive funds
5. Transaction will be processed by Watcher Service

> **⚠️ Note**: Can only claim when:
> - You are the recipient (to address)
> - Not yet timed out
> - Preimage is correct

### 7. Refund HTLC

To refund HTLC:
1. Click orange **Refund** button on HTLC item
2. Refund only possible when:
   - You are the sender (from address)
   - Timeout has expired (remaining: 00:00:00)
3. Watcher Service also automatically refunds timeout HTLCs every 10 seconds

### 8. Lightning Channels (Optional)

In sidebar, there's a **Lightning Channels** section with channels:
- Channel 0x01
- Channel 0x02
- Channel 0x03

> **Note**: This feature can be used for advanced scenarios

## 🔍 HTLC Cross-Head Workflow

```
User A (Head 1)                Watcher Service              User B (Head 2)
     |                               |                            |
     |--1. Create HTLC-------------->|                            |
     |   (lock funds)                |                            |
     |                               |--2. Detect & Push--------->|
     |                               |   (create HTLC on Head 2)  |
     |                               |                            |
     |                               |<--3. User B Claims---------|
     |                               |   (with preimage)          |
     |<--4. Auto Claim---------------|                            |
     |   (watcher claims on Head 1)  |                            |
     |                               |                            |
```

### Detailed Flow:

1. **Lock Phase**: User A creates HTLC on Head 1
2. **Push Phase**: Watcher detects and creates corresponding HTLC on Head 2
3. **Claim Phase**: User B claims with preimage on Head 2
4. **Auto-Claim Phase**: Watcher automatically claims on Head 1 with same preimage
5. **Refund Phase** (if timeout): Watcher automatically refunds to sender

## 📝 HTLC Smart Contract

Contract written in Aiken with 2 main redeemers:

### Datum Structure

```aiken
pub type HtlcDatum {
  hash: ByteArray,        // Preimage hash
  timeout: Int,           // Timeout (POSIX timestamp)
  sender: ByteArray,      // Sender's payment key hash
  receiver: ByteArray,    // Receiver's payment key hash
}
```

### Redeemers

1. **Claim(preimage)**:
   - Checks hash(preimage) == datum.hash
   - Must be before timeout
   - Must be signed by receiver

2. **Refund**:
   - Must be after timeout
   - Must be signed by sender

## 🛠️ Tech Stack

### Frontend
- **Nuxt 3**: Vue framework
- **TypeScript**: Type-safe development
- **Shadcn/ui**: UI components
- **Tailwind CSS**: Styling
- **@hydra-sdk**: Cardano Hydra SDK
- **Pinia**: State management

### Backend
- **NestJS**: Node.js framework
- **TypeScript**: Type-safe development
- **@hydra-sdk**: Cardano Hydra SDK
- **Axios**: HTTP client
- **Blakejs**: Hashing library

### Smart Contracts
- **Aiken**: Cardano smart contract language
- **Plutus V3**: Plutus platform version

### Infrastructure
- **Docker**: Containerization
- **Hydra Node**: Cardano Hydra head protocol implementation

## 📂 Detailed Directory Structure

```
hydra-htlc-demo/
├── client/
│   ├── components/           # Vue components
│   │   ├── FormHtlcSender.vue
│   │   ├── HtlcUtxos.vue
│   │   ├── ClaimDialog.vue
│   │   └── RefundDialog.vue
│   ├── composables/         # Vue composables
│   ├── pages/               # Nuxt pages
│   ├── stores/              # Pinia stores
│   └── nuxt.config.ts
│
├── server/
│   └── src/
│       ├── hydra-htlc/     # HTLC Watcher Service
│       │   └── index.ts
│       ├── configs/         # Configuration
│       └── main.ts
│
├── onchain/
│   └── validators/
│       └── htlc.ak         # HTLC Smart Contract
│
└── infra/
    ├── docker-compose.yaml  # Hydra Nodes setup
    ├── credentials/         # Keys for Hydra Heads
    │   ├── single-head-1/
    │   └── single-head-2/
    └── protocol-parameters.json
```

## 🔧 Configuration

### Server Configuration

File: `server/src/configs/index.ts`

```typescript
export const srcHead: HydraHeadConfig = {
  name: 'single-head-1',
  httpUrl: 'http://localhost:4001',
  wsUrl: 'ws://localhost:4001',
};

export const destHead: HydraHeadConfig = {
  name: 'single-head-2', 
  httpUrl: 'http://localhost:4002',
  wsUrl: 'ws://localhost:4002',
};
```

### Client Configuration

File: `client/composables/useConfigs.ts`

Configure API endpoints and Hydra Head connections.

## 🧪 Testing

### Manual Testing Flow

1. Start all services
2. Request faucet to get test funds
3. Create HTLC transaction with 5-minute timeout
4. Observe Watcher Service automatically pushing to Head 2
5. Claim with preimage from UI
6. Verify funds have been transferred successfully

## 🐛 Troubleshooting

### Issue: Hydra Heads not starting

**Solution**: 
```bash
cd infra
docker-compose down -v
docker-compose up
```

### Issue: No UTxOs visible in client

**Solution**: 
- Check connection to Hydra WebSocket
- Refresh the page
- Check console logs

### Issue: Transaction not confirmed

**Solution**:
- Check Watcher Service logs
- Verify sufficient funds for transaction
- Check timeout hasn't expired

## 📚 References

- [Hydra SDK by VTechcom](https://hydrasdk.com) - TypeScript SDK for Cardano Hydra
- [Hydra Documentation](https://hydra.family/)
- [Aiken Language Guide](https://aiken-lang.org/)
- [Cardano Developer Portal](https://developers.cardano.org/)
- [HTLC Explained](https://en.bitcoin.it/wiki/Hash_Time_Locked_Contracts)

## 🤝 Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## 📄 License

Apache-2.0

## 👥 Authors

Vtechcom Team

---

**Note**: This is a demo project for learning and research purposes. Do not use in production without thorough security auditing.
