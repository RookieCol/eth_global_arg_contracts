import { network } from "hardhat";
import { parseUnits, getAddress, type Address, maxUint256 } from "viem";

// Contract addresses for Base Sepolia
const BASE_SEPOLIA_VALIDATOR = process.env.BASE_VALIDATOR_ADDRESS || "0x07b091cC0eef5b03A41eB4bDD059B388cd3560D1" as Address;
const BASE_SEPOLIA_OFT = process.env.BASE_OFT_ADDRESS || "0x004690Ee41C0Dd2AcEf094D01b93b60aa9a06bb9" as Address;

// LayerZero Endpoint IDs (V2)
const ENDPOINT_IDS = {
  sepolia: 40161,
  baseSepolia: 40245,
};

const SOURCE_CHAIN_NAME = "Base Sepolia";
const DESTINATION_EID = ENDPOINT_IDS.sepolia;
const DESTINATION_CHAIN_NAME = "Sepolia";

async function main() {
  console.log(`🌉 Testing bridge WITH APPROVE: ${SOURCE_CHAIN_NAME} → ${DESTINATION_CHAIN_NAME}`);
  console.log(`⚠️  Note: This uses traditional approve() method (not gasless)\n`);

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

  const destinationAddress: Address = owner.address;
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
    {
      inputs: [
        { name: "spender", type: "address" },
        { name: "amount", type: "uint256" },
      ],
      name: "approve",
      outputs: [{ name: "", type: "bool" }],
      stateMutability: "nonpayable",
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

  // Approve validator to spend tokens
  console.log("\n💳 Approving validator to spend tokens...");
  const approveTx = await walletClient.writeContract({
    address: BASE_SEPOLIA_OFT,
    abi: erc20Abi,
    functionName: "approve",
    args: [BASE_SEPOLIA_VALIDATOR, maxUint256],
    account: owner,
  });

  console.log("   Tx hash:", approveTx);
  await publicClient.waitForTransactionReceipt({ hash: approveTx });
  console.log("✅ Approval confirmed");

  // Prepare LayerZero options
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
        { name: "token", type: "address" },
        { name: "amount", type: "uint160" },
        { name: "dstEid", type: "uint32" },
        { name: "dstAddress", type: "address" },
        { name: "minAmountLD", type: "uint256" },
        { name: "extraOptions", type: "bytes" },
      ],
      name: "receiveAndBridge",
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
      amount,
      extraOptions as `0x${string}`,
    ],
  });

  console.log(`   Required fee: ${fee} wei (${Number(fee) / 1e18} ETH)\n`);

  // Execute bridge
  console.log("\n🚀 Executing bridge (with approve method)...");

  const txHash = await walletClient.writeContract({
    address: getAddress(BASE_SEPOLIA_VALIDATOR) as Address,
    abi: validatorAbi,
    functionName: "receiveAndBridge",
    args: [
      BASE_SEPOLIA_OFT as Address,
      amount as any, // uint160
      DESTINATION_EID,
      destinationAddress as Address,
      amount,
      extraOptions as `0x${string}`,
    ],
    value: fee,
    account: owner,
  });

  console.log("📝 Transaction hash:", txHash);
  console.log("⏳ Waiting for confirmation...");

  const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash });

  console.log("\n✅ Bridge transaction confirmed!");
  console.log("   Block:", receipt.blockNumber);
  console.log("   Gas used:", receipt.gasUsed.toString());
  console.log(`   Status: ${receipt.status === "success" ? "✅ Success" : "❌ Failed"}`);

  console.log("\n🎉 Bridge completed!");
  console.log(`   • Used traditional approve() method`);
  console.log(`   • User paid gas for approve + bridge`);
  console.log(`   • Tokens sent from ${SOURCE_CHAIN_NAME} → ${DESTINATION_CHAIN_NAME}`);
  
  console.log("\n💡 Compare with gasless version:");
  console.log("   • Gasless: 1 signature (free) → Done");
  console.log("   • Traditional: 2 TXs (approve + bridge) → User pays gas");
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });

