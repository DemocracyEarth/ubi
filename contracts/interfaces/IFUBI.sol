// SPDX-License-Identifier: MIT
pragma solidity >=0.5.17;

import "@openzeppelin/contracts/token/ERC721/IERC721.sol";



/**
 * @title IFlowable
 * @author Sablier - juanu.eth
 */
interface IFUBI is IERC721 {
    /**
     * @notice Emits when a Flow is successfully created.
     */
    event CreateFlow(
        address indexed sender,
        uint256 FlowId,
        uint256 ratePerSecond,
        uint256 startTime
    );

    // /**
    //  * @notice Emits when the recipient of a Flow withdraws a portion or all their pro rata share of the Flow.
    //  */
    // event WithdrawFromFlow(
    //     uint256 indexed FlowId,
    //     address indexed recipient,
    //     uint256 amount
    // );

    /**
     * @notice Emits when a Flow is successfully cancelled.
     */
    event CancelFlow(
        uint256 indexed FlowId,
        address indexed sender,
        address indexed recipient
    );


    function getFlow(uint256 FlowId)
        external
        view
        returns (uint256 ratePerSecond, // The rate of UBI to drip to this Flow from the current accrued value
        uint256 startTime,
        address sender,
        bool isActive);

    function getFlowsOf(address _human) external view returns (uint256[] memory);

    function mintFlow(address sender, address recipient, uint256 ubiPerSecond) external returns (uint256 FlowId);

    //function FlowExists(uint256 FlowId) external view returns (bool);
    //function withdrawFromFlow(uint256 FlowId) external;

    //function cancelFlow(uint256 FlowId) external;

    /**
     * @dev gets the delegated accrued value.
     * This sums the accrued value of all active Flows from the human's `accruedSince` to `block.timestamp`
     */
    function getDelegatedValue(address _human) external view returns (uint256);

    /// @dev Callback for when UBI contract has cancelled a Flow.
    function onCancelFlow(uint256 FlowId) external;
}
