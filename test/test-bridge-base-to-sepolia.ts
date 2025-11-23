import { network } from "hardhat";
import { parseUnits, getAddress, type Address } from "viem";

// Official Permit2 address (same on all chains)
const PERMIT2_ADDRESS = "0x000000000022D473030F116dDEE9F6B43aC78BA3" as Address;

// Contract addresses for Base Sepolia
const BASE_SEPOLIA_VALIDATOR = process.env.BASE_VALIDATOR_ADDRESS || "0x07b091cC0eef5b03A41eB4bDD059B388cd3560D1" as Address;
const BASE_SEPOLIA_OFT = process.env.BASE_OFT_ADDRESS || "0x004690Ee41C0Dd2AcEf094D01b93b60aa9a06bb9" as Address;

// LayerZero Endpoint IDs (V2)
const ENDPOINT_IDS = {
  sepolia: 40161,
  baseSepolia: 40245,
};

// EIP-712 types for Permit2 SignatureTransfer
const PERMIT2_SIGNATURE_DOMAIN = {
  name: "Permit2",
  chainId: 84532, // Base Sepolia
  verifyingContract: PERMIT2_ADDRESS,
} as const;

const TOKEN_PERMISSIONS_TYPE = [
  { name: "token", type: "address" },
  { name: "amount", type: "uint256" },
] as const;

const PERMIT_TRANSFER_FROM_TYPE = [
  { name: "permitted", type: "TokenPermissions" },
  { name: "spender", type: "address" },
  { name: "nonce", type: "uint256" },
  { name: "deadline", type: "uint256" },
] as const;

// Source and destination
const SOURCE_CHAIN_NAME = "Base Sepolia";
const DESTINATION_EID = ENDPOINT_IDS.sepolia;
const DESTINATION_CHAIN_NAME = "Sepolia";

