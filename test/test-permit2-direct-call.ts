import { network } from "hardhat";
import { parseUnits, getAddress, type Address } from "viem";

// Official Permit2 address on all networks
const PERMIT2_ADDRESS = "0x000000000022D473030F116dDEE9F6B43aC78BA3" as Address;

// USDC on Sepolia
const USDC_SEPOLIA = "0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238" as Address;

// Your validator contract address (will be the spender in the permit)
const SPENDER = process.env.VALIDATOR_ADDRESS || "0x4cd092a9d4623Fa16411F65d0339B5815895Ca24" as Address;

// EIP-712 domain for Permit2
const PERMIT2_DOMAIN = {
  name: "Permit2",
  chainId: 11155111, // Sepolia
  verifyingContract: PERMIT2_ADDRESS,
} as const;

const PERMIT_DETAILS_TYPE_STRUCT = [
  { name: "token", type: "address" },
  { name: "amount", type: "uint160" },
  { name: "expiration", type: "uint48" },
  { name: "nonce", type: "uint48" },
] as const;

const PERMIT_SINGLE_TYPE_STRUCT = [
  { name: "details", type: "PermitDetails" },
  { name: "spender", type: "address" },
  { name: "sigDeadline", type: "uint256" },
] as const;

async function main() {
  console.log("🧪 Testing Permit2 directly with sequential nonces\n");

  const { viem } = await network.connect({ network: "sepolia", chainType: "l1" });
  const publicClient = await viem.getPublicClient();
  const [walletClient] = await viem.getWalletClients();
  const owner = walletClient.account;

  console.log("👤 Owner:", owner.address);
  console.log("📝 Permit2:", PERMIT2_ADDRESS);
  console.log("🎯 Spender:", SPENDER);
  console.log("💰 Token: USDC\n");

  const amount = parseUnits("1", 6); // 1 USDC
  const latestBlock = await publicClient.getBlock();
  const blockTimestamp = Number(latestBlock.timestamp);
  const expiration = blockTimestamp + 3600; // 1 hour ahead
  const sigDeadline = blockTimestamp + 3600;
  const startNonce = Number(process.env.START_NONCE ?? 0);
  const maxNonceAttempts = Number(process.env.MAX_NONCE_ATTEMPTS ?? 10);

  console.log(`⏰ Block timestamp: ${blockTimestamp}`);
  console.log(`📅 Expiration / SigDeadline: ${expiration}`);
  console.log(`🔢 Starting nonce: ${startNonce}`);
  console.log(`🔁 Max attempts: ${maxNonceAttempts}\n`);

  const permit2Abi = [
    {
      inputs: [
        { name: "owner", type: "address" },
        {
          components: [
            {
              components: [
                { name: "token", type: "address" },
                { name: "amount", type: "uint160" },
                { name: "expiration", type: "uint48" },
                { name: "nonce", type: "uint48" },
              ],
              name: "details",
              type: "tuple",
            },
            { name: "spender", type: "address" },
            { name: "sigDeadline", type: "uint256" },
          ],
          name: "permitSingle",
          type: "tuple",
        },
        { name: "signature", type: "bytes" },
      ],
      name: "permit",
      outputs: [],
      stateMutability: "nonpayable",
      type: "function",
    },
  ] as const;

  let lastError: unknown = null;

  for (let attempt = 0; attempt < maxNonceAttempts; attempt++) {
    const currentNonce = startNonce + attempt;
    const permitDetails = {
      token: USDC_SEPOLIA,
      amount: Number(amount),
      expiration,
      nonce: currentNonce,
    };

    const permitSingle = {
      details: permitDetails,
      spender: getAddress(SPENDER),
      sigDeadline,
    };

    console.log(`🔄 Attempt ${attempt + 1}/${maxNonceAttempts} (nonce ${currentNonce})`);

    const signature = await walletClient.signTypedData({
      domain: PERMIT2_DOMAIN,
      types: {
        PermitDetails: PERMIT_DETAILS_TYPE_STRUCT,
        PermitSingle: PERMIT_SINGLE_TYPE_STRUCT,
      },
      primaryType: "PermitSingle",
      message: {
        details: {
          token: permitDetails.token,
          amount: permitDetails.amount,
          expiration: permitDetails.expiration,
          nonce: permitDetails.nonce,
        },
        spender: permitSingle.spender,
        sigDeadline: permitSingle.sigDeadline,
      } as any,
    });

    console.log("   ✅ Signature:", signature.substring(0, 20) + "...");

    try {
      const hash = await walletClient.writeContract({
        address: PERMIT2_ADDRESS,
        abi: permit2Abi,
        functionName: "permit",
        args: [
          owner.address,
          {
            details: {
              token: permitDetails.token,
              amount: BigInt(permitDetails.amount),
              expiration: BigInt(permitDetails.expiration),
              nonce: BigInt(permitDetails.nonce),
            },
            spender: permitSingle.spender,
            sigDeadline: BigInt(permitSingle.sigDeadline),
          },
          signature as `0x${string}`,
        ],
      });

      await publicClient.waitForTransactionReceipt({ hash });
      console.log("🎉 SUCCESS! Permit accepted.");
      console.log("   Transaction:", hash);
      console.log(`\n✅ Nonce ${currentNonce} works for owner ${owner.address}`);
      console.log(`   Now you can use this nonce in your validator contract test.`);
      return;
    } catch (error: any) {
      lastError = error;
      const errorSig =
        error?.signature ||
        error?.cause?.signature ||
        (typeof error?.message === "string" &&
          (error.message.includes("0x756688fe")
            ? "0x756688fe"
            : error.message.includes("0x815e1d64")
            ? "0x815e1d64"
            : undefined));

      console.log("   ❌ Reverted with:", errorSig ?? "unknown");

      if (
        errorSig === "0x756688fe" ||
        errorSig === "0x815e1d64" ||
        (typeof error?.message === "string" &&
          (error.message.includes("InvalidSignature") ||
            error.message.includes("InvalidNonce")))
      ) {
        console.log("   → Trying next nonce...");
        continue;
      }

      // Different error, throw it
      console.error("\n❌ Unexpected error (not a nonce issue):");
      throw error;
    }
  }

  console.log("\n❌ All nonce attempts failed.");
  console.log("\n💡 This suggests the issue is NOT just the nonce, but:");
  console.log("   1. The signature format/order might be wrong for this wallet");
  console.log("   2. The owner address might not have approved Permit2 yet");
  console.log("   3. There might be a clock skew between local and blockchain time");
  
  if (lastError) {
    throw lastError;
  }
  throw new Error("Permit failed for all attempts");
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
