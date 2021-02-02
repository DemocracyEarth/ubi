/**
 *  @authors: [@epiqueras, @santisiri]
 *  @reviewers: [@fnanni-0]
 *  @auditors: []
 *  @bounties: []
 *  @deployments: []
 */
// SPDX-License-Identifier: MIT
pragma solidity 0.7.3;

import "@openzeppelin/contracts-upgradeable/token/ERC20/ERC20BurnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/token/ERC20/ERC20SnapshotUpgradeable.sol";
import "./IProofOfHumanity.sol";
import "./Humans.sol";

contract UBI is ForHumans, Initializable, ERC20BurnableUpgradeable, ERC20SnapshotUpgradeable {

  /* Events */

  /** @dev Emitted when UBI is minted or taken by a reporter.
    *  @param _recipient The accruer of the UBI.
    *  @param _beneficiary The withdrawer or taker.
    *  @param _value The value withdrawn.
    */
  event Mint(
      address indexed _recipient,
      address indexed _beneficiary,
      uint256 _value
  );

  /* Storage */
    
  /// @dev How many tokens per second will be minted for every valid human.
  uint256 public accruedPerSecond;

  /// @dev To prevent intrinsic risks of flash loan attacks it will restrict key functions to one per block.
  mapping(address => uint256) public lastBlock;

  /// @dev The contract's governor.
  address public governor;

  /// @dev Persists time of last minted tokens for any given address.
  mapping(address => uint256) public lastMintedSecond;

  /* Modifiers */

  /// @dev Verifies sender has ability to modify governed parameters.
  modifier onlyByGovernor() {
    require(governor == msg.sender, "The caller is not the governor.");
    _;
  }

  /// @dev Prevention of reentrancy attacks in flash loans and liquidity pools.
  modifier isBlockApart() {
    require(block.number > lastBlock[msg.sender], "Accrual and minting cannot happen in the same block.");
    _;
  }

  /** @dev is already accruing token subsidy
  *  @param human for the address of the human.
  *  @param _accruing if its actively accruing value.
  */
  modifier isAccruing(address human, bool _accruing) {
    bool accruing = lastMintedSecond[human] != 0;
    require(
      accruing == _accruing,
      accruing
        ? "The submission is already accruing UBI."
        : "The submission is not accruing UBI."
    );
    _;
  }

  /* Initalizer */

  /** @dev Constructor.
  *  @param _initialSupply for the UBI coin including all decimals.
  *  @param _name for UBI coin.
  *  @param _symbol for UBI coin ticker.
  *  @param _accruedPerSecond How much of the token is accrued per block.
  *  @param _proofOfHumanity The Proof Of Humanity registry to reference.
  */
  function initialize(uint256 _initialSupply, string memory _name, string memory _symbol, uint256 _accruedPerSecond, IProofOfHumanity _proofOfHumanity) public initializer {
    __Context_init_unchained();
    __ERC20_init_unchained(_name, _symbol);

    accruedPerSecond = _accruedPerSecond;
    proofOfHumanity = _proofOfHumanity;
    governor = msg.sender;

    _mint(msg.sender, _initialSupply);
  }

  /* External */

  /** @dev Universal Basic Income mechanism
  *  @param human The submission ID.
  */
  function mintAccrued(address human) external isRegistered(human, true) isAccruing(human, true) isBlockApart {
    uint256 newSupply = getAccruedValue(human);
    
    lastBlock[msg.sender] = block.number;
    lastMintedSecond[human] = block.timestamp;

    _mint(human, newSupply);

    emit Mint(human, human, newSupply);
  }

  /** @dev Starts accruing UBI for a registered submission.
  *  @param human The submission ID.
  */
  function startAccruing(address human) external isRegistered(human, true) isAccruing(human, false) {
    lastMintedSecond[human] = block.timestamp;
    lastBlock[msg.sender] = block.number;
  }

  /** @dev Allows anyone to report a submission that
  *  should no longer receive UBI due to removal from the
  *  Proof Of Humanity registry. The reporter receives any
  *  leftover accrued UBI.
  *  @param human The submission ID.
  */
  function reportRemoval(address human) external isAccruing(human, true) isRegistered(human, false) isBlockApart {
    uint256 newSupply = getAccruedValue(human);

    lastBlock[msg.sender] = block.number;
    lastMintedSecond[human] = 0;

    _mint(msg.sender, newSupply);

    emit Mint(human, msg.sender, newSupply);
  }  

  /** @dev Changes `accruedPerSecond` to `_accruedPerSecond`.
  *  @param _accruedPerSecond How much of the token is accrued per block.
  */
  function changeAccruedPerSecond(uint256 _accruedPerSecond) external onlyByGovernor {
    accruedPerSecond = _accruedPerSecond;
  }

  /** @dev Changes `proofOfHumanity` to `_proofOfHumanity`.
  *  @param _proofOfHumanity Registry that meets interface of Proof of Humanity
  */
  function changeProofOfHumanity(IProofOfHumanity _proofOfHumanity) external onlyByGovernor {
    proofOfHumanity = _proofOfHumanity;
  }

  /** @dev External function for Snapshot event emitter only accessible by governor.  */
  function snapshot() external onlyByGovernor returns(uint256) {
    return _snapshot();
  }

  /**
  * @dev See {IERC20-balanceOf}.
  */
  function balanceOf(address account) public view override returns (uint256) {
    return ERC20SnapshotUpgradeable._balances[account];
  }

  /* Getters */

  /** @dev Calculates how much UBI a submission has available for withdrawal.
  *  @param human The submission ID.
  *  @return accrued The available UBI for withdrawal.
  */
  function getAccruedValue(address human) public view returns (uint256 accrued) {
    if (lastMintedSecond[human] == 0) return 0;
    return
      (block.timestamp - lastMintedSecond[human]) *
      accruedPerSecond;
  }

  /** Overrides */

  /** @dev Overrides with Snapshot mechanisms _beforeTokenTransfer functions.  */
  function _beforeTokenTransfer(address from, address to, uint256 amount) internal virtual override(ERC20Upgradeable, ERC20SnapshotUpgradeable) {
    ERC20SnapshotUpgradeable._beforeTokenTransfer(from, to, amount);
  }
}
