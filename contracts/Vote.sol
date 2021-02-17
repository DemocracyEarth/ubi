// SPDX-License-Identifier: MIT
pragma solidity 0.7.3;

import "@openzeppelin/contracts/token/ERC20/ERC20Snapshot.sol";
import "@openzeppelin/contracts/utils/Arrays.sol";
import "@openzeppelin/contracts/utils/Counters.sol";
import "./Humanity.sol";

/**
 *  @title Vote
 *  A proxy contract for ProofOfHumanity that implements a token interface to interact with other dapps.
 */
contract Vote is ForHumans, ERC20Snapshot {

    /* Storage */

    address public deployer = msg.sender;
    uint256 private MAX_INT = 10 ** 18;

    /* Modifiers */

    /// @dev Verifies that the sender has ability to modify governed parameters.
    modifier onlyDeployer() {
      require(deployer == msg.sender, "The caller must be the deployer");
      _;
    }

    /* Constructor */

    /** @dev Constructor.
     *  @param _proofOfHumanity The address of the related ProofOfHumanity contract.
     */
    constructor(string memory name_, string memory symbol_, IProofOfHumanity _proofOfHumanity) ERC20(name_, symbol_) public {
        proofOfHumanity = _proofOfHumanity;
    }

    /* External */

    /** @dev Changes the address of the the related ProofOfHumanity contract.
     *  @param _proofOfHumanity The address of the new contract.
     */
    function changeProofOfHumanity(IProofOfHumanity _proofOfHumanity) external onlyDeployer {
        proofOfHumanity = _proofOfHumanity;
    }

    /** @dev Returns true if the submission is registered and not expired.
     *  @param _submission The address of the submission.
     *  @return Whether the submission is registered or not.
     */
    function isHuman(address _submission) public view returns (bool) {
        bool registered = proofOfHumanity.isRegistered(_submission);
        return registered;
    }

    /* Snapshot */

    /** @dev External function for Snapshot event emitter only accessible by deployer.  */
    function snapshot() external onlyDeployer returns (uint256) {
        return _snapshot();
    }

    /** @dev Takes a Snapshot of the balance based on the ProofOfHumanity status. */
    function register(address _submission) external {
        _mint(_submission, balanceOf(_submission));
    }

    /* ERC20 */

    /** @dev Returns the balance of a particular submission of the ProofOfHumanity contract.
     *  Note that this function takes the expiration date into account.
     *  @param _submission The address of the submission.
     *  @return The balance of the submission.
     */
    function balanceOf(address _submission) public view override returns (uint256) {
        return isHuman(_submission) ? MAX_INT : 0;
    }

    /** @dev Returns the count of all submissions that made a registration request at some point, including those that were added manually.
     *  Note that with the current implementation of ProofOfHumanity it'd be very costly to count only the submissions that are currently registered.
     *  @return The total count of submissions.
     */
    function totalSupply() public view override returns (uint256) {
        return proofOfHumanity.submissionCounter();
    }

    function transfer(address _recipient, uint256 _amount) public pure override returns (bool) { return false; }

    function allowance(address _owner, address _spender) public override view returns (uint256) {}

    function approve(address _spender, uint256 _amount) public pure override returns (bool) { return false; }

    function transferFrom(address _sender, address _recipient, uint256 _amount) public pure override returns (bool) { return false; }
}
