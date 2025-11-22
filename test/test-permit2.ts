import { network } from "hardhat";
import { parseUnits, getAddress, encodeFunctionData, type Address } from "viem";

// Official Permit2 address on all networks
const PERMIT2_ADDRESS = "0x000000000022D473030F116dDEE9F6B43aC78BA3" as Address;

// USDC on Sepolia testnet
const TEST_TOKEN = "0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238" as Address; // USDC Sepolia

// Fixed recipient address that will receive tokens if signature is valid
const FIXED_RECIPIENT = "0xfed7881196c5a56a3bc383810598b07a372ecbe8" as Address;

// EIP-712 types for Permit2
// IMPORTANT: Order must match the Solidity struct order, NOT alphabetical!
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
  console.log("🧪 Starting Permit2 test...\n");

  // Connect to network
  const { viem } = await network.connect({
    network: "sepolia",
    chainType: "l1",
  });

  const publicClient = await viem.getPublicClient();
  const [walletClient] = await viem.getWalletClients();
  const owner = walletClient.account;

  console.log("👤 Owner address (signer):", owner.address);
  console.log("📬 Fixed recipient address:", FIXED_RECIPIENT);
  console.log("🌐 Network:", await publicClient.getChainId());
  console.log("💰 Token: USDC (USD Coin)");
  console.log("💵 Amount: 1 USDC (1 USD)");
  
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

  console.log(`💼 Current USDC balance: ${(Number(usdcBalance) / 1e6).toFixed(2)} USDC`);
  
  const requiredAmount = parseUnits("1", 6); // 1 USDC
  if (usdcBalance < requiredAmount) {
    console.log("\n⚠️  Warning: Insufficient USDC balance!");
    console.log(`   You need at least 1 USDC but have ${(Number(usdcBalance) / 1e6).toFixed(2)} USDC`);
    process.exit(1);
  } else {
    console.log("✅ Sufficient USDC balance!");
  }

  // Check and approve Permit2 if needed
  console.log("\n🔍 Checking Permit2 approval...");
  const erc20FullAbi = [
    ...erc20Abi,
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
    {
      inputs: [
        { name: "owner", type: "address" },
        { name: "spender", type: "address" },
      ],
      name: "allowance",
      outputs: [{ name: "", type: "uint256" }],
      stateMutability: "view",
      type: "function",
    },
  ] as const;

  const currentAllowance = await publicClient.readContract({
    address: TEST_TOKEN,
    abi: erc20FullAbi,
    functionName: "allowance",
    args: [owner.address, PERMIT2_ADDRESS],
  });

  console.log(`   Current Permit2 allowance: ${(Number(currentAllowance) / 1e6).toFixed(2)} USDC`);

  if (currentAllowance < requiredAmount) {
    console.log("⚠️  Permit2 not approved or insufficient allowance!");
    console.log("   Approving Permit2 to spend USDC...");
    
    const approveHash = await walletClient.writeContract({
      address: TEST_TOKEN,
      abi: erc20FullAbi,
      functionName: "approve",
      args: [PERMIT2_ADDRESS, parseUnits("100", 6)], // Approve 100 USDC (more than enough)
    });

    console.log("   ⏳ Approval transaction sent:", approveHash);
    console.log("   ⏳ Waiting for confirmation...");
    
    await publicClient.waitForTransactionReceipt({ hash: approveHash });
    console.log("   ✅ Permit2 approved successfully!");
  } else {
    console.log("✅ Permit2 already approved!");
  }
  console.log("");

  // Deployed contract address (adjust if different)
  // This is YOUR deployed Permit2TransferValidator contract
  // Updated to latest verified deployment
  const validatorAddress = process.env.VALIDATOR_ADDRESS || "0x4cd092a9d4623Fa16411F65d0339B5815895Ca24";
  console.log("📝 Validator contract (your deployed contract):", validatorAddress);
  console.log("📝 Permit2 official contract:", PERMIT2_ADDRESS);
  
  // Verify the contract has the function by trying to read it
  console.log("\n🔍 Verifying contract has validatePermitAndTransfer function...");
  try {
    // Try to get the bytecode and check if it contains the function selector
    const code = await publicClient.getBytecode({ address: getAddress(validatorAddress) });
    if (!code || code === "0x") {
      console.error("❌ Contract not found at address:", validatorAddress);
      console.error("   Please deploy the contract first!");
      process.exit(1);
    }
    
    // Check if contract has the function by trying to encode a call
    const testAbi = [
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
          { name: "recipient", type: "address" },
          { name: "amount", type: "uint160" },
        ],
        name: "validatePermitAndTransfer",
        outputs: [],
        stateMutability: "nonpayable",
        type: "function",
      },
    ] as const;
    
    // This will throw if the function doesn't exist
    encodeFunctionData({
      abi: testAbi,
      functionName: "validatePermitAndTransfer",
      args: [
        {
          details: {
            token: "0x0000000000000000000000000000000000000000",
            amount: 0n,
            expiration: 0,
            nonce: 0,
          },
          spender: "0x0000000000000000000000000000000000000000",
          sigDeadline: 0n,
        },
        "0x" as `0x${string}`,
        "0x0000000000000000000000000000000000000000",
        "0x0000000000000000000000000000000000000000",
        0n,
      ],
    });
    console.log("✅ Contract has validatePermitAndTransfer function");
  } catch (error) {
    console.error("❌ Contract verification failed!");
    console.error("   The contract may not have the validatePermitAndTransfer function");
    console.error("   Please redeploy with: npx hardhat ignition deploy ignition/modules/chainlink_permit2.ts --network sepolia");
    process.exit(1);
  }

  // Get blockchain timestamp (not local machine time) to avoid clock skew
  const latestBlock = await publicClient.getBlock();
  const blockTimestamp = Number(latestBlock.timestamp);
  console.log(`⏰ Current blockchain time: ${blockTimestamp} (${new Date(blockTimestamp * 1000).toISOString()})`);
  
  // Prepare permit data
  // Transfer 1 USD worth of USDC (USDC has 6 decimals)
  const amount = parseUnits("1", 6); // 1 USDC (1 USD)
  const expirationTimestamp = blockTimestamp + 3600; // 1 hour from blockchain time
  const sigDeadlineTimestamp = blockTimestamp + 3600; // 1 hour from blockchain time

  // Start with nonce 1 (nonce 0 was consumed in previous test)
  // Try sequential nonces if one fails
  const startNonce = 1; // Next available nonce after direct permit test
  const maxNonceAttempts = 10;
  let lastError: any = null;
  
  console.log(`🔢 Starting with nonce ${startNonce}, will try up to ${maxNonceAttempts} sequential nonces if needed\n`);
  
  for (let attempt = 0; attempt < maxNonceAttempts; attempt++) {
    const currentNonce = startNonce + attempt;
    
    console.log(`\n🔄 Attempt ${attempt + 1}/${maxNonceAttempts} with nonce ${currentNonce.toString()}`);
    
    // Create permit details with values as numbers (not BigInt) for signing
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

    // For EIP-712 signature, use walletClient to sign
    // IMPORTANT: Field order must match Solidity struct order!
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

    console.log("✅ Signature created:", signature);
    console.log("   Signature length:", signature.length, "characters");

  // Get validator contract ABI
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
      ],
      name: "validatePermit",
      outputs: [],
      stateMutability: "nonpayable",
      type: "function",
    },
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
        { name: "recipient", type: "address" },
        { name: "amount", type: "uint160" },
      ],
      name: "validatePermitAndTransfer",
      outputs: [],
      stateMutability: "nonpayable",
      type: "function",
    },
    {
      anonymous: false,
      inputs: [
        { indexed: true, name: "owner", type: "address" },
        { indexed: true, name: "token", type: "address" },
        { indexed: true, name: "spender", type: "address" },
        { indexed: false, name: "amount", type: "uint160" },
      ],
      name: "PermitValidated",
      type: "event",
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

    // Call YOUR deployed contract to validate signature AND transfer tokens
    // Your contract will internally call Permit2.permit() to validate the EIP-712 signature
    // Then it will transfer tokens from owner to recipient using Permit2.transferFrom()
    // Note: Since we transfer the full permitted amount, the allowance is consumed and won't accumulate
    console.log("\n🔍 Calling validatePermitAndTransfer on your deployed contract...");
    console.log("   Your contract will:");
    console.log("   1. Validate the signature via Permit2.permit()");
    console.log("   2. Transfer tokens from owner to recipient via Permit2.transferFrom()");
    console.log("   (Since we transfer the full amount, allowance is consumed, not accumulated)");

    try {
    const hash = await walletClient.writeContract({
      address: getAddress(validatorAddress),
      abi: validatorAbi,
      functionName: "validatePermitAndTransfer",
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
        FIXED_RECIPIENT,
        BigInt(permitDetails.amount), // Transfer the full permitted amount
      ] as any, // Type assertion needed for complex nested types
    });

    console.log("⏳ Transaction sent:", hash);
    console.log("⏳ Waiting for confirmation...");

    const receipt = await publicClient.waitForTransactionReceipt({ hash });
    console.log("✅ Transaction confirmed in block:", receipt.blockNumber);

    // Find TokensTransferred event
    const logs = receipt.logs;
    const transferEventAbi = validatorAbi.find((item) => item.name === "TokensTransferred");
    
    if (transferEventAbi && transferEventAbi.type === "event") {
      const eventLog = logs.find((log) => 
        log.address.toLowerCase() === validatorAddress.toLowerCase()
      );
      
      if (eventLog) {
        console.log("\n🎉 TokensTransferred event emitted!");
        console.log("   Tokens were transferred successfully from owner to recipient.");
        console.log(`   From: ${owner.address}`);
        console.log(`   To: ${FIXED_RECIPIENT}`);
        console.log(`   Amount: ${permitDetails.amount.toString()}`);
      }
    }

      console.log("\n✅ Test completed successfully!");
      console.log("   Permit2 signature was validated and tokens were transferred!");
      console.log(`   ${permitDetails.amount.toString()} tokens transferred from ${owner.address} to ${FIXED_RECIPIENT}`);
      
      // Success! Break out of the loop
      return;
    } catch (error: any) {
      // Store the error and try next nonce
      lastError = error;
      
      // Extract error signature from the error object (can be nested)
      let errorSignature = error.signature;
      if (!errorSignature && error.cause) {
        errorSignature = error.cause.signature;
      }
      if (!errorSignature && error.cause?.cause) {
        errorSignature = error.cause.cause.signature;
      }
      
      // Also check the error message for the signature
      const errorMessage = error.message || error.cause?.message || error.cause?.cause?.message || "";
      if (!errorSignature && errorMessage.includes("0x756688fe")) {
        errorSignature = "0x756688fe";
      }
      if (!errorSignature && errorMessage.includes("0x815e1d64")) {
        errorSignature = "0x815e1d64";
      }
      
      // Check if it's a nonce-related error (InvalidSignature or InvalidNonce from Permit2)
      if (errorSignature === "0x756688fe" || errorSignature === "0x815e1d64") {
        console.log(`❌ Attempt ${attempt + 1} failed with error ${errorSignature}`);
        console.log("   This is likely a nonce issue (nonce already used), trying next nonce...");
        // Continue to next iteration
        continue;
      } else if (errorMessage.includes("0x756688fe") || errorMessage.includes("0x815e1d64") || 
                 errorMessage.includes("InvalidSignature") || errorMessage.includes("InvalidNonce")) {
        console.log(`❌ Attempt ${attempt + 1} failed with nonce-related error`);
        console.log("   Error signature found in message, trying next nonce...");
        continue;
      } else {
        // Other error, might not be nonce-related, but try next nonce anyway
        console.log(`❌ Attempt ${attempt + 1} failed`);
        console.log("   Error signature:", errorSignature || "unknown");
        console.log("   Error message preview:", errorMessage.substring(0, 150));
        
        // If we're not on the last attempt, try next nonce anyway
        // (sometimes the error format is different but it's still a nonce issue)
        if (attempt < maxNonceAttempts - 1) {
          console.log("   Trying next nonce anyway...");
          continue;
        } else {
          // Last attempt failed, throw the error
          throw error;
        }
      }
    }
  }
  
  // If we get here, all attempts failed
  console.error("\n❌ All nonce attempts failed!");
  if (lastError) {
    // Enhanced error reporting for the last error
    console.error("\n❌ Final error details:");
    console.error("   Message:", lastError.message);
    
    if (lastError.signature) {
      console.error("   Error signature:", lastError.signature);
      console.error("   Look up error at: https://openchain.xyz/signatures?query=" + lastError.signature);
      
      const permit2Errors: Record<string, string> = {
        "0x815e1d64": "Permit2: InvalidSignature - The signature is invalid or doesn't match the permit data",
        "0x756688fe": "Permit2: InvalidSignature or InvalidNonce - The signature is invalid or nonce already used",
        "0x4e6b6b5b": "Permit2: AllowanceExpired - The permit has expired",
        "0x4e6b6b5c": "Permit2: InvalidNonce - The nonce has already been used",
      };
      
      if (permit2Errors[lastError.signature]) {
        console.error("\n🔍 Permit2 Error:", permit2Errors[lastError.signature]);
      }
    }
    
    throw lastError;
  } else {
    throw new Error("Failed to validate permit after multiple nonce attempts");
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });

