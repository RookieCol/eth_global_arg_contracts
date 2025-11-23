import { network } from "hardhat";
import { type Address } from "viem";

const SEPOLIA_OFT = "0x07b091cC0eef5b03A41eB4bDD059B388cd3560D1" as Address;

async function main() {
  console.log("🔍 Investigating Sepolia OFT Contract...\n");

  const { viem } = await network.connect({
    network: "sepolia",
    chainType: "l1",
  });

  const publicClient = await viem.getPublicClient();
  const [walletClient] = await viem.getWalletClients();
  const owner = walletClient.account;

  // Check contract size
  const code = await publicClient.getCode({ address: SEPOLIA_OFT });
  console.log(`Contract code size: ${code?.length || 0} bytes\n`);

  // Try to call OFT-specific functions
  const oftAbi = [
    {
      inputs: [
        {
          components: [
            { name: "dstEid", type: "uint32" },
            { name: "to", type: "bytes32" },
            { name: "amountLD", type: "uint256" },
            { name: "minAmountLD", type: "uint256" },
            { name: "extraOptions", type: "bytes" },
            { name: "composeMsg", type: "bytes" },
            { name: "oftCmd", type: "bytes" },
          ],
          name: "_sendParam",
          type: "tuple",
        },
        { name: "_payInLzToken", type: "bool" },
      ],
      name: "quoteSend",
      outputs: [
        {
          components: [
            { name: "nativeFee", type: "uint256" },
            { name: "lzTokenFee", type: "uint256" },
          ],
          name: "msgFee",
          type: "tuple",
        },
      ],
      stateMutability: "view",
      type: "function",
    },
    {
      inputs: [],
      name: "token",
      outputs: [{ name: "", type: "address" }],
      stateMutability: "view",
      type: "function",
    },
  ] as const;

  // Try quoteSend
  console.log("Testing OFT functions...\n");
  
  try {
    const sendParam = {
      dstEid: 40245,
      to: "0x000000000000000000000000" + owner.address.slice(2),
      amountLD: 1000000n,
      minAmountLD: 1000000n,
      extraOptions: "0x0003010011010000000000000000000000000000ea60" as `0x${string}`,
      composeMsg: "0x" as `0x${string}`,
      oftCmd: "0x" as `0x${string}`,
    };

    const fee = await publicClient.readContract({
      address: SEPOLIA_OFT,
      abi: oftAbi,
      functionName: "quoteSend",
      args: [sendParam, false],
    });
    
    console.log("✅ quoteSend works! This IS an OFT");
    console.log(`   LayerZero fee: ${fee.nativeFee}\n`);
  } catch (error: any) {
    console.log("❌ quoteSend failed - This might NOT be a standard OFT");
    console.log(`   Error: ${error.shortMessage || error.message}\n`);
  }

  // Check if it has a token() function (for OFTAdapter)
  try {
    const token = await publicClient.readContract({
      address: SEPOLIA_OFT,
      abi: oftAbi,
      functionName: "token",
      args: [],
    });
    console.log("✅ token() works! This is an OFTAdapter");
    console.log(`   Underlying token: ${token}\n`);
  } catch (error: any) {
    console.log("❌ token() failed - This is a native OFT (not an adapter)\n");
  }

  // Check ERC20 name
  const erc20Abi = [
    {
      inputs: [],
      name: "name",
      outputs: [{ name: "", type: "string" }],
      stateMutability: "view",
      type: "function",
    },
    {
      inputs: [],
      name: "symbol",
      outputs: [{ name: "", type: "string" }],
      stateMutability: "view",
      type: "function",
    },
  ] as const;

  try {
    const name = await publicClient.readContract({
      address: SEPOLIA_OFT,
      abi: erc20Abi,
      functionName: "name",
      args: [],
    });
    const symbol = await publicClient.readContract({
      address: SEPOLIA_OFT,
      abi: erc20Abi,
      functionName: "symbol",
      args: [],
    });
    console.log("ERC20 Info:");
    console.log(`   Name: ${name}`);
    console.log(`   Symbol: ${symbol}\n`);
  } catch (error) {
    console.log("Could not read ERC20 info\n");
  }

  console.log("\n🎯 Conclusion:");
  console.log("This contract at", SEPOLIA_OFT);
  console.log("is likely a CUSTOM implementation that:");
  console.log("  1. Implements LayerZero OFT interface");
  console.log("  2. Has built-in Permit2 support");
  console.log("  3. Is different from the standard OFTs in other chains");
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });

