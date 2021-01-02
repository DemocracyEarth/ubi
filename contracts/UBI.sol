/**
 *  @authors: [@epiqueras, @santisiri]
 *  @reviewers: [@fnanni-0]
 *  @auditors: []
 *  @bounties: []
 *  @deployments: []
 */
// SPDX-License-Identifier: MIT
pragma solidity 0.7.3;

import "@openzeppelin/contracts/token/ERC20/ERC20Burnable.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20Snapshot.sol";

/**
 * @title ProofOfHumanity Interface
 * @dev See https://github.com/Proof-Of-Humanity/Proof-Of-Humanity.
 */
interface IProofOfHumanity {
  enum Status {None, Vouching, PendingRegistration, PendingRemoval}

  function getSubmissionInfo(address _submissionID)
    external
    view
    returns (
      Status status,
      uint64 submissionTime,
      uint64 renewalTimestamp,
      uint64 index,
      bool registered,
      bool hasVouched,
      uint256 numberOfRequests
    );
}


contract UBI is ERC20Burnable, ERC20Snapshot  {
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

  /* Governable Storage */
    
  /// @dev How many tokens per second will be minted for every valid human proof per second.
  uint256 public accruedPerSecond;

  /// @dev To prevent intrinsic risks of flash loan attacks it will restrict key functions to one per block.
  mapping(address => uint256) public lastBlock;

  /* Constructor Storage */

  /// @dev The Proof Of Humanity registry to reference.
  IProofOfHumanity public immutable proofOfHumanity; 

  /// @dev The contract's governor.
  address public governor = msg.sender;

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

  /** @dev is Registered as Proof of Human.
  *  @param _submissionID for the address of the human.
  *  @param _registered if it's registered as valid human.
  */
  modifier isRegistered(address _submissionID, bool _registered) {
    (, , , , bool registered, , ) = proofOfHumanity.getSubmissionInfo(
      _submissionID
    );
    require(
      registered == _registered,
      registered
        ? "The submission is still registered in Proof Of Humanity."
        : "The submission is not registered in Proof Of Humanity."
    );
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

  /** @dev Constructor.
  *  @param _initialSupply for the UBI coin including all decimals.
  *  @param _name for UBI coin.
  *  @param _symbol for UBI coin ticker.
  *  @param _accruedPerSecond How much of the token is accrued per block.
  *  @param _proofOfHumanity The Proof Of Humanity registry to reference.
  */
  constructor(uint256 _initialSupply, string memory _name, string memory _symbol, uint256 _accruedPerSecond, IProofOfHumanity _proofOfHumanity) public ERC20(_name, _symbol) {
    accruedPerSecond = _accruedPerSecond;
    proofOfHumanity = _proofOfHumanity;
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

  /** @dev Overrides with Snapshot mechanisms _beforeTokenTransfer functions.
  */
  function _beforeTokenTransfer(address from, address to, uint256 amount) internal virtual override(ERC20, ERC20Snapshot) {
    ERC20Snapshot._beforeTokenTransfer(from, to, amount);
  }
}
