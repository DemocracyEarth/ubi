// SPDX-License-Identifier: MIT
pragma solidity 0.7.3;

/**
 * This code contains elements of ERC20BurnableUpgradeable.sol https://github.com/OpenZeppelin/openzeppelin-contracts-upgradeable/blob/master/contracts/token/ERC20/ERC20BurnableUpgradeable.sol
 * Those have been inlined for the purpose of gas optimization.
 */

import "@openzeppelin/contracts-upgradeable/proxy/Initializable.sol";
import "@openzeppelin/contracts/math/SafeMath.sol";

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
}

/**
 * @title Universal Basic Income
 * @dev UBI is an ERC20 compatible token that is connected to a Proof of Humanity registry. 
 *
 * Tokens are issued and drip over time for every verified submission on a Proof of Humanity registry.
 * The accrued tokens are updated directly on every wallet using the `balanceOf` function.
 * The tokens get effectively minted and persisted in memory when someone interacts with the contract doing a `transfer` or `burn`. 
 */
contract UBI is Initializable {

  /* Events */
  
  /**
   * @dev Emitted when `value` tokens are moved from one account (`from`) to another (`to`).
   *
   * Note that `value` may be zero.
   * Also note that due to continuous minting we cannot emit transfer events from the address 0 when tokens are created.
   * In order to keep consistency, we decided not to emit those events from the address 0 even when minting is done within a transaction.
   */
  event Transfer(address indexed from, address indexed to, uint256 value);

  /**
   * @dev Emitted when the allowance of a `spender` for an `owner` is set by
   * a call to {approve}. `value` is the new allowance.
   */
  event Approval(address indexed owner, address indexed spender, uint256 value);

  using SafeMath for uint256;

  /* Storage */
  
  mapping (address => uint256) private balance;

  mapping (address => mapping (address => uint256)) public allowance;

  /**@dev M0 supply marker
  * M0 should be updated after.. 
  * a) adding new PoH
  * b) revoking active PoH
  *
  * If accrued per sec rate is changed,
  * It'll fluctuate +- "real" total supply
  */
  uint256 public supplyMarker; // same slot/position as old totalSupply to match upgradable pattern
  
  /// @dev Name of the token.
  string public name;
  
  /// @dev Symbol of the token.
  string public symbol;
  
  /// @dev Number of decimals of the token.
  uint8 public decimals;

  /// @dev How many tokens per second will be minted for every valid human.
  uint256 public accruedPerSecond;

  /// @dev The contract's governor.
  address public governor;
  
  /// @dev The Proof Of Humanity registry to reference.
  IProofOfHumanity public proofOfHumanity; 

  /// @dev Timestamp since human started accruing.
  mapping(address => uint256) public accruedSince;
  
  /// @dev Timestamp of PoH activation, used as internal PoH Marker
  mapping(address => bool) public activated;
  
  /// @dev Number of active Humans accruing UBI, Updated after adding / revoking PoH
  uint256 public activeVerifiedHumans;

  /// @dev Timestamp of last M0 update
  uint256 public lastSupplyUpdate; // same as accruedSince but for M0 supply

  /**
  * @dev stream mapping
  * stream[0][addr] = total incoming (excluding accruedPerSecond)
  * stream[addr][0] = total outgoing
  * stream[from][to] = record of stream from ~ to
  * stream[this][addr] = outgoing stream counter
  */
  mapping (address => mapping (address => uint256)) public stream;
  
  /**@dev Total Supply of UBI
  * @notice 
  */
  function totalSupply() public view returns(uint){
    // NOT using SafeMath for internal is OK?
    return supplyMarker + ((block.timestamp - lastSupplyUpdate) * (activeVerifiedHumans * accruedPerSecond));
  }

  /* Modifiers */

  /// @dev Verifies that the sender has ability to modify governed parameters.
  modifier onlyByGovernor() {
    require(governor == msg.sender, "The caller is not the governor.");
    _;
  }

  /* Initializer */

  /** @dev Constructor.
  *  @param _initialSupply for the UBI coin including all decimals.
  *  @param _name for UBI coin.
  *  @param _symbol for UBI coin ticker.
  *  @param _accruedPerSecond How much of the token is accrued per block.
  *  @param _proofOfHumanity The Proof Of Humanity registry to reference.
  */
  function initialize(uint256 _initialSupply, string memory _name, string memory _symbol, uint256 _accruedPerSecond, IProofOfHumanity _proofOfHumanity) public initializer {
    name = _name;
    symbol = _symbol;
    decimals = 18;

    accruedPerSecond = _accruedPerSecond;
    proofOfHumanity = _proofOfHumanity;
    governor = msg.sender;

    balance[msg.sender] = _initialSupply;
    supplyMarker = _initialSupply;
  }

  /* External */

  /** @dev Starts accruing UBI for a registered submission.
  *  @param _human The submission ID.
  */
  function startAccruing(address _human) external {
    require(proofOfHumanity.isRegistered(_human), "The submission is not registered in Proof Of Humanity.");
    require(!activated[_human], "The submission is already accruing UBI.");
    uint256 _now = block.timestamp;
    if(stream[address(0)][_human] != 0) { // check incoming streams
      balance[_human] += (stream[address(0)][_human] * (_now - accruedSince[_human]));
    }
    activated[_human] = true;
    accruedSince[_human] = _now;
    emit NewStream(address(0), _human, accruedPerSecond); // emit stream event 
    // update M0 total supply marker 
    supplyMarker += ((activeVerifiedHumans * accruedPerSecond) * (_now - lastSupplyUpdate));
    activeVerifiedHumans++;
    lastSupplyUpdate = _now;
  }

  /** @dev Allows anyone to report a submission that
  *  should no longer receive UBI due to removal from the
  *  Proof Of Humanity registry. The reporter receives any
  *  leftover accrued UBI.
  *  @param _human The submission ID.
  *  @param _outFlow Array of outgoing stream addresses to revoke
  */
  function reportRemoval(address _human, address[] calldata _outFlow) external  {
    require(!proofOfHumanity.isRegistered(_human), "The submission is still registered in Proof Of Humanity.");
    require(activated[_human], "Stream : Already Removed");
    uint256 _slash; // total value recovered
    uint256 _out; // sum of UBI units
    uint256 _now = block.timestamp;
    for (uint256 i = 0; i < _outFlow.length; i++) {
      address _addr = _outFlow[i];
      uint256 _drip = stream[_human][_addr]; // units in this stream >=0
      stream[address(0)][_addr] -= _drip; // subtract units
      _slash += _drip * (_now - accruedSince[_addr]); // add total recovered
      stream[_human][_addr] = 0; // reset stream to zero
      _out += _drip; // for final check
      emit Revoked(_human, _outFlow[i], _drip); // emit revoked event
    }
    require(stream[_human][address(0)] == _out, "Stream: Unable to close all outgoing stream.");
    _slash += (accruedPerSecond - _out) * (_now - accruedSince[_human]);
    balance[msg.sender] = balance[msg.sender].add(_slash); // reward msg sender
    activated[_human] = false; // deactivate stream
    stream[_human][address(0)] = 0; // reset outgoing to zero 
    stream[address(this)][_human] = 0; // reset stream counter
    emit Revoked(address(0), _human, 0); // emit revoked event
    // update M0 for total supply marker
    supplyMarker += ((activeVerifiedHumans * accruedPerSecond) * (_now - lastSupplyUpdate));
    activeVerifiedHumans--; // remove 1 PoH
    lastSupplyUpdate = _now; // last updated
  }

  /** @dev Changes `governor` to `_governor`.
  *  @param _governor The address of the new governor.
  */
  function changeGovernor(address _governor) external onlyByGovernor {
    governor = _governor;
  }

  /** @dev Changes `accruedPerSecond`
  *  @param _accruedPerSecond.
  * IF changed totalSupply will be +- of real total supply
  */
  function changeAccruedRate(uint256 _accruedPerSecond) external onlyByGovernor {
    supplyMarker += ((activeVerifiedHumans * accruedPerSecond) * (block.timestamp - lastSupplyUpdate));
    lastSupplyUpdate = block.timestamp;
    accruedPerSecond = _accruedPerSecond;
  }

  /** @dev Changes `proofOfHumanity` to `_proofOfHumanity`.
  *  @param _proofOfHumanity Registry that meets interface of Proof of Humanity.
  */
  function changeProofOfHumanity(IProofOfHumanity _proofOfHumanity) external onlyByGovernor {
    proofOfHumanity = _proofOfHumanity;
  }

  /** @dev Transfers `_amount` to `_recipient` and withdraws accrued tokens.
  *  @param _recipient The entity receiving the funds.
  *  @param _amount The amount to transfer in base units.
  */
  function transfer(address _recipient, uint256 _amount) public returns (bool) {
    uint256 _accrued;
    if(activated[msg.sender] && proofOfHumanity.isRegistered(msg.sender)) {
      _accrued = (block.timestamp - accruedSince[msg.sender]) * ((accruedPerSecond + stream[address(0)][msg.sender]) - stream[msg.sender][address(0)]);
    } else if(stream[address(0)][msg.sender] != 0) {
      _accrued = ((block.timestamp - accruedSince[msg.sender]) * stream[address(0)][msg.sender]);
    }
    balance[msg.sender] = (balance[msg.sender] + _accrued).sub(_amount, "ERC20: transfer amount exceeds balance");
    balance[_recipient] += _amount; // ?Public" Good for everyone if this overflows ;)
    accruedSince[msg.sender] = block.timestamp;
    emit Transfer(msg.sender, _recipient, _amount);
    return true;
  }
  
  /** @dev Transfers `_amount` from `_sender` to `_recipient` and withdraws accrued tokens.
  *  @param _sender The entity to take the funds from.
  *  @param _recipient The entity receiving the funds.
  *  @param _amount The amount to transfer in base units.
  */
  function transferFrom(address _sender, address _recipient, uint256 _amount) public returns (bool) {
    if(allowance[_sender][msg.sender] != type(uint256).max){
      allowance[_sender][msg.sender] = allowance[_sender][msg.sender].sub(_amount, "ERC20: transfer amount exceeds allowance");      
    }
    balance[_sender] = (balance[_sender] + getAccruedValue(_sender)).sub(_amount, "ERC20: transfer amount exceeds balance");
    balance[_recipient] += _amount;
    accruedSince[_sender] = block.timestamp;
    emit Transfer(_sender, _recipient, _amount);
    return true;
  }

  /** @dev Approves `_spender` to spend `_amount`.
  *  @param _spender The entity allowed to spend funds.
  *  @param _amount The amount of base units the entity will be allowed to spend.
  */
  function approve(address _spender, uint256 _amount) public returns (bool) {
    allowance[msg.sender][_spender] = _amount;
    emit Approval(msg.sender, _spender, _amount);
    return true;
  }

  /** @dev Increases the `_spender` allowance by `_addedValue`.
  *  @param _spender The entity allowed to spend funds.
  *  @param _addedValue The amount of extra base units the entity will be allowed to spend.
  */  
  function increaseAllowance(address _spender, uint256 _addedValue) public returns (bool) {
    uint256 newAllowance = allowance[msg.sender][_spender].add(_addedValue);
    allowance[msg.sender][_spender] = newAllowance;
    emit Approval(msg.sender, _spender, newAllowance);
    return true;
  }

  /** @dev Decreases the `_spender` allowance by `_subtractedValue`.
  *  @param _spender The entity whose spending allocation will be reduced.
  *  @param _subtractedValue The reduction of spending allocation in base units.
  */  
  function decreaseAllowance(address _spender, uint256 _subtractedValue) public returns (bool) {
    uint256 newAllowance = allowance[msg.sender][_spender].sub(_subtractedValue, "ERC20: decreased allowance below zero");
    allowance[msg.sender][_spender] = newAllowance;
    emit Approval(msg.sender, _spender, newAllowance);
    return true;
  }
  
  /** @dev Burns `_amount` of tokens and withdraws accrued tokens.
  *  @param _amount The quantity of tokens to burn in base units.
  */  
  function burn(uint256 _amount) public {
    balance[msg.sender] = (balance[msg.sender] + getAccruedValue(msg.sender)).sub(_amount, "ERC20: Burn amount exceeds balance");
    accruedSince[msg.sender] = block.timestamp;
    supplyMarker = supplyMarker.sub(_amount);
    emit Transfer(msg.sender, address(0), _amount);
  }

  /** @dev Burns `_amount` of tokens from `_account` and withdraws accrued tokens.
  *  @param _account The entity to burn tokens from.
  *  @param _amount The quantity of tokens to burn in base units.
  */  
  function burnFrom(address _account, uint256 _amount) public {
    if(allowance[_account][msg.sender] != type(uint256).max){
      allowance[_account][msg.sender] = allowance[_account][msg.sender].sub(_amount, "ERC20: Burn amount exceeds allowance");      
    }
    balance[_account] = (balance[_account] + getAccruedValue(_account)).sub(_amount, "ERC20: Burn amount exceeds balance");
    supplyMarker = supplyMarker.sub(_amount);
    emit Transfer(_account, address(0), _amount);
  }
  
  /* Getters */

  /** @dev Calculates how much UBI an address has available for withdrawal.
  *  @param _human The submission ID.
  *  @return accrued The available UBI for withdrawal.
  */
  function getAccruedValue(address _human) public view returns (uint256 accrued) {
    if(activated[_human] && proofOfHumanity.isRegistered(_human)) { // check if Active PoH
      // time * ((base rate  + inflow) - outflow)
      return (block.timestamp - accruedSince[_human]) * ((accruedPerSecond + stream[address(0)][_human]) - stream[_human][address(0)]);
    }
    if(stream[address(0)][_human] != 0) { //check incoming stream
      // time * inflow rate
      return ((block.timestamp - accruedSince[_human]) * stream[address(0)][_human]);
    }
    // returns zero if stream is zero
  }
  
  /**
  * @dev Calculates the current user accrued balance.
  * @param _human The submission ID.
  * @return The current balance including accrued Universal Basic Income of the user.
  **/
  function balanceOf(address _human) public view returns (uint256) {
    return (balance[_human] + getAccruedValue(_human));
  }

  /* Stream Functions */
  
/* Stream Events */
  /**
  * @dev Emitted when the `_src` creates new stream for `_dst` 
  * `_src` is address(0) for Primary stream
  * `_drip` are UBI units moved into`_dst` stream.
  */
  event NewStream(address indexed _src, address indexed _dst, uint256 _drip);

  /**
  * @dev Emitted when the `_src` ~ `_dst` is stopped
  * `_src` is address(0) for Primary stream
  * `_drip` are UBI units moved out of `_dst` stream.
  */
  event EndStream(address indexed _src, address indexed _dst, uint256 _drip);
  
  /**
  * @dev Emitted when the `_src`'s PoH is revoked `_dst`.
  * `_src` is address(0) for Primary stream
  * `_drip` UBI units per second revoked from `_dst` stream.
  */
  event Revoked(address indexed _src, address indexed _dst, uint256 _drip);
  
  /** @dev Start secondary UBI stream to any address
   * @param _dst destination address
   * @param _drip UBI units per second moved in stream. 
   * <10% >1% of accruedPerSecond
   */ 
  function startStream(address _dst, uint256 _drip) external {
    require(_dst != address(0), "Stream: Zero address as destination.");
    require(stream[address(this)][msg.sender] < 5, "Stream: Max 5 outgoing streams");
    uint256 _rate = accruedPerSecond;
    require(_drip <= _rate / 10 && _drip >= _rate / 100, "Stream: limit Max 10%, Min 1%");
    require(stream[msg.sender][_dst] == 0, "Stream: Already active/Use update");
    require(proofOfHumanity.isRegistered(msg.sender), "The submission is not registered in Proof Of Humanity.");
    require(activated[msg.sender], "Stream: Start accruing before streaming out.");
    balance[_dst] += getAccruedValue(_dst); // settle dst balance
    accruedSince[_dst] = block.timestamp; // update dst timer
    balance[msg.sender] += ((block.timestamp - accruedSince[msg.sender]) * ((_rate + stream[address(0)][msg.sender]) - stream[msg.sender][address(0)]));
    accruedSince[msg.sender] = block.timestamp; // update src timer
    stream[msg.sender][_dst] = _drip; // record of new stream
    stream[msg.sender][address(0)] += _drip; // add outgoing stream for src 
    stream[address(0)][_dst] += _drip; // add incoming stream for dst 
    stream[address(this)][msg.sender]++; // increase active stream counter 
    emit NewStream(msg.sender, _dst, _drip);
  }
  
  /** @dev Stop secondary UBI stream 
   * @param _dst destination address to stop
   */

  function stopStream(address _dst) external {
    require(proofOfHumanity.isRegistered(msg.sender), "Your address is not registered in Proof Of Humanity.");
    require(stream[msg.sender][_dst] != 0, "Stream: Not active");
    balance[_dst] += getAccruedValue(_dst); // settle dst balance
    accruedSince[_dst] = block.timestamp; // update dst timer
    balance[msg.sender] += ((block.timestamp - accruedSince[msg.sender]) * ((accruedPerSecond + stream[address(0)][msg.sender]) - stream[msg.sender][address(0)]));
    accruedSince[msg.sender] = block.timestamp;
    uint256 _drip = stream[msg.sender][_dst];
    stream[msg.sender][_dst] = 0; // reset stream to zero
    stream[msg.sender][address(0)] -= _drip; // subtract outgoing stream for src 
    stream[address(0)][_dst] -= _drip; // subtract incoming stream for dst 
    stream[address(this)][msg.sender]--; // decrease active outgoing stream counter 
    emit EndStream(msg.sender, _dst, 0); // close stream
  }
}