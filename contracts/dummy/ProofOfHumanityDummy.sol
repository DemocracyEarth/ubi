// SPDX-License-Identifier: MIT
pragma solidity 0.7.3;

interface IProofOfHumanity {
  function isRegistered(address _submissionID)
    external
    view
    returns (
      bool registered
    );
}

contract ProofOfHumanityDummy is IProofOfHumanity {
    function isRegistered(address user) public override view returns (bool) {
        return true;
    }
}