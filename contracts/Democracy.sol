// SPDX-License-Identifier: MIT
pragma solidity 0.7.3;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/math/SafeMath.sol";
import "@openzeppelin/contracts/utils/Arrays.sol";
import "@openzeppelin/contracts/utils/Counters.sol";
import "./IProofOfHumanity.sol";

/**
 *  @title Democracy
 *  A proxy contract for ProofOfHumanity that implements a token interface to interact with other dapps.
 */
contract Democracy is IERC20 {
    using SafeMath for uint256;
    using Arrays for uint256[];
    using Counters for Counters.Counter;

    IProofOfHumanity public PoH;
    address public deployer = msg.sender;

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
     *  @param _PoH The address of the related ProofOfHumanity contract.
     */
    constructor(IProofOfHumanity _PoH) public {
        PoH = _PoH;
    }

    /** @dev Changes the address of the the related ProofOfHumanity contract.
     *  @param _PoH The address of the new contract.
     */
    function changePoH(IProofOfHumanity _PoH) external onlyDeployer {
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
    // *      Snaptshot   * //
    // ******************** //

    /** @dev External function for Snapshot event emitter only accessible by deployer.  */
    function _snapshot() external onlyDeployer returns (uint256) {
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
        // solhint-disable-next-line max-line-length
        require(snapshotId <= _currentSnapshotId.current(), "ERC20Snapshot: nonexistent id");

        // When a valid snapshot is queried, there are three possibilities:
        //  a) The queried value was not modified after the snapshot was taken. Therefore, a snapshot entry was never
        //  created for this id, and all stored snapshot ids are smaller than the requested one. The value that corresponds
        //  to this id is the current one.
        //  b) The queried value was modified after the snapshot was taken. Therefore, there will be an entry with the
        //  requested id, and its value is the one to return.
        //  c) More snapshots were created after the requested one, and the queried value was later modified. There will be
        //  no entry for the requested id: the value that corresponds to it is that of the smallest snapshot id that is
        //  larger than the requested one.
        //
        // In summary, we need to find an element in an array, returning the index of the smallest value that is larger if
        // it is not found, unless said value doesn't exist (e.g. when all values are smaller). Arrays.findUpperBound does
        // exactly this.

        uint256 index = snapshots.ids.findUpperBound(snapshotId);

        if (index == snapshots.ids.length) {
            return (false, 0);
        } else {
            return (true, snapshots.values[index]);
        }
    }

    function _updateAccountSnapshot(address account) private {
        _updateSnapshot(_accountBalanceSnapshots[account], this.balanceOf(account));
    }

    function _updateTotalSupplySnapshot() private {
        _updateSnapshot(_totalSupplySnapshots, this.totalSupply());
    }

    function _updateSnapshot(Snapshots storage snapshots, uint256 currentValue) private {
        uint256 currentId = _currentSnapshotId.current();
        if (_lastSnapshotId(snapshots.ids) < currentId) {
            snapshots.ids.push(currentId);
            snapshots.values.push(currentValue);
        }
    }

    function _lastSnapshotId(uint256[] storage ids) private view returns (uint256) {
        if (ids.length == 0) {
            return 0;
        } else {
            return ids[ids.length - 1];
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
