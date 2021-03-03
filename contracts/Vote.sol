// SPDX-License-Identifier: MIT
pragma solidity 0.7.3;

import "@openzeppelin/contracts/utils/Arrays.sol";
import "@openzeppelin/contracts/utils/Counters.sol";

/**
 * @title ProofOfHumanity Interface
 * @dev See https://github.com/Proof-Of-Humanity/Proof-Of-Humanity.
 */
interface IProofOfHumanity {
  function isRegistered(address _submissionID)
    external
    view
    returns (
      bool registered
    );

  function submissionCounter() external view returns (uint count);
}

/**
 *  @title Vote
 *  A proxy contract for ProofOfHumanity that implements a token interface to interact with other dapps.
 */
contract Vote {

    using SafeMath for uint256;
    using Arrays for uint256[];
    using Counters for Counters.Counter;

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

    /* Events */

    /**
     * @dev Emitted by {_snapshot} when a snapshot identified by `id` is created.
     */
    event Snapshot(uint256 id);   

    /**
    * @dev Emitted when `value` tokens are moved from one account (`from`) to another (`to`).
    *
    * Note that `value` may be zero.
    * Also note that due to continuous minting we cannot emit transfer events from the address 0 when tokens are created.
    * In order to keep consistency, we decided not to emit those events from the address 0 even when minting is done within a transaction.
    */
    event Transfer(address indexed from, address indexed to, uint256 value);

    /**
    * @dev Emitted when the allowance of a `spender` for an `owner` is set by
    * a call to {approve}. `value` is the new allowance.
    */
    event Approval(address indexed owner, address indexed spender, uint256 value); 

    /* Storage */

    mapping (address => uint256) private balance;
    
    /// @dev Name of the token.
    string public name;
    
    /// @dev Symbol of the token.
    string public symbol;
    
    /// @dev Number of decimals of the token.
    uint8 public decimals;

    /// @dev Contract deployer
    address public deployer = msg.sender;

    /// @dev A large integer to enable computable tallying.
    uint256 private MAX_INT = 10 ** 18;

    /// @dev The Proof Of Humanity registry to reference.
    IProofOfHumanity public proofOfHumanity; 
    
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
    constructor(string memory name_, string memory symbol_, IProofOfHumanity _proofOfHumanity) {
        name = name_;
        symbol = symbol_;
        decimals = 18;
        proofOfHumanity = _proofOfHumanity;
    }

    /* External */

    /** @dev Changes the address of the related ProofOfHumanity contract.
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

    /* ERC20 */

   function _mint(address account, uint256 amount) internal virtual {
        require(account != address(0), "ERC20: mint to the zero address");

        _beforeTokenTransfer(address(0), account, amount);

        balance[account] = balanceOf(account);
        emit Transfer(address(0), account, amount);
    } 

    /* Snapshot */

    /** @dev Takes a Snapshot of the balance based on the ProofOfHumanity status. */
    function register(address _submission) external {
        _mint(_submission, balanceOf(_submission));
    }

    function snapshot() external onlyDeployer returns (uint256) {
        _currentSnapshotId.increment();

        uint256 currentId = _currentSnapshotId.current();
        emit Snapshot(currentId);
        return currentId;
    }
    /**
     * @dev Retrieves the balance of `account` at the time `snapshotId` was created.
     */
    function balanceOfAt(address account, uint256 snapshotId) public view virtual returns (uint256) {
        (bool snapshotted, uint256 value) = _valueAt(snapshotId, _accountBalanceSnapshots[account]);

        return snapshotted ? value : balanceOf(account);
    }

    /**
     * @dev Retrieves the total supply at the time `snapshotId` was created.
     */
    function totalSupplyAt(uint256 snapshotId) public view virtual returns(uint256) {
        (bool snapshotted, uint256 value) = _valueAt(snapshotId, _totalSupplySnapshots);

        return snapshotted ? value : totalSupply();
    }


    // Update balance and/or total supply snapshots before the values are modified. This is implemented
    // in the _beforeTokenTransfer hook, which is executed for _mint, _burn, and _transfer operations.
    function _beforeTokenTransfer(address from, address to, uint256 amount) internal virtual {
      if (from == address(0)) {
        // mint
        _updateAccountSnapshot(to);
        _updateTotalSupplySnapshot();
      } else if (to == address(0)) {
        // burn
        _updateAccountSnapshot(from);
        _updateTotalSupplySnapshot();
      } else {
        // transfer
        _updateAccountSnapshot(from);
        _updateAccountSnapshot(to);
      }
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
        _updateSnapshot(_accountBalanceSnapshots[account], balanceOf(account));
    }

    function _updateTotalSupplySnapshot() private {
        _updateSnapshot(_totalSupplySnapshots, totalSupply());
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

    /* ERC20 */

    /** @dev Returns the balance of a particular submission of the ProofOfHumanity contract.
     *  Note that this function takes the expiration date into account.
     *  @param _submission The address of the submission.
     *  @return The balance of the submission.
     */
    function balanceOf(address _submission) public view returns (uint256) {
        return isHuman(_submission) ? MAX_INT : 0;
    }

    /** @dev Returns the count of all submissions that made a registration request at some point, including those that were added manually.
     *  Note that with the current implementation of ProofOfHumanity it'd be very costly to count only the submissions that are currently registered.
     *  @return The total count of submissions.
     */
    function totalSupply() public view returns (uint256) {
        return proofOfHumanity.submissionCounter();
    }

    function transfer(address _recipient, uint256 _amount) public pure returns (bool) { return false; }

    function allowance(address _owner, address _spender) public view returns (uint256) {}

    function approve(address _spender, uint256 _amount) public pure returns (bool) { return false; }

    function transferFrom(address _sender, address _recipient, uint256 _amount) public pure returns (bool) { return false; }
}
