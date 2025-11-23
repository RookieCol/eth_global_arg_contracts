import { network } from "hardhat";
import { parseUnits, getAddress, type Address } from "viem";

// Official Permit2 address on all networks
const PERMIT2_ADDRESS = "0x000000000022D473030F116dDEE9F6B43aC78BA3" as Address;

// USDC on Sepolia testnet
const TEST_TOKEN = "0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238" as Address; // USDC Sepolia

// EIP-712 types for Permit2
const PERMIT2_DOMAIN = {
  name: "Permit2",
  chainId: 11155111, // Sepolia
  verifyingContract: PERMIT2_ADDRESS,
} as const;

const PERMIT_DETAILS_TYPE = [
  { name: "token", type: "address" },
  { name: "amount", type: "uint160" },
  { name: "expiration", type: "uint48" },
  { name: "nonce", type: "uint48" },
] as const;

const PERMIT_SINGLE_TYPE = [
  { name: "details", type: "PermitDetails" },
  { name: "spender", type: "address" },
  { name: "sigDeadline", type: "uint256" },
] as const;

async function main() {
  console.log("🧪 Testing receiveTokensWithPermit...\n");

  // Connect to network
  const { viem } = await network.connect({
    network: "sepolia",
    chainType: "l1",
  });

  const publicClient = await viem.getPublicClient();
  const [walletClient] = await viem.getWalletClients();
  const owner = walletClient.account;

  console.log("👤 Owner address (signer):", owner.address);
  
  const validatorAddress = process.env.VALIDATOR_ADDRESS || "0x4cd092a9d4623Fa16411F65d0339B5815895Ca24";
  console.log("📝 Validator contract:", validatorAddress);
  console.log("🎯 Tokens will be sent to:", validatorAddress, "(the contract itself)");
  console.log("🌐 Network:", await publicClient.getChainId());
  console.log("💰 Token: USDC (USD Coin)");
  console.log("💵 Amount: 1 USDC (1 USD)\n");
  
  // Check USDC balance
  const erc20Abi = [
    {
      inputs: [{ name: "account", type: "address" }],
      name: "balanceOf",
      outputs: [{ name: "", type: "uint256" }],
      stateMutability: "view",
      type: "function",
    },
  ] as const;

  const usdcBalance = await publicClient.readContract({
    address: TEST_TOKEN,
    abi: erc20Abi,
    functionName: "balanceOf",
    args: [owner.address],
  });

  console.log(`💼 Your USDC balance: ${(Number(usdcBalance) / 1e6).toFixed(2)} USDC`);
  
  const requiredAmount = parseUnits("1", 6); // 1 USDC
  if (usdcBalance < requiredAmount) {
    console.log("\n⚠️  Warning: Insufficient USDC balance!");
    process.exit(1);
  }

  // Check contract's current USDC balance
  const contractBalance = await publicClient.readContract({
    address: TEST_TOKEN,
    abi: erc20Abi,
    functionName: "balanceOf",
    args: [getAddress(validatorAddress)],
  });

  console.log(`💼 Contract's current USDC balance: ${(Number(contractBalance) / 1e6).toFixed(2)} USDC\n`);

  // Get blockchain timestamp
  const latestBlock = await publicClient.getBlock();
  const blockTimestamp = Number(latestBlock.timestamp);
  console.log(`⏰ Current blockchain time: ${blockTimestamp} (${new Date(blockTimestamp * 1000).toISOString()})`);
  
  // Prepare permit data
  const amount = parseUnits("1", 6); // 1 USDC
  const expirationTimestamp = blockTimestamp + 3600; // 1 hour from blockchain time
  const sigDeadlineTimestamp = blockTimestamp + 3600; // 1 hour from blockchain time

  // Start with nonce 1 (adjust if needed)
  const startNonce = 1;
  const maxNonceAttempts = 10;
  let lastError: any = null;
  
  console.log(`🔢 Starting with nonce ${startNonce}, will try up to ${maxNonceAttempts} sequential nonces if needed\n`);
  
  for (let attempt = 0; attempt < maxNonceAttempts; attempt++) {
    const currentNonce = startNonce + attempt;
    
    console.log(`\n🔄 Attempt ${attempt + 1}/${maxNonceAttempts} with nonce ${currentNonce}`);
    
    const permitDetails = {
      token: TEST_TOKEN,
      amount: Number(amount),
      expiration: expirationTimestamp,
      nonce: currentNonce,
    };

    const permitSingle = {
      details: permitDetails,
      spender: getAddress(validatorAddress),
      sigDeadline: sigDeadlineTimestamp,
    };

    console.log("\n📋 Permit details:");
    console.log("  Token:", permitDetails.token);
    console.log("  Amount:", permitDetails.amount.toString());
    console.log("  Spender:", permitSingle.spender);
    console.log("  Expiration:", permitDetails.expiration.toString());
    console.log("  Nonce:", permitDetails.nonce.toString());
    console.log("  Sig Deadline:", permitSingle.sigDeadline.toString());

    const signature = await walletClient.signTypedData({
      domain: PERMIT2_DOMAIN,
      types: {
        PermitDetails: PERMIT_DETAILS_TYPE,
        PermitSingle: PERMIT_SINGLE_TYPE,
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

    console.log("✅ Signature created:", signature.substring(0, 20) + "...");

    const validatorAbi = [
      {
        inputs: [
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
          { name: "owner", type: "address" },
          { name: "amount", type: "uint160" },
        ],
        name: "receiveTokensWithPermit",
        outputs: [],
        stateMutability: "nonpayable",
        type: "function",
      },
      {
        anonymous: false,
        inputs: [
          { indexed: true, name: "from", type: "address" },
          { indexed: true, name: "to", type: "address" },
          { indexed: true, name: "token", type: "address" },
          { indexed: false, name: "amount", type: "uint160" },
        ],
        name: "TokensTransferred",
        type: "event",
      },
    ] as const;

    console.log("\n🔍 Calling receiveTokensWithPermit on contract...");
    console.log("   Contract will:");
    console.log("   1. Validate the signature via Permit2.permit()");
    console.log("   2. Transfer tokens from you to the contract via Permit2.transferFrom()");

    try {
      const hash = await walletClient.writeContract({
        address: getAddress(validatorAddress),
        abi: validatorAbi,
        functionName: "receiveTokensWithPermit",
        args: [
          {
            details: {
              token: permitDetails.token,
              amount: BigInt(permitDetails.amount),
              expiration: BigInt(permitDetails.expiration),
              nonce: BigInt(permitDetails.nonce),
            },
            spender: permitSingle.spender,
            sigDeadline: permitSingle.sigDeadline,
          },
          signature as `0x${string}`,
          owner.address,
          BigInt(permitDetails.amount),
        ] as any,
      });

      console.log("⏳ Transaction sent:", hash);
      console.log("⏳ Waiting for confirmation...");

      const receipt = await publicClient.waitForTransactionReceipt({ hash });
      console.log("✅ Transaction confirmed in block:", receipt.blockNumber);

      // Check new contract balance
      const newContractBalance = await publicClient.readContract({
        address: TEST_TOKEN,
        abi: erc20Abi,
        functionName: "balanceOf",
        args: [getAddress(validatorAddress)],
      });

      console.log("\n🎉 Success!");
      console.log(`   Previous contract balance: ${(Number(contractBalance) / 1e6).toFixed(2)} USDC`);
      console.log(`   New contract balance: ${(Number(newContractBalance) / 1e6).toFixed(2)} USDC`);
      console.log(`   Difference: +${((Number(newContractBalance) - Number(contractBalance)) / 1e6).toFixed(2)} USDC`);
      
      return;
    } catch (error: any) {
      lastError = error;
      
      let errorSignature = error.signature;
      if (!errorSignature && error.cause) {
        errorSignature = error.cause.signature;
      }
      if (!errorSignature && error.cause?.cause) {
        errorSignature = error.cause.cause.signature;
      }
      
      const errorMessage = error.message || error.cause?.message || error.cause?.cause?.message || "";
      if (!errorSignature && errorMessage.includes("0x756688fe")) {
        errorSignature = "0x756688fe";
      }
      if (!errorSignature && errorMessage.includes("0x815e1d64")) {
        errorSignature = "0x815e1d64";
      }
      
      if (errorSignature === "0x756688fe" || errorSignature === "0x815e1d64") {
        console.log(`❌ Attempt ${attempt + 1} failed with error ${errorSignature}`);
        console.log("   This is likely a nonce issue (nonce already used), trying next nonce...");
        continue;
      } else if (errorMessage.includes("0x756688fe") || errorMessage.includes("0x815e1d64") || 
                 errorMessage.includes("InvalidSignature") || errorMessage.includes("InvalidNonce")) {
        console.log(`❌ Attempt ${attempt + 1} failed with nonce-related error`);
        console.log("   Error signature found in message, trying next nonce...");
        continue;
      } else {
        console.log(`❌ Attempt ${attempt + 1} failed`);
        console.log("   Error signature:", errorSignature || "unknown");
        console.log("   Error message preview:", errorMessage.substring(0, 150));
        
        if (attempt < maxNonceAttempts - 1) {
          console.log("   Trying next nonce anyway...");
          continue;
        } else {
          throw error;
        }
      }
    }
  }
  
  console.error("\n❌ All nonce attempts failed!");
  if (lastError) {
    throw lastError;
  } else {
    throw new Error("Failed to receive tokens after multiple nonce attempts");
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });

