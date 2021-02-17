// SPDX-License-Identifier: MIT
pragma solidity 0.7.3;

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

abstract contract ForHumans {
  
  /// @dev The Proof Of Humanity registry to reference.
  IProofOfHumanity public proofOfHumanity; 

  /** @dev is Registered as Proof of Human.
  *  @param _submissionID for the address of the human.
  *  @param _registered if it's registered as valid human.
  */
  modifier isRegistered(address _submissionID, bool _registered) {
    bool registered = proofOfHumanity.isRegistered(_submissionID);
    require(
      registered == _registered,
      registered
        ? "The submission is still registered in Proof Of Humanity."
        : "The submission is not registered in Proof Of Humanity."
    );
    _;
  }
}
