// SPDX-License-Identifier: MIT
pragma solidity 0.7.3;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/math/SafeMath.sol";
import "@openzeppelin/contracts/utils/Arrays.sol";
import "@openzeppelin/contracts/utils/Counters.sol";
import "./Humanity.sol";

/**
 *  @title Vote
 *  A proxy contract for ProofOfHumanity that implements a token interface to interact with other dapps.
 */
contract Vote is ForHumans, IERC20 {
    using SafeMath for uint256;
    using Arrays for uint256[];
    using Counters for Counters.Counter;

    uint256 MAX_INT = 1 ether;
    
    address public deployer = msg.sender;

    string private _name;
    string private _symbol;
    uint8 private _decimals;

    // Snapshotted values have arrays of ids and the value corresponding to that id. These could be an array of a
    // Snapshot struct, but that would impede usage of functions that work on an array.
    struct Snapshots {
        uint256[] ids;
        uint256[] values;
    }

    mapping (address => Snapshots) private _accountBalanceSnapshots;
    Snapshots private _totalSupplySnapshots;

    // Snapshot ids increase monotonically, with the first value being 1. An id of 0 is invalid.
    Counters.Counter private _currentSnapshotId;

    /**
     * @dev Emitted by {_snapshot} when a snapshot identified by `id` is created.
     */
    event Snapshot(uint256 id);

    /// @dev Verifies sender has ability to modify governed parameters.
    modifier onlyDeployer() {
      require(deployer == msg.sender, "The caller must be the deployer");
      _;
    }

    /** @dev Constructor.
     *  @param _proofOfHumanity The address of the related ProofOfHumanity contract.
     */
    constructor(string memory name_, string memory symbol_, IProofOfHumanity _proofOfHumanity) public {
        proofOfHumanity = _proofOfHumanity;
        _name = name_;
        _symbol = symbol_;
        _decimals = 18;
    }

    /** @dev Changes the address of the the related ProofOfHumanity contract.
     *  @param _proofOfHumanity The address of the new contract.
     */
    function changeProofOfHumanity(IProofOfHumanity _proofOfHumanity) external onlyDeployer {
        proofOfHumanity = _proofOfHumanity;
    }

    /** @dev Returns true if the submission is registered and not expired.
     *  @param human The address of the submission.
     *  @return Whether the submission is registered or not.
     */
    function isHuman(address human) public view returns (bool) {
        (, , , , bool registered) = proofOfHumanity.getSubmissionInfo(human);
        return registered;
    }

    // ******************** //
    // *    Snapshot      * //
    // ******************** //

    /** @dev External function for Snapshot event emitter only accessible by deployer.  */
    function snapshot() external onlyDeployer returns (uint256) {
        _currentSnapshotId.increment();

        uint256 currentId = _currentSnapshotId.current();
        emit Snapshot(currentId);
        return currentId;
    }

    /**
     * @dev Retrieves the balance of `account` at the time `snapshotId` was created.
     */
    function balanceOfAt(address account, uint256 snapshotId) public view returns (uint256) {
        (bool snapshotted, uint256 value) = _valueAt(snapshotId, _accountBalanceSnapshots[account]);

        return snapshotted ? value : this.balanceOf(account);
    }

    /**
     * @dev Retrieves the total supply at the time `snapshotId` was created.
     */
    function totalSupplyAt(uint256 snapshotId) public view returns(uint256) {
        (bool snapshotted, uint256 value) = _valueAt(snapshotId, _totalSupplySnapshots);

        return snapshotted ? value : this.totalSupply();
    }

    function _valueAt(uint256 snapshotId, Snapshots storage snapshots)
        private view returns (bool, uint256)
    {
        require(snapshotId > 0, "ERC20Snapshot: id is 0");
        require(snapshotId <= _currentSnapshotId.current(), "ERC20Snapshot: nonexistent id");

        uint256 index = snapshots.ids.findUpperBound(snapshotId);

        if (index == snapshots.ids.length) {
            return (false, 0);
        } else {
            return (true, snapshots.values[index]);
        }
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
        return isHuman(human) ? MAX_INT : 0;
    }

    /** @dev Returns the count of all submissions that were successfully registered, regardless of whether they're expired or not.
     *  Note that with the current implementation of ProofOfHumanity it'd be very costly to filter all the expired submissions.
     *  @return The count of registered submissions.
     */
    function totalSupply() external view override returns (uint256) {
        return proofOfHumanity.registrationCounter();
    }

    /**
     * @dev Returns the name of the token.
     */
    function name() public view virtual returns (string memory) {
        return _name;
    }

    /**
     * @dev Returns the symbol of the token, usually a shorter version of the
     * name.
     */
    function symbol() public view virtual returns (string memory) {
        return _symbol;
    }

    /**
     * @dev Returns the number of decimals used to get its user representation.
     * {IERC20-balanceOf} and {IERC20-transfer}.
     */
    function decimals() public view virtual returns (uint8) {
        return _decimals;
    }

    function transfer(address _recipient, uint256 _amount) external pure override returns (bool) { return false; }

    function allowance(address _owner, address _spender) external override view returns (uint256) {}

    function approve(address _spender, uint256 _amount) external pure override returns (bool) { return false; }

    function transferFrom(address _sender, address _recipient, uint256 _amount) external pure override returns (bool) { return false; }
}
