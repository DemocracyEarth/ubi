// SPDX-License-Identifier: MIT
pragma solidity ^0.6;

import "@openzeppelin/contracts/token/ERC20/ERC20Burnable.sol";

contract UBI is ERC20Burnable  {
  constructor(uint256 initialSupply) public ERC20("Democracy Earth", "UBI") {
      _mint(msg.sender, initialSupply * 10**18);
  }
}
