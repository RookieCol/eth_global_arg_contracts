// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

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

/// @notice Valida firmas Permit2 sin transferir tokens
contract Permit2TransferValidator {
    /// @notice Dirección oficial de Permit2
    IAllowanceTransfer public constant PERMIT2 =
        IAllowanceTransfer(0x000000000022D473030F116dDEE9F6B43aC78BA3);

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
}
