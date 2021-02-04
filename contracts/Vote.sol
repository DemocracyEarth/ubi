// SPDX-License-Identifier: MIT
pragma solidity 0.7.3;

import "@openzeppelin/contracts/token/ERC20/ERC20Snapshot.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/math/SafeMath.sol";
import "@openzeppelin/contracts/utils/Arrays.sol";
import "@openzeppelin/contracts/utils/Counters.sol";
import "./Humanity.sol";

/**
 *  @title Vote
 *  A proxy contract for ProofOfHumanity that implements a token interface to interact with other dapps.
 */
contract Vote is ForHumans, ERC20Snapshot {
    uint256 MAX_INT = 1 ether;
    
    address public deployer = msg.sender;

    string private _name;
    string private _symbol;
    uint8 private _decimals;

    /// @dev Verifies sender has ability to modify governed parameters.
    modifier onlyDeployer() {
      require(deployer == msg.sender, "The caller must be the deployer");
      _;
    }

    /** @dev Constructor.
     *  @param _proofOfHumanity The address of the related ProofOfHumanity contract.
     */
    constructor(string memory name_, string memory symbol_, IProofOfHumanity _proofOfHumanity) ERC20(name_, symbol_) public {
        proofOfHumanity = _proofOfHumanity;
    }

    /** @dev Changes the address of the the related ProofOfHumanity contract.
     *  @param _proofOfHumanity The address of the new contract.
     */
    function changeProofOfHumanity(IProofOfHumanity _proofOfHumanity) external onlyDeployer {
        proofOfHumanity = _proofOfHumanity;
    }

    /** @dev Returns true if the submission is registered and not expired.
     *  @param submission The address of the submission.
     *  @return Whether the submission is registered or not.
     */
    function isHuman(address submission) public view returns (bool) {
        (, , , , bool registered) = proofOfHumanity.getSubmissionInfo(submission);
        return registered;
    }

    // ******************** //
    // *    Snapshot      * //
    // ******************** //

    /** @dev External function for Snapshot event emitter only accessible by deployer.  */
    function snapshot() external onlyDeployer returns (uint256) {
        return _snapshot();
    }

    // ******************** //
    // *      IERC20      * //
    // ******************** //

    /** @dev Returns the balance of a particular submission of the ProofOfHumanity contract.
     *  Note that this function takes the expiration date into account.
     *  @param submission The address of the submission.
     *  @return The balance of the submission.
     */
    function balanceOf(address submission) public view override returns (uint256) {
        return isHuman(submission) ? MAX_INT : 0;
    }

    /** @dev Returns the count of all submissions that were successfully registered, regardless of whether they're expired or not.
     *  Note that with the current implementation of ProofOfHumanity it'd be very costly to filter all the expired submissions.
     *  @return The count of registered submissions.
     */
    function totalSupply() public view override returns (uint256) {
        return proofOfHumanity.registrationCounter();
    }

    function transfer(address _recipient, uint256 _amount) public pure override returns (bool) { return false; }

    function allowance(address _owner, address _spender) public override view returns (uint256) {}

    function approve(address _spender, uint256 _amount) public pure override returns (bool) { return false; }

    function transferFrom(address _sender, address _recipient, uint256 _amount) public pure override returns (bool) { return false; }
}
