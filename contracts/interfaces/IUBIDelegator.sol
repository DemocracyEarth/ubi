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

    /// @dev Returns the UBI per second that the human has locked for delegation
    function getDelegatedRate(address _human) external virtual view returns(uint256);

    //// EVENTS /////

    /**
     * @dev Called when new supply must be calculated for a given human. This should return the new supply generated from the delegations made and received by the account.
     */
    //function newSupplyFrom(address human) external virtual view returns(uint256);
    
    /**
     * Executed from the UBI contract when reportRemoval is executed on the UBI contract.
     */
    function onReportRemoval(address _human) external virtual;


    //// VIEWS ////
    /**
     * @dev gets the outgoing delegated value on the given time range.
     */
    //function getTotalDelegatedRate(address sender, uint256 startTime, uint256 endTime) external virtual view returns (uint256);

    /**
     * @dev gets the incoming delegated value at a given date range.
     */
    function incomingTotalAccruedValue(address _human) external virtual view returns (uint256);
    function outgoingTotalAccruedValue(address _human) external virtual view returns (uint256);
    // function incomingRatePerSecond(address _human) external virtual view returns (uint256);
    // function outgoingRatePerSecond(address _human) external virtual view returns (uint256);

    function getDelegationInfo(uint256 delegationId) external virtual view returns (address sender, address recipient, uint256 ratePerSecond, bool isActive);
    function onWithdraw(uint256 delegationId) external virtual returns(uint256 amountWithdrawn);   
    // function accumulatedTime(uint256 delegationId) external virtual view returns (uint256);
}