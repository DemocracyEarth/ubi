// SPDX-License-Identifier: MIT
pragma solidity ^0.6;

import "@openzeppelin/contracts/token/ERC20/ERC20Burnable.sol";

contract UBI is ERC20Burnable  {
  uint256 public mintingPerSecond; // how many tokens per second will be minted for every valid human proof

  mapping(address => uint256) public lastMintedTime; // persists time of last minted tokens

  constructor(
    uint256 initialSupply,
    uint256 basicIncomeSupplyPerSecond
  ) public ERC20("Democracy Earth", "UBI") {
      mintingPerSecond = basicIncomeSupplyPerSecond * 10**18;
      _mint(msg.sender, initialSupply * 10**18);
  }

  // UBI function
  function basicIncome(uint256 newSupply, address human) public {
    require(human != address(0), "human cannot be 0");

    lastMintedTime[human] = now;

    _mint(human, newSupply * 10**18);
  }
}
