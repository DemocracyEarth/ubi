// SPDX-License-Identifier: MIT
pragma solidity >=0.5.17;

import "@openzeppelin/contracts/token/ERC721/IERC721.sol";

/**
 * @title IStreamable Types
 * @author Sablier - juanu.eth
 */
library Types {
    struct Stream {
        uint256 ratePerSecond; // The rate of UBI to drip to this stream from the current accrued value
        uint256 startTime;
        uint256 stopTime;
        address recipient;
        address sender;
        bool isEntity;
        uint256 accruedSince;
    }
}

/**
 * @title IStreamable
 * @author Sablier - juanu.eth
 */
interface ISUBI is IERC721 {
    /**
     * @notice Emits when a stream is successfully created.
     */
    event CreateStream(
        address indexed sender,
        address indexed recipient,
        uint256 streamId,
        uint256 ratePerSecond,
        uint256 startTime,
        uint256 stopTime
    );

    /**
     * @notice Emits when the recipient of a stream withdraws a portion or all their pro rata share of the stream.
     */
    event WithdrawFromStream(
        uint256 indexed streamId,
        address indexed recipient,
        uint256 amount
    );

    /**
     * @notice Emits when a stream is successfully cancelled and tokens are transferred back on a pro rata basis.
     */
    event CancelStream(
        uint256 indexed streamId,
        address indexed sender,
        address indexed recipient
    );

    function balanceOfStream(uint256 streamId)
        external
        view
        returns (uint256 balance);

    function getStream(uint256 streamId)
        external
        view
        returns (uint256 ratePerSecond, // The rate of UBI to drip to this stream from the current accrued value
        uint256 startTime,
        uint256 stopTime,
        address recipient,
        address sender,
        bool isEntity,
        uint256 accruedSince);

    function getStreamsOf(address _human) external view returns (uint256[] memory);

    function maxStreamsAllowed() external view returns (uint256); 
    /**
     * @notice Returns either the delta in seconds between `block.timestamp` and `startTime` or
     *  between `stopTime` and `startTime, whichever is smaller. If `block.timestamp` is before
     *  `startTime`, it returns 0.
     * @dev Throws if the id does not point to a valid stream.
     * @param streamId ID of the stream for which to query the delta.
     */
    function accruedTime(uint256 streamId) external view returns (uint256);

    function mintStream(address sender, address recipient, uint256 ubiPerSecond, uint256 startTime, uint256 stopTime) external returns (uint256 streamId);

    function streamExists(uint256 streamId) external view returns (bool);
    //function withdrawFromStream(uint256 streamId) external;

    //function cancelStream(uint256 streamId) external;

    /**
     * @dev gets the delegated accrued value.
     * This sums the accrued value of all active streams from the human's `accruedSince` to `block.timestamp`
     */
    function getDelegatedAccruedValue(address _human) external view returns (uint256);

    /// @dev Callback for when UBI contract has withdrawn from a Stream.
    function onWithdrawnFromStream(uint256 streamId, uint256 withdrawnBalance) external;
}
