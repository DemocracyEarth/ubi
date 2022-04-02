// SPDX-License-Identifier: MIT
pragma solidity 0.7.3;
interface IUBIDelegator {

    function createDelegation(address sender, address recipient, uint256 ubiPerSecond, uint256 startTime, uint256 endTime, bool cancellable) external virtual returns(uint256);

    function cancelDelegation(uint256 delegationId) external virtual;

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
    function getTotalDelegatedRate(address sender, uint256 startTime, uint256 endTime) external virtual view returns (uint256);

    /**
     * @dev gets the incoming delegated value at a given date range.
     */
    function incomingTotalAccruedValue(address _human) external virtual view returns (uint256);
    function outgoingTotalAccruedValue(address _human) external virtual view returns (uint256);

    function getDelegationNodes(uint256 delegationId) external virtual view returns (address sender, address recipient);
    
}