import { network } from "hardhat";
import { type Address } from "viem";

// OFTs según la tabla del usuario
const OFTS = {
  sepolia: "0x07b091cC0eef5b03A41eB4bDD059B388cd3560D1",
  "optimism-sepolia": "0x4cd092a9d4623Fa16411F65d0339B5815895Ca24",
  "base-sepolia": "0x004690Ee41C0Dd2AcEf094D01b93b60aa9a06bb9",
  "arbitrum-sepolia": "0x004690Ee41C0Dd2AcEf094D01b93b60aa9a06bb9",
};

async function checkOFT(chainName: string, chainType: "l1" | "op", oftAddress: string) {
  try {
    const { viem } = await network.connect({
      network: chainName,
      chainType: chainType,
    });

    const publicClient = await viem.getPublicClient();
    const [walletClient] = await viem.getWalletClients();
    const owner = walletClient.account;

    // Check if contract exists
    const code = await publicClient.getCode({ address: oftAddress as Address });
    
    if (!code || code === "0x") {
      console.log(`❌ ${chainName}: No contract at ${oftAddress}\n`);
      return;
    }

    console.log(`✅ ${chainName}: Contract exists at ${oftAddress}`);
    console.log(`   Code length: ${code.length} bytes`);

    // Check balance
    const erc20Abi = [
      {
        inputs: [{ name: "account", type: "address" }],
        name: "balanceOf",
        outputs: [{ name: "", type: "uint256" }],
        stateMutability: "view",
        type: "function",
      },
    ] as const;

    try {
      const balance = await publicClient.readContract({
        address: oftAddress as Address,
        abi: erc20Abi,
        functionName: "balanceOf",
        args: [owner.address],
      });
      console.log(`   Balance: ${balance} (${Number(balance) / 1e6} tokens)`);
    } catch (e) {
      console.log(`   Balance: Could not read`);
    }

    console.log();
  } catch (error: any) {
    console.log(`❌ ${chainName}: Error - ${error.message}\n`);
  }
}

async function main() {
  console.log("🔍 Checking all OFT contracts from user table...\n");

  await checkOFT("sepolia", "l1", OFTS.sepolia);
  await checkOFT("optimism-sepolia", "op", OFTS["optimism-sepolia"]);
  await checkOFT("base-sepolia", "op", OFTS["base-sepolia"]);
  await checkOFT("arbitrum-sepolia", "l1", OFTS["arbitrum-sepolia"]);

  console.log("\n📊 Summary:");
  console.log("- Sepolia OFT:", OFTS.sepolia);
  console.log("- OP Sepolia OFT:", OFTS["optimism-sepolia"]);
  console.log("- Base Sepolia OFT:", OFTS["base-sepolia"]);
  console.log("- Arbitrum Sepolia OFT:", OFTS["arbitrum-sepolia"]);
  console.log("\n⚠️  Note: Base and Arbitrum use the same OFT address");
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });

