import { network } from "hardhat";
import { parseUnits, getAddress, maxUint160, type Address } from "viem";

// Official Permit2 address
const PERMIT2_ADDRESS = "0x000000000022D473030F116dDEE9F6B43aC78BA3" as Address;

// Example addresses (replace with your deployed contracts)
const OFT_TOKEN_ADDRESS = process.env.OFT_TOKEN_ADDRESS || "0x07b091cC0eef5b03A41eB4bDD059B388cd3560D1" as Address;
const VALIDATOR_ADDRESS = process.env.VALIDATOR_ADDRESS || "0x762579DFD5e62Ab797282dc5495A92b8b6E7cB25" as Address;

// LayerZero Endpoint IDs (V2)
const ENDPOINT_IDS = {
  sepolia: 40161,
  baseSepolia: 40245,      // ✅ Usar este
  optimismSepolia: 40232,
  arbitrumSepolia: 40231,
};

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
  console.log("🌉 Testing receiveAndBridge (Permit2 + LayerZero)...\n");

  const { viem } = await network.connect({
    network: "sepolia",
    chainType: "l1",
  });

  const publicClient = await viem.getPublicClient();
  const [walletClient] = await viem.getWalletClients();
  const owner = walletClient.account;

  console.log("👤 Owner:", owner.address);
  console.log("📝 Validator contract:", VALIDATOR_ADDRESS);
  console.log("💰 OFT Token:", OFT_TOKEN_ADDRESS);
  console.log("🌐 Source chain: Sepolia");
  console.log("🎯 Destination chain: Base Sepolia\n");

  // Recipient on destination chain
  const destinationAddress = owner.address; // Or different address

  // Amount to bridge
  const amount = parseUnits("1", 6); // 1 token (assuming 6 decimals like USDC)

  // Get current nonce from Permit2
  console.log("🔍 Querying current nonce from Permit2...");
  const permit2Abi = [
    {
      inputs: [
        { name: "owner", type: "address" },
        { name: "token", type: "address" },
        { name: "spender", type: "address" },
      ],
      name: "allowance",
      outputs: [
        { name: "amount", type: "uint160" },
        { name: "expiration", type: "uint48" },
        { name: "nonce", type: "uint48" },
      ],
      stateMutability: "view",
      type: "function",
    },
  ] as const;

  const allowanceData = await publicClient.readContract({
    address: PERMIT2_ADDRESS,
    abi: permit2Abi,
    functionName: "allowance",
    args: [owner.address, OFT_TOKEN_ADDRESS as Address, getAddress(VALIDATOR_ADDRESS)],
  });

  const currentNonce = Number(allowanceData[2]); // nonce is the third element
  console.log(`   Current nonce for this spender: ${currentNonce}`);
  console.log(`   Next valid nonce: ${currentNonce}\n`);

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
        { name: "owner", type: "address" },
        { name: "spender", type: "address" },
      ],
      name: "allowance",
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
    address: OFT_TOKEN_ADDRESS as Address,
    abi: erc20Abi,
    functionName: "balanceOf",
    args: [owner.address],
  });

  console.log(`   Balance: ${balance} (${Number(balance) / 1e6} tokens)`);

  if (balance < amount) {
    throw new Error(`Insufficient balance! Have ${balance}, need ${amount}`);
  }

  // Check and approve Permit2 if needed
  console.log("\n🔐 Checking Permit2 approval...");
  const permit2Allowance = await publicClient.readContract({
    address: OFT_TOKEN_ADDRESS as Address,
    abi: erc20Abi,
    functionName: "allowance",
    args: [owner.address, PERMIT2_ADDRESS],
  });

  console.log(`   Current Permit2 allowance: ${permit2Allowance}`);

  if (permit2Allowance < amount) {
    console.log("   ⚠️  Insufficient allowance! Approving Permit2...");
    const approveTx = await walletClient.writeContract({
      address: OFT_TOKEN_ADDRESS as Address,
      abi: erc20Abi,
      functionName: "approve",
      args: [PERMIT2_ADDRESS, maxUint160], // Max approval
    });

    console.log(`   📝 Approval tx: ${approveTx}`);
    console.log("   ⏳ Waiting for confirmation...");

    await publicClient.waitForTransactionReceipt({ hash: approveTx });
    console.log("   ✅ Permit2 approved!\n");
  } else {
    console.log("   ✅ Permit2 already approved\n");
  }

  // Get blockchain timestamp
  const latestBlock = await publicClient.getBlock();
  const blockTimestamp = Number(latestBlock.timestamp);
  
  // Prepare permit data
  const expirationTimestamp = blockTimestamp + 3600; // 1 hour
  const sigDeadlineTimestamp = blockTimestamp + 3600;

  // Use current nonce from Permit2
  const startNonce = currentNonce;
  const maxNonceAttempts = 5; // Reduce attempts since we have the correct nonce
  let lastError: any = null;

  console.log(`🔢 Will try nonces ${startNonce} to ${startNonce + maxNonceAttempts - 1}\n`);

  // Define validator ABI (outside loop)
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

  for (let attempt = 0; attempt < maxNonceAttempts; attempt++) {
    const currentNonce = startNonce + attempt;
    
    console.log(`\n🔄 Attempt ${attempt + 1}/${maxNonceAttempts} with nonce ${currentNonce}`);

    const permitDetails = {
      token: OFT_TOKEN_ADDRESS,
      amount: Number(amount),
      expiration: expirationTimestamp,
      nonce: currentNonce,
    };

    const permitSingle = {
      details: permitDetails,
      spender: getAddress(VALIDATOR_ADDRESS),
      sigDeadline: sigDeadlineTimestamp,
    };

    console.log("📋 Permit details:");
    console.log("  Token:", permitDetails.token);
    console.log("  Amount:", permitDetails.amount);
    console.log("  Spender:", permitSingle.spender);
    console.log("  Nonce:", permitDetails.nonce);

    // Sign permit
    console.log("\n✍️  Signing permit (off-chain)...");
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

    console.log("✅ Signature created");

    // Prepare LayerZero options (V2 format)
    const extraOptions = "0x0003010011010000000000000000000000000000ea60";

    // Quote bridge fee (only on first attempt)
    if (attempt === 0) {
      console.log("\n💸 Quoting bridge fee...");

      const fee = await publicClient.readContract({
        address: getAddress(VALIDATOR_ADDRESS),
        abi: validatorAbi,
        functionName: "quoteBridge",
        args: [
          OFT_TOKEN_ADDRESS as Address,
          ENDPOINT_IDS.baseSepolia,  // ✅ Cambiado a Base Sepolia
          destinationAddress,
          amount,
          amount, // minAmountLD = amount (no slippage tolerance)
          extraOptions as `0x${string}`,
        ],
      });

      console.log(`   Required fee: ${fee} wei (${Number(fee) / 1e18} ETH)\n`);
    }

    // Execute receiveAndBridge
    console.log("\n🚀 Executing receiveAndBridge...");
    
    try {
      const hash = await walletClient.writeContract({
        address: getAddress(VALIDATOR_ADDRESS),
        abi: validatorAbi,
        functionName: "receiveAndBridge",
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
          ENDPOINT_IDS.baseSepolia,  // ✅ Cambiado a Base Sepolia
          destinationAddress,
          amount, // minAmountLD
          extraOptions as `0x${string}`,
        ] as any,
        value: 10836717158353n, // LayerZero fee from quote
      });

      console.log("⏳ Transaction sent:", hash);
      console.log("⏳ Waiting for confirmation...");

      const receipt = await publicClient.waitForTransactionReceipt({ hash });
      console.log("✅ Transaction confirmed in block:", receipt.blockNumber);

      console.log("\n🎉 Success!");
      console.log("   Tokens are being bridged to Base Sepolia");
      console.log("   Track your transaction on LayerZero Scan:");
      console.log(`   https://testnet.layerzeroscan.com/tx/${hash}`);
      console.log("\n   It may take 1-5 minutes for tokens to arrive on destination chain");
      
      return; // Success! Exit the loop
    } catch (error: any) {
      lastError = error;
      
      // Check if it's a nonce-related error
      let errorSignature = error.signature;
      if (!errorSignature && error.cause) {
        errorSignature = error.cause.signature;
      }
      
      const errorMessage = error.message || "";
      
      if (errorSignature === "0x756688fe" || errorSignature === "0x815e1d64" ||
          errorMessage.includes("0x756688fe") || errorMessage.includes("InvalidNonce")) {
        console.log(`❌ Attempt ${attempt + 1} failed (nonce already used)`);
        console.log("   Trying next nonce...");
        continue; // Try next nonce
      } else {
        // Different error, throw it
        console.error(`\n❌ Unexpected error (not a nonce issue):`);
        console.error("   Error signature:", errorSignature || "unknown");
        throw error;
      }
    }
  }

  // If we get here, all attempts failed
  console.error("\n❌ All nonce attempts failed!");
  if (lastError) {
    throw lastError;
  } else {
    throw new Error("Failed to bridge after multiple nonce attempts");
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });

