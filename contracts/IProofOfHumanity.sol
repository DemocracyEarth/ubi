// SPDX-License-Identifier: MIT
pragma solidity 0.7.3;

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
      bool registered
    );
}
