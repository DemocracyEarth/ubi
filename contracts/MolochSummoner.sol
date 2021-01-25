// SPDX-License-Identifier: MIT
pragma solidity 0.7.3;

import "./Moloch.sol";
import "./IProofOfHumanity.sol";

contract MolochSummoner {

    Moloch private M;

    address[] public Molochs;

    event Summoned(address indexed M, address indexed _summoner);

    function summonMoloch(
        address _summoner,
        address[] memory _approvedTokens,
        uint256 _periodDuration,
        uint256 _votingPeriodLength,
        uint256 _gracePeriodLength,
        uint256 _proposalDeposit,
        uint256 _dilutionBound,
        uint256 _processingReward,
        IProofOfHumanity _proofOfHumanity,
        uint256 _burnRequirement) public {

        M = new Moloch(
            _summoner,
            _approvedTokens,
            _periodDuration,
            _votingPeriodLength,
            _gracePeriodLength,
            _proposalDeposit,
            _dilutionBound,
            _processingReward,
            _proofOfHumanity,
            _burnRequirement);

        Molochs.push(address(M));

        emit Summoned(address(M), _summoner);

    }

    function getMolochCount() public view returns (uint256 MolochCount) {
        return Molochs.length;
    }
}
