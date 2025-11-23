import { network } from "hardhat";
import { type Address } from "viem";

const SEPOLIA_OFT = "0x07b091cC0eef5b03A41eB4bDD059B388cd3560D1" as Address;

async function checkChain(chainName: string, chainType: "l1" | "op", chainId: number) {
  try {
    const { viem } = await network.connect({
      network: chainName,
      chainType: chainType,
    });

    const publicClient = await viem.getPublicClient();
    const code = await publicClient.getCode({ address: SEPOLIA_OFT });

    if (code && code !== "0x") {
      console.log(`✅ ${chainName}: OFT exists at ${SEPOLIA_OFT}`);
      console.log(`   Code length: ${code.length} bytes\n`);
      return true;
    } else {
      console.log(`❌ ${chainName}: No contract at ${SEPOLIA_OFT}\n`);
      return false;
    }
  } catch (error: any) {
    console.log(`❌ ${chainName}: Error - ${error.message}\n`);
    return false;
  }
}

async function main() {
  console.log("🔍 Checking if Sepolia OFT exists on other chains...\n");
  console.log(`OFT Address: ${SEPOLIA_OFT}\n`);

  await checkChain("sepolia", "l1", 11155111);
  await checkChain("optimism-sepolia", "op", 11155420);
  await checkChain("arbitrum-sepolia", "l1", 421614);
  await checkChain("base-sepolia", "op", 84532);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
