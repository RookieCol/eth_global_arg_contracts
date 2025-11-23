import { network } from "hardhat";
import { maxUint160, type Address, parseAbi } from "viem";

const PERMIT2_ADDRESS = "0x000000000022D473030F116dDEE9F6B43aC78BA3" as Address;

// OFT addresses from user's USDC_MOCK project
const OFTS = {
  "optimism-sepolia": "0x4cd092a9d4623Fa16411F65d0339B5815895Ca24",
  "base-sepolia": "0x004690Ee41C0Dd2AcEf094D01b93b60aa9a06bb9",
  "arbitrum-sepolia": "0x004690Ee41C0Dd2AcEf094D01b93b60aa9a06bb9",
};

async function approvePermit2(chainName: string, chainType: "l1" | "op", oftAddress: string) {
  console.log(`\n🔧 Approving Permit2 on ${chainName}...`);
  console.log(`   OFT: ${oftAddress}`);

  const { viem } = await network.connect({
    network: chainName,
    chainType: chainType,
  });

  const publicClient = await viem.getPublicClient();
  const [walletClient] = await viem.getWalletClients();
  const owner = walletClient.account;

  const erc20Abi = parseAbi([
    "function approve(address spender, uint256 amount) external returns (bool)",
    "function allowance(address owner, address spender) external view returns (uint256)",
  ]);

  // Check current allowance
  const currentAllowance = await publicClient.readContract({
    address: oftAddress as Address,
    abi: erc20Abi,
    functionName: "allowance",
    args: [owner.address, PERMIT2_ADDRESS],
  });

  console.log(`   Current Permit2 allowance: ${currentAllowance}`);

  if (currentAllowance >= maxUint160 / 2n) {
    console.log("✅ Permit2 already has sufficient allowance!");
    return;
  }

  // Approve Permit2
  console.log(`   Approving Permit2 with maxUint160...`);
  const txHash = await walletClient.writeContract({
    address: oftAddress as Address,
    abi: erc20Abi,
    functionName: "approve",
    args: [PERMIT2_ADDRESS, maxUint160],
    account: owner,
  });

  console.log(`   TX: ${txHash}`);
  console.log(`   ⏳ Waiting for confirmation...`);

  const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash });
  
  if (receipt.status === "success") {
    console.log(`✅ Approval confirmed on ${chainName}!`);
  } else {
    console.log(`❌ Approval failed on ${chainName}`);
  }
}

async function main() {
  console.log("🚀 Approving Permit2 on all OFTs...\n");
  console.log("This will allow gasless bridging FROM these chains\n");

  // Approve on each chain
  await approvePermit2("optimism-sepolia", "op", OFTS["optimism-sepolia"]);
  await approvePermit2("base-sepolia", "op", OFTS["base-sepolia"]);
  await approvePermit2("arbitrum-sepolia", "l1", OFTS["arbitrum-sepolia"]);

  console.log("\n\n🎉 All approvals completed!");
  console.log("\nNow you can use gasless bridge from:");
  console.log("✅ Sepolia (already working)");
  console.log("✅ Optimism Sepolia");
  console.log("✅ Base Sepolia");
  console.log("✅ Arbitrum Sepolia");
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });

