// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

// Interface for OFT bridge functionality
interface IOFT {
    /// @notice Struct for sending parameters
    struct SendParam {
        uint32 dstEid;
        bytes32 to;
        uint256 amountLD;
        uint256 minAmountLD;
        bytes extraOptions;
        bytes composeMsg;
        bytes oftCmd;
    }

    /// @notice Struct for messaging fee
    struct MessagingFee {
        uint256 nativeFee;
        uint256 lzTokenFee;
    }

    /// @notice Send tokens cross-chain
    function send(
        SendParam calldata _sendParam,
        MessagingFee calldata _fee,
        address _refundAddress
    ) external payable returns (MessagingReceipt memory msgReceipt, OFTReceipt memory oftReceipt);

    /// @notice Quote for sending tokens
    function quoteSend(
        SendParam calldata _sendParam,
        bool _payInLzToken
    ) external view returns (MessagingFee memory msgFee);

    /// @notice ERC20 approve
    function approve(address spender, uint256 amount) external returns (bool);
    
    /// @notice ERC20 balanceOf
    function balanceOf(address account) external view returns (uint256);

    /// @notice Receipt from messaging
    struct MessagingReceipt {
        bytes32 guid;
        uint64 nonce;
        MessagingFee fee;
    }

    /// @notice Receipt from OFT transfer
    struct OFTReceipt {
        uint256 amountSentLD;
        uint256 amountReceivedLD;
    }
}

/// @notice Interfaz correcta de AllowanceTransfer (Permit2) según Uniswap
interface IAllowanceTransfer {
    struct PermitDetails {
        address token;
        uint160 amount;
        uint48 expiration;
        uint48 nonce;
    }

    struct PermitSingle {
        PermitDetails details;
        address spender;
        uint256 sigDeadline;
    }

    function permit(
        address owner,
        PermitSingle calldata permitSingle,
        bytes calldata signature
    ) external;

    function transferFrom(
        address from,
        address to,
        uint160 amount,
        address token
    ) external;
}

/// @notice Interface for Permit2 SignatureTransfer (gasless, no approve needed)
interface ISignatureTransfer {
    struct TokenPermissions {
        address token;
        uint256 amount;
    }

    struct PermitTransferFrom {
        TokenPermissions permitted;
        uint256 nonce;
        uint256 deadline;
    }

    struct SignatureTransferDetails {
        address to;
        uint256 requestedAmount;
    }

    /// @notice Transfer tokens using a signed permit (no prior approve needed)
    function permitTransferFrom(
        PermitTransferFrom calldata permit,
        SignatureTransferDetails calldata transferDetails,
        address owner,
        bytes calldata signature
    ) external;
}

/// @notice Valida firmas Permit2 sin transferir tokens
contract Permit2TransferValidator {
    /// @notice Dirección oficial de Permit2
    IAllowanceTransfer public constant PERMIT2 =
        IAllowanceTransfer(0x000000000022D473030F116dDEE9F6B43aC78BA3);
    
    /// @notice SignatureTransfer interface (same address as Permit2)
    ISignatureTransfer public constant PERMIT2_SIGNATURE =
        ISignatureTransfer(0x000000000022D473030F116dDEE9F6B43aC78BA3);

    event PermitValidated(
        address indexed owner,
        address indexed token,
        address indexed spender,
        uint160 amount
    );

    event TokensTransferred(
        address indexed from,
        address indexed to,
        address indexed token,
        uint160 amount
    );

    event TokensBridged(
        address indexed from,
        address indexed token,
        uint32 indexed dstEid,
        address dstAddress,
        uint256 amount,
        bytes32 messageId
    );

    /**
     * @notice Valida la firma Permit2 sin transferir tokens
     * @param permitSingle Datos del permiso (AllowanceTransfer)
     * @param signature Firma EIP-712 del owner
     * @param owner Dirección que firmó
     */
    function validatePermit(
        IAllowanceTransfer.PermitSingle calldata permitSingle,
        bytes calldata signature,
        address owner
    ) external {
        // Llamada externa al contrato Permit2 desplegado (0x000000000022D473030F116dDEE9F6B43aC78BA3)
        // La función permit() del contrato Permit2 valida la firma EIP-712, verifica nonce/expiración
        // y registra el allowance. Si la firma es inválida, esta llamada revertirá.
        PERMIT2.permit(owner, permitSingle, signature);

        emit PermitValidated(
            owner,
            permitSingle.details.token,
            permitSingle.spender,
            permitSingle.details.amount
        );
    }

    /**
     * @notice Validates Permit2 signature and transfers tokens from owner to recipient
     * @param permitSingle Permit data (AllowanceTransfer)
     * @param signature EIP-712 signature from owner
     * @param owner Address that signed
     * @param recipient Address that will receive the tokens
     * @param amount Amount to transfer (must be <= permitSingle.details.amount)
     */
    function validatePermitAndTransfer(
        IAllowanceTransfer.PermitSingle calldata permitSingle,
        bytes calldata signature,
        address owner,
        address recipient,
        uint160 amount
    ) external {
        require(recipient != address(0), "Invalid recipient");
        require(recipient != address(this), "Cannot transfer to self");
        require(amount > 0, "Zero amount");
        require(
            amount <= permitSingle.details.amount,
            "Amount exceeds permitted"
        );
        require(
            permitSingle.details.token != address(0),
            "Invalid token"
        );
        require(
            permitSingle.spender == address(this),
            "Invalid spender"
        );

        // 1. Validate signature via Permit2 (registers allowance if valid)
        // Note: This will set/update the allowance in Permit2, but since we transfer
        // immediately after, the allowance will be consumed and won't accumulate
        PERMIT2.permit(owner, permitSingle, signature);

        // 2. Transfer tokens from owner to recipient using Permit2
        // This consumes from the allowance we just set, so it doesn't accumulate
        PERMIT2.transferFrom(
            owner,
            recipient,
            amount,
            permitSingle.details.token
        );

        emit TokensTransferred(
            owner,
            recipient,
            permitSingle.details.token,
            amount
        );
    }

    /**
     * @notice Validates Permit2 signature and transfers tokens to this contract
     * @dev This function is used to receive tokens before bridging to another chain
     * @param permitSingle Permit data (AllowanceTransfer)
     * @param signature EIP-712 signature from owner
     * @param owner Address that signed
     * @param amount Amount to transfer (must be <= permitSingle.details.amount)
     */
    function receiveTokensWithPermit(
        IAllowanceTransfer.PermitSingle calldata permitSingle,
        bytes calldata signature,
        address owner,
        uint160 amount
    ) external {
        require(amount > 0, "Zero amount");
        require(
            amount <= permitSingle.details.amount,
            "Amount exceeds permitted"
        );
        require(
            permitSingle.details.token != address(0),
            "Invalid token"
        );
        require(
            permitSingle.spender == address(this),
            "Invalid spender"
        );

        // 1. Validate signature via Permit2
        PERMIT2.permit(owner, permitSingle, signature);

        // 2. Transfer tokens from owner to this contract
        PERMIT2.transferFrom(
            owner,
            address(this),
            amount,
            permitSingle.details.token
        );

        emit TokensTransferred(
            owner,
            address(this),
            permitSingle.details.token,
            amount
        );
    }

    /**
     * @notice Validates Permit2 signature, receives tokens, and bridges them via LayerZero
     * @dev This is the main function for gasless cross-chain transfers
     * @param permitSingle Permit data (AllowanceTransfer)
     * @param signature EIP-712 signature from owner
     * @param owner Address that signed the permit
     * @param amount Amount to transfer and bridge
     * @param dstEid Destination chain endpoint ID (LayerZero)
     * @param dstAddress Recipient address on destination chain
     * @param minAmountLD Minimum amount to receive on destination (slippage protection)
     * @param extraOptions LayerZero execution options (gas limits, etc)
     */ 
    function receiveAndBridge(
        IAllowanceTransfer.PermitSingle calldata permitSingle,
        bytes calldata signature,
        address owner,
        uint160 amount,
        uint32 dstEid,
        address dstAddress,
        uint256 minAmountLD,
        bytes calldata extraOptions
    ) external payable {
        require(amount > 0, "Zero amount");
        require(dstAddress != address(0), "Invalid destination address");
        require(
            amount <= permitSingle.details.amount,
            "Amount exceeds permitted"
        );
        require(
            permitSingle.details.token != address(0),
            "Invalid token"
        );
        require(
            permitSingle.spender == address(this),
            "Invalid spender"
        );

        // 1. Validate signature and transfer tokens to this contract
        PERMIT2.permit(owner, permitSingle, signature);
        PERMIT2.transferFrom(
            owner,
            address(this),
            amount,
            permitSingle.details.token
        );

        emit TokensTransferred(
            owner,
            address(this),
            permitSingle.details.token,
            amount
        );

        // 2. Bridge tokens via LayerZero (using scope to reduce stack depth)
        {
            IOFT oft = IOFT(permitSingle.details.token);
            
            // Approve OFT contract to spend/burn tokens
            oft.approve(permitSingle.details.token, amount);
            
            // Send via LayerZero OFT
            bytes32 guid = _sendViaLayerZero(
                oft,
                dstEid,
                dstAddress,
                amount,
                minAmountLD,
                extraOptions,
                owner,
                msg.value
            );

            emit TokensBridged(
                owner,
                permitSingle.details.token,
                dstEid,
                dstAddress,
                amount,
                guid
            );
        }
    }

    /**
     * @notice GASLESS: Validates Permit2 signature, receives tokens, and bridges them via LayerZero
     * @dev Uses SignatureTransfer - NO PRIOR APPROVE NEEDED! Fully gasless for user.
     * @param permit Permit data (SignatureTransfer)
     * @param owner Address that signed the permit
     * @param signature EIP-712 signature from owner
     * @param dstEid Destination chain endpoint ID (LayerZero)
     * @param dstAddress Recipient address on destination chain
     * @param minAmountLD Minimum amount to receive on destination (slippage protection)
     * @param extraOptions LayerZero execution options (gas limits, etc)
     */
    function receiveAndBridgeGasless(
        ISignatureTransfer.PermitTransferFrom calldata permit,
        address owner,
        bytes calldata signature,
        uint32 dstEid,
        address dstAddress,
        uint256 minAmountLD,
        bytes calldata extraOptions
    ) external payable {
        require(permit.permitted.amount > 0, "Zero amount");
        require(dstAddress != address(0), "Invalid destination address");
        require(permit.permitted.token != address(0), "Invalid token");

        uint256 amount = permit.permitted.amount;

        // 1. Transfer tokens directly from owner to this contract using SignatureTransfer
        // NO PRIOR APPROVE NEEDED!
        PERMIT2_SIGNATURE.permitTransferFrom(
            permit,
            ISignatureTransfer.SignatureTransferDetails({
                to: address(this),
                requestedAmount: amount
            }),
            owner,
            signature
        );

        emit TokensTransferred(owner, address(this), permit.permitted.token, uint160(amount));

        // 2. Bridge tokens to destination chain via LayerZero OFT
        {
            IOFT oft = IOFT(permit.permitted.token);

            // Approve OFT to spend tokens from this contract
            oft.approve(address(oft), amount);

            bytes32 messageId = _sendViaLayerZero(
                oft,
                dstEid,
                dstAddress,
                amount,
                minAmountLD,
                extraOptions,
                owner, // Refund address
                msg.value // Native fee
            );

            emit TokensBridged(owner, permit.permitted.token, dstEid, dstAddress, amount, messageId);
        }
    }

    /**
     * @notice Internal helper to send via LayerZero (reduces stack depth)
     */
    function _sendViaLayerZero(
        IOFT oft,
        uint32 dstEid,
        address dstAddress,
        uint256 amount,
        uint256 minAmountLD,
        bytes calldata extraOptions,
        address refundAddress,
        uint256 nativeFee
    ) internal returns (bytes32) {
        // Prepare SendParam
        IOFT.SendParam memory sendParam = IOFT.SendParam({
            dstEid: dstEid,
            to: bytes32(uint256(uint160(dstAddress))),
            amountLD: amount,
            minAmountLD: minAmountLD,
            extraOptions: extraOptions,
            composeMsg: "",
            oftCmd: ""
        });

        // Prepare fee
        IOFT.MessagingFee memory fee = IOFT.MessagingFee({
            nativeFee: nativeFee,
            lzTokenFee: 0
        });

        // Send
        (IOFT.MessagingReceipt memory msgReceipt, ) = oft.send{value: nativeFee}(
            sendParam,
            fee,
            refundAddress
        );

        return msgReceipt.guid;
    }

    /**
     * @notice Quote the fee for bridging tokens via LayerZero
     * @param token OFT token address
     * @param dstEid Destination chain endpoint ID
     * @param dstAddress Recipient address on destination chain
     * @param amount Amount to bridge
     * @param minAmountLD Minimum amount (for slippage)
     * @param extraOptions LayerZero execution options
     * @return nativeFee Required fee in native token
     */
    function quoteBridge(
        address token,
        uint32 dstEid,
        address dstAddress,
        uint256 amount,
        uint256 minAmountLD,
        bytes calldata extraOptions
    ) external view returns (uint256 nativeFee) {
        IOFT oft = IOFT(token);
        
        bytes32 toAddress = bytes32(uint256(uint160(dstAddress)));
        IOFT.SendParam memory sendParam = IOFT.SendParam({
            dstEid: dstEid,
            to: toAddress,
            amountLD: amount,
            minAmountLD: minAmountLD,
            extraOptions: extraOptions,
            composeMsg: "",
            oftCmd: ""
        });

        IOFT.MessagingFee memory fee = oft.quoteSend(sendParam, false);
        return fee.nativeFee;
    }

    /**
     * @notice Withdraw tokens from contract (emergency or after receiving)
     * @param token Token address
     * @param to Recipient address
     * @param amount Amount to withdraw
     */
    function withdrawTokens(
        address token,
        address to,
        uint256 amount
    ) external {
        require(msg.sender == address(this) || to == msg.sender, "Not authorized");
        IOFT oft = IOFT(token);
        require(oft.balanceOf(address(this)) >= amount, "Insufficient balance");
        oft.approve(to, amount);
        // Transfer would need to be done by the token contract
    }
}
