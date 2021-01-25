// helper for testing moloch.submitProposal return value

// SPDX-License-Identifier: MIT
pragma solidity 0.7.3;

import "../Moloch.sol";

contract Submitter {

  event Submit(uint256 proposalId);

  Moloch public moloch; // moloch contract reference

  constructor(address molochAddress) public {
    moloch = Moloch(molochAddress);
  }

  function submitProposal(
    address applicant,
    uint256 sharesRequested,
    uint256 lootRequested,
    uint256 tributeOffered,
    address tributeToken,
    uint256 paymentRequested,
    address paymentToken,
    string memory details,
    uint256 burnAmount
  ) public {
    uint256 proposalId = moloch.submitProposal(
      applicant,
      sharesRequested,
      lootRequested,
      tributeOffered,
      tributeToken,
      paymentRequested,
      paymentToken,
      details,
      burnAmount
    );

    emit Submit(proposalId);
  }

  function submitWhitelistProposal(
    address tokenToWhitelist,
    string memory details
  ) public {
    uint256 proposalId = moloch.submitWhitelistProposal(
      tokenToWhitelist,
      details
    );

    emit Submit(proposalId);
  }
}
