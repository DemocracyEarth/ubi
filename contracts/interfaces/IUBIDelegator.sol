// SPDX-License-Identifier: MIT
pragma solidity 0.7.3;
interface IUBIDelegator {

    /**
     * @notice Emits when a Flow is successfully created.
     */
    event CreateDelegation(
        address indexed sender,
        uint256 id,
        uint256 ratePerSecond,
        uint256 startTime,
        uint256 endTime
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
    event CancelDelegation(
        uint256 indexed id,
        address indexed sender,
        address indexed recipient
    );

    function createDelegation(address sender, address recipient, uint256 ubiPerSecond, uint256 startTime, uint256 endTime, bool cancellable) external virtual returns(uint256);
    
    function cancelDelegation(uint256 delegationId) external virtual returns (uint256);

    /**
     * @dev Executed from the UBI contract when reportRemoval is executed on the UBI contract.
     */
    function onReportRemoval(address _human) external virtual;

    /**
     * @dev gets the incoming delegated value.
     */
    function incomingTotalAccruedValue(address _account) external virtual view returns (uint256);
    
    /**
     * @dev Gets the outgoing delegated accrued value. This should be since the accruedSince date of the human source.
     */
    function outgoingTotalAccruedValue(address _human) external virtual view returns (uint256);
    
    /**
     * @dev Returns the basic delegation info: sender, current recipient, rate per second and `isActive`.
     */
    function getDelegationInfo(uint256 delegationId) external virtual view returns (address sender, address recipient, uint256 ratePerSecond, bool isActive);
    
    /**
     * @dev Executed whenever the delegation is withdrawn. It should execute any processes required to update the delegation. Should return the amount withdrawn.
     */
    function onWithdraw(uint256 delegationId) external virtual returns(uint256 amountWithdrawn);   
}