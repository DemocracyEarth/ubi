// SPDX-License-Identifier: MIT
pragma solidity >=0.5.17;

import "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import "./IUBIDelegator.sol";


/**
 * @title IFlowable
 * @author Sablier - juanu.eth
 */
interface IFUBI is IERC721, IUBIDelegator  {


    function getFlow(uint256 FlowId)
        external
        view
        returns (uint256 ratePerSecond, // The rate of UBI to drip to this Flow from the current accrued value
        uint256 startTime,
        address sender,
        bool isActive);

    function getFlowsOf(address _human) external view returns (uint256[] memory);

    function maxFlowsAllowed() external view returns (uint256); 

    //function FlowExists(uint256 FlowId) external view returns (bool);
    //function withdrawFromFlow(uint256 FlowId) external;

    //function cancelFlow(uint256 FlowId) external;

    /**
     * @dev gets the delegated accrued value.
     * This sums the accrued value of all active Flows from the human's `accruedSince` to `block.timestamp`
     */
    // function getDelegatedValue(address _human) external view returns (uint256);

    /// @dev Callback for when UBI contract has cancelled a Flow.
    //function onCancelFlow(uint256 FlowId) external;
}
