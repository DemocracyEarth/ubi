pragma solidity ^0.7.3;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

contract Token is ERC20 {
  constructor(uint256 _initialSupply, string memory _symbol) public ERC20("Test Token", _symbol) {
    _mint(msg.sender, _initialSupply);
  }
}
