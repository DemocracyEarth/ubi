pragma solidity >=0.5.17;

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
interface IStreamable {
    /**
     * @notice Emits when a stream is successfully created.
     */
    event CreateStream(
        uint256 indexed streamId,
        address indexed sender,
        address indexed recipient,
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

    function balanceOf(uint256 streamId)
        external
        view
        returns (uint256 balance);

    function getStream(uint256 streamId)
        external
        view
        returns (
            address sender,
            address recipient,
            uint256 startTime,
            uint256 stopTime,
            uint256 remainingBalance,
            uint256 ratePerSecond
        );

    function createStream(
        address recipient,
        uint256 deposit,
        address tokenAddress,
        uint256 startTime,
        uint256 stopTime
    ) external returns (uint256 streamId);

    function withdrawFromStream(uint256 streamId)
        external;

    function cancelStream(uint256 streamId) external;
}
