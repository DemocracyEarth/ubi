// SPDX-License-Identifier: MIT
pragma solidity 0.7.3;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "./IProofOfHumanity.sol";

/**
 *  @title Democracy
 *  A proxy contract for ProofOfHumanity that implements a token interface to interact with other dapps.
 */
contract Democracy is IERC20 {

    IProofOfHumanity public PoH;
    address public deployer = msg.sender;

    /** @dev Constructor.
     *  @param _PoH The address of the related ProofOfHumanity contract.
     */
    constructor(IProofOfHumanity _PoH) public {
        PoH = _PoH;
    }

    /** @dev Changes the address of the the related ProofOfHumanity contract.
     *  @param _PoH The address of the new contract.
     */
    function changePoH(IProofOfHumanity _PoH) external {
        require(msg.sender == deployer, "The caller must be the deployer");
        PoH = _PoH;
    }

    /** @dev Returns true if the submission is registered and not expired.
     *  @param human The address of the submission.
     *  @return Whether the submission is registered or not.
     */
    function isRegistered(address human) public view returns (bool) {
        (, , , , bool registered) = PoH.getSubmissionInfo(human);
        return registered;
    }

    // ******************** //
    // *      IERC20      * //
    // ******************** //

    /** @dev Returns the balance of a particular submission of the ProofOfHumanity contract.
     *  Note that this function takes the expiration date into account.
     *  @param human The address of the submission.
     *  @return The balance of the submission.
     */
    function balanceOf(address human) external view override returns (uint256) {
        return isRegistered(human) ? 1 : 0;
    }

    /** @dev Returns the count of all submissions that were successfully registered, regardless of whether they're expired or not.
     *  Note that with the current implementation of ProofOfHumanity it'd be very costly to filter all the expired submissions.
     *  @return The count of registered submissions.
     */
    function totalSupply() external view override returns (uint256) {
        return PoH.registrationCounter();
    }

    function transfer(address _recipient, uint256 _amount) external pure override returns (bool) { return false; }

    function allowance(address _owner, address _spender) external override view returns (uint256) {}

    function approve(address _spender, uint256 _amount) external pure override returns (bool) { return false; }

    function transferFrom(address _sender, address _recipient, uint256 _amount) external pure override returns (bool) { return false; }
}