async function main() {
  console.log(`🌉 Testing receiveAndBridgeGasless: ${SOURCE_CHAIN_NAME} → ${DESTINATION_CHAIN_NAME}\n`);

  const { viem } = await network.connect({
    network: "base-sepolia",
    chainType: "op",
  });

  const publicClient = await viem.getPublicClient();
  const [walletClient] = await viem.getWalletClients();
  const owner = walletClient.account;

  console.log("👤 Owner:", owner.address);
  console.log("📝 Validator contract:", BASE_SEPOLIA_VALIDATOR);
  console.log("💰 OFT Token:", BASE_SEPOLIA_OFT);
  console.log(`🌐 Source chain: ${SOURCE_CHAIN_NAME}`);
  console.log(`🎯 Destination chain: ${DESTINATION_CHAIN_NAME}\n`);

  // Recipient on destination chain (Sepolia)
  const destinationAddress: Address = owner.address;

  // Amount to bridge
  const amount = parseUnits("1", 6); // 1 token (6 decimals)

  // Check token balance
  console.log("💰 Checking token balance...");
  const erc20Abi = [
    {
      inputs: [{ name: "account", type: "address" }],
      name: "balanceOf",
      outputs: [{ name: "", type: "uint256" }],
      stateMutability: "view",
      type: "function",
    },
  ] as const;

  const balance = await publicClient.readContract({
    address: BASE_SEPOLIA_OFT as Address,
    abi: erc20Abi,
    functionName: "balanceOf",
    args: [owner.address],
  });

  console.log(`   Balance: ${balance} (${Number(balance) / 1e6} tokens)`);

  if (balance < amount) {
    throw new Error(`Insufficient balance! Have ${balance}, need ${amount}`);
  }

  // Get current nonce from Permit2 SignatureTransfer
  console.log("\n🔍 Querying current nonce from Permit2 SignatureTransfer...");
  const permit2NonceAbi = [
    {
      inputs: [
        { name: "owner", type: "address" },
        { name: "word", type: "uint256" },
      ],
      name: "nonceBitmap",
      outputs: [{ name: "", type: "uint256" }],
      stateMutability: "view",
      type: "function",
    },
  ] as const;

  const word = 0n;
  const nonceBitmap = await publicClient.readContract({
    address: PERMIT2_ADDRESS,
    abi: permit2NonceAbi,
    functionName: "nonceBitmap",
    args: [owner.address, word],
  });

  // Find first unused bit (nonce)
  let nonce = 0n;
  for (let i = 0; i < 256; i++) {
    const bit = 1n << BigInt(i);
    if ((nonceBitmap & bit) === 0n) {
      nonce = word * 256n + BigInt(i);
      break;
    }
  }

  console.log(`   Current unused nonce: ${nonce}\n`);

  // Prepare permit data
  const blockTimestamp = (await publicClient.getBlock()).timestamp;
  const deadline = blockTimestamp + 3600n; // 1 hour

  const permit = {
    permitted: {
      token: BASE_SEPOLIA_OFT as Address,
      amount: amount,
    },
    spender: getAddress(BASE_SEPOLIA_VALIDATOR) as Address,
    nonce: nonce,
    deadline: deadline,
  };

  console.log("📋 Permit details:");
  console.log("  Token:", permit.permitted.token);
  console.log("  Amount:", permit.permitted.amount.toString());
  console.log("  Spender:", permit.spender);
  console.log("  Nonce:", permit.nonce.toString());
  console.log("  Deadline:", permit.deadline.toString());

  // Sign permit
  console.log("\n✍️  Signing permit (off-chain)...");
  const signature = await walletClient.signTypedData({
    account: owner,
    domain: PERMIT2_SIGNATURE_DOMAIN,
    types: {
      TokenPermissions: TOKEN_PERMISSIONS_TYPE,
      PermitTransferFrom: PERMIT_TRANSFER_FROM_TYPE,
    },
    primaryType: "PermitTransferFrom",
    message: {
      permitted: {
        token: permit.permitted.token,
        amount: permit.permitted.amount,
      },
      spender: permit.spender,
      nonce: permit.nonce,
      deadline: permit.deadline,
    } as any,
  });

  console.log("✅ Signature created");

  // Prepare LayerZero options (V2 format)
  const extraOptions = "0x0003010011010000000000000000000000000000ea60";

  // Quote bridge fee
  console.log("\n💸 Quoting bridge fee...");
  const validatorAbi = [
    {
      inputs: [
        { name: "token", type: "address" },
        { name: "dstEid", type: "uint32" },
        { name: "dstAddress", type: "address" },
        { name: "amount", type: "uint256" },
        { name: "minAmountLD", type: "uint256" },
        { name: "extraOptions", type: "bytes" },
      ],
      name: "quoteBridge",
      outputs: [{ name: "nativeFee", type: "uint256" }],
      stateMutability: "view",
      type: "function",
    },
    {
      inputs: [
        {
          components: [
            {
              components: [
                { name: "token", type: "address" },
                { name: "amount", type: "uint256" },
              ],
              name: "permitted",
              type: "tuple",
            },
            { name: "nonce", type: "uint256" },
            { name: "deadline", type: "uint256" },
          ],
          name: "permit",
          type: "tuple",
        },
        { name: "owner", type: "address" },
        { name: "signature", type: "bytes" },
        { name: "dstEid", type: "uint32" },
        { name: "dstAddress", type: "address" },
        { name: "minAmountLD", type: "uint256" },
        { name: "extraOptions", type: "bytes" },
      ],
      name: "receiveAndBridgeGasless",
      outputs: [],
      stateMutability: "payable",
      type: "function",
    },
  ] as const;

  const fee = await publicClient.readContract({
    address: getAddress(BASE_SEPOLIA_VALIDATOR) as Address,
    abi: validatorAbi,
    functionName: "quoteBridge",
    args: [
      BASE_SEPOLIA_OFT as Address,
      DESTINATION_EID,
      destinationAddress as Address,
      amount,
      amount, // minAmountLD = amount (no slippage tolerance)
      extraOptions as `0x${string}`,
    ],
  });

  console.log(`   Required fee: ${fee} wei (${Number(fee) / 1e18} ETH)\n`);

  // Execute receiveAndBridgeGasless
  console.log("\n🚀 Executing receiveAndBridgeGasless (GASLESS - NO APPROVE NEEDED!)...");

  const txHash = await walletClient.writeContract({
    address: getAddress(BASE_SEPOLIA_VALIDATOR) as Address,
    abi: validatorAbi,
    functionName: "receiveAndBridgeGasless",
    args: [
      {
        permitted: {
          token: permit.permitted.token as Address,
          amount: permit.permitted.amount,
        },
        nonce: permit.nonce,
        deadline: permit.deadline,
      },
      owner.address as Address,
      signature,
      DESTINATION_EID,
      destinationAddress as Address,
      amount, // minAmountLD
      extraOptions as `0x${string}`,
    ],
    value: fee, // Pay LayerZero fee
    account: owner,
  });

  console.log("📝 Transaction hash:", txHash);
  console.log("⏳ Waiting for confirmation...");

  const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash });

  console.log("\n✅ Bridge transaction confirmed!");
  console.log("   Block:", receipt.blockNumber);
  console.log("   Gas used:", receipt.gasUsed.toString());
  console.log(`   Status: ${receipt.status === "success" ? "✅ Success" : "❌ Failed"}`);

  console.log("\n🎉 Gasless bridge completed successfully!");
  console.log(`   • No prior token.approve(Permit2) needed!`);
  console.log(`   • User only signed off-chain (gasless)`);
  console.log(`   • Relayer paid gas for transfer + bridge`);
  console.log(`   • Tokens sent from ${SOURCE_CHAIN_NAME} → ${DESTINATION_CHAIN_NAME}`);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });

