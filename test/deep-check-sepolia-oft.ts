import { network } from "hardhat";
import { type Address, parseAbi } from "viem";

const SEPOLIA_OFT = "0x07b091cC0eef5b03A41eB4bDD059B388cd3560D1" as Address;
const PERMIT2 = "0x000000000022D473030F116dDEE9F6B43aC78BA3" as Address;

async function main() {
  console.log("🔍 Deep investigation of Sepolia OFT...\n");

  const { viem } = await network.connect({
    network: "sepolia",
    chainType: "l1",
  });

  const publicClient = await viem.getPublicClient();
  const [walletClient] = await viem.getWalletClients();
  const owner = walletClient.account;

  // Check if OFT has special Permit2 support
  const permitAbi = parseAbi([
    "function permit(address owner, address spender, uint256 value, uint256 deadline, uint8 v, bytes32 r, bytes32 s) external",
    "function DOMAIN_SEPARATOR() external view returns (bytes32)",
    "function allowance(address owner, address spender) external view returns (uint256)",
  ]);

  console.log("1️⃣ Testing if OFT has EIP-2612 permit()...");
  try {
    const domainSep = await publicClient.readContract({
      address: SEPOLIA_OFT,
      abi: permitAbi,
      functionName: "DOMAIN_SEPARATOR",
      args: [],
    });
    console.log("✅ Has DOMAIN_SEPARATOR:", domainSep.slice(0, 10) + "...");
  } catch (e: any) {
    console.log("❌ No DOMAIN_SEPARATOR (no EIP-2612)\n");
  }

  console.log("\n2️⃣ Testing allowance from Permit2...");
  try {
    const allowance = await publicClient.readContract({
      address: SEPOLIA_OFT,
      abi: permitAbi,
      functionName: "allowance",
      args: [owner.address, PERMIT2],
    });
    console.log(`   Permit2 allowance: ${allowance}`);
    if (allowance > 0n) {
      console.log("✅ Permit2 has allowance!");
    }
  } catch (e) {
    console.log("❌ Could not check allowance");
  }

  console.log("\n3️⃣ Simulating Permit2 transferFrom...");
  const transferAbi = parseAbi([
    "function transferFrom(address from, address to, uint256 amount) external returns (bool)",
  ]);
  
  try {
    // Simulate what Permit2 would do
    const result = await publicClient.simulateContract({
      address: SEPOLIA_OFT,
      abi: transferAbi,
      functionName: "transferFrom",
      args: [owner.address, owner.address, 1n], // 1 smallest unit
      account: PERMIT2,
    });
    console.log("✅ Permit2 CAN call transferFrom!");
    console.log("   This means the OFT trusts Permit2");
  } catch (e: any) {
    console.log("❌ Permit2 CANNOT call transferFrom");
    console.log(`   Error: ${e.shortMessage || e.message}`);
  }

  console.log("\n🎯 CONCLUSION:");
  console.log("If Permit2 can call transferFrom WITHOUT prior approval,");
  console.log("it means this OFT has SPECIAL built-in Permit2 support.");
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
