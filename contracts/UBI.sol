/**
 *  @authors: [@epiqueras, @santisiri]
 *  @reviewers: [@fnanni-0]
 *  @auditors: []
 *  @bounties: []
 *  @deployments: []
 */
// SPDX-License-Identifier: MIT
pragma solidity ^0.6;

import "@openzeppelin/contracts/token/ERC20/ERC20Burnable.sol";

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


contract UBI is ERC20Burnable  {
  /* Governable Storage */
    
  /// @dev How many tokens per second will be minted for every valid human proof per second.
  uint256 public accruedPerSecond;

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
  *  @param _submissionID for the address of the human.
  *  @param _accruing if its actively accruing value.
  */
  modifier isAccruing(address _submissionID, bool _accruing) {
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
  *  @param initialSupply for the UBI token as integer
  *  @param _accruedPerSecond How much of the token is accrued per block.
  *  @param _proofOfHumanity The Proof Of Humanity registry to reference.
  */
  constructor(
    uint256 initialSupply,
    uint256 _accruedPerSecond,
    IProofOfHumanity _proofOfHumanity,
  ) public ERC20("Democracy Earth", "UBI") {
      accruedPerSecond = _accruedPerSecond;
      proofOfHumanity = _proofOfHumanity;
      _mint(msg.sender, initialSupply * 10**18);
  }

  /* External */

  /** @dev Universal Basic Income mechanism
  *  @param human The submission ID.
  */
  function getBasicIncome(address human)
    external isRegistered(human, true) 
    external isAccruing(human, true) 
  {
    require(human != address(0), "human cannot be 0");
    require(human == msg.sender, "human must be sender");

    uint256 elapsedTime = (now - lastMintedSecond[human]);
    uint256 newSupply = elapsedTime * accruedPerSecond;

    lastMintedSecond[human] = now;

    _mint(human, newSupply);
  }

  /** @dev Starts accruing UBI for a registered submission.
  *  @param human The submission ID.
  */
  function startAccruing(address human)
      external
      isRegistered(human, true)
      isAccruing(human, false)
  {
      lastMintedSecond[human] = now;
  }

  /** @dev Allows anyone to report a submission that
  *  should no longer receive UBI due to removal from the
  *  Proof Of Humanity registry. The reporter receives any
  *  leftover accrued UBI.
  *  @param human The submission ID.
  */
  function reportRemoval(address human)
      external
      isRegistered(human, false)
      isAccruing(human, true)
  {
      lastMintedSecond[human] = 0;
  }  

  /** @dev Changes `accruedPerBlock` to `_accruedPerBlock`.
  *  @param _accruedPerSecond How much of the token is accrued per block.
  */
  function changeAccruedPerSecond(uint256 _accruedPerSecond)
      external
      onlyByGovernor
  {
      accruedPerSecond = _accruedPerSecond;
  }
}
