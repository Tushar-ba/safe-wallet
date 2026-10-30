// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

interface ISafe {
    function isOwner(address owner) external view returns (bool);

    function getTransactionHash(
        address to,
        uint256 value,
        bytes calldata data,
        uint8 operation,
        uint256 safeTxGas,
        uint256 baseGas,
        uint256 gasPrice,
        address gasToken,
        address refundReceiver,
        uint256 _nonce
    ) external view returns (bytes32);
}

/// @title TxProposalRegistry
/// @notice Stateless, event-only registry so Safe owners can publish transaction proposals on-chain
///         without a backend or the Safe Transaction Service. Votes are NOT stored here: owners vote
///         with Safe.approveHash(safeTxHash) and the app reads Safe.approvedHashes.
/// @dev Fixed Safe parameters for every proposal: operation = CALL (0), safeTxGas = 0, baseGas = 0,
///      gasPrice = 0, gasToken = address(0), refundReceiver = address(0).
///      The UI dedupes proposals by safeTxHash; proposing the same tx twice just emits a duplicate event.
contract TxProposalRegistry {
    event Proposed(
        address indexed safe,
        bytes32 indexed safeTxHash,
        address indexed proposer,
        address to,
        uint256 value,
        bytes data,
        uint256 nonce
    );

    error NotSafeOwner();

    function propose(address safe, address to, uint256 value, bytes calldata data, uint256 nonce) external returns (bytes32 safeTxHash) {
        if (!ISafe(safe).isOwner(msg.sender)) revert NotSafeOwner();
        safeTxHash = ISafe(safe).getTransactionHash(to, value, data, 0, 0, 0, 0, address(0), address(0), nonce);
        emit Proposed(safe, safeTxHash, msg.sender, to, value, data, nonce);
    }
}
