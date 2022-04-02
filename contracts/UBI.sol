// SPDX-License-Identifier: MIT
pragma solidity 0.7.3;

/**
 * This code contains elements of ERC20BurnableUpgradeable.sol https://github.com/OpenZeppelin/openzeppelin-contracts-upgradeable/blob/master/contracts/token/ERC20/ERC20BurnableUpgradeable.sol
 * Those have been inlined for the purpose of gas optimization.
 */

import "@openzeppelin/contracts-upgradeable/proxy/Initializable.sol";
import "@openzeppelin/contracts/math/SafeMath.sol";
import "@openzeppelin/contracts/math/Math.sol";
import "@openzeppelin/contracts/cryptography/ECDSA.sol";
import "./interfaces/ISUBI.sol";
import "./interfaces/IFUBI.sol";
import "./interfaces/IUBIDelegator.sol";
import "hardhat/console.sol";

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

  mapping (address => uint256) private ubiBalance;

  mapping (address => mapping (address => uint256)) public allowance;

  /// @dev A lower bound of the total supply. Does not take into account tokens minted as UBI by an address before it moves those (transfer or burn).
  uint256 public totalSupply;

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

  /// @dev Nonces for permit function. Must be modified only through permit function, where is incremented only by one.
  mapping (address => uint256) public nonces;

  /// @dev Chain id used for domain separator.
  uint256 public chainId;

  /// @dev Typehash used for permit function.
  bytes32 public permitTypehash;

  /// @dev Domain separator used for permit function.
  bytes32 public domainSeparator;

  /// @dev The Streaming UBI ERC721 contract.
  ISUBI public subi;

  /// @dev The Flowing UBI ERC721 contract.
  IFUBI public fubi;

  /// @dev Not Entered status for reentrancyGuard
  uint256 private constant _NOT_ENTERED = 1;
  /// @dev Entered status for reentrancyGuard
  uint256 private constant _ENTERED = 2;
  /// @dev Stores the reentrancy status for reentrancyGuard
  uint256 private _reentrancyStatus;
  
  /* Modifiers */

  /// @dev non Reentrancy modifier for reentrancy guard
  modifier nonReentrant() {
        // On the first call to nonReentrant, _notEntered will be true
        require(_reentrancyStatus != _ENTERED, "ReentrancyGuard: reentrant call");

        // Any calls to nonReentrant after this point will fail
        _reentrancyStatus = _ENTERED;

        _;

        // By storing the original value once again, a refund is triggered (see
        // https://eips.ethereum.org/EIPS/eip-2200)
        _reentrancyStatus = _NOT_ENTERED;
    }

  /// @dev Verifies that the sender has ability to modify governed parameters.
  modifier onlyByGovernor() {
    require(governor == msg.sender, "The caller is not the governor.");
    _;
  }

  /// @dev Verifies that the sender is fubi.
  modifier onlyFubi() {
    require(address(fubi) == msg.sender, "The caller is not fubi.");
    _;
  }

  modifier onlyDelegator(address delegator) {
    require(isAllowedImplementation[delegator], "caller is not an allowed delegator");
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

    ubiBalance[msg.sender] = _initialSupply;
    totalSupply = _initialSupply;

    chainId = _getCurrentChainId();
    permitTypehash = keccak256("Permit(address owner,address spender,uint256 value,uint256 nonce,uint256 deadline)");
    domainSeparator = _buildDomainSeparator();
  }

  /// @dev executes 
  function upgrade() public onlyByGovernor {
    require(_reentrancyStatus == 0, "Contract already upgraded");
    _reentrancyStatus = _NOT_ENTERED;
  }

  /* External */

  /** @dev Starts accruing UBI for a registered submission.
  *  @param _human The submission ID.
  */
  function startAccruing(address _human) external {
    require(proofOfHumanity.isRegistered(_human), "The submission is not registered in Proof Of Humanity.");
    require(accruedSince[_human] == 0, "The submission is already accruing UBI.");
    accruedSince[_human] = block.timestamp;
  }

  /** @dev Allows anyone to report a submission that
  *  should no longer receive UBI due to removal from the
  *  Proof Of Humanity registry. The reporter receives any
  *  leftover accrued UBI.
  *  @param _human The submission ID.
  */
  function reportRemoval(address _human) external  {
    require(!proofOfHumanity.isRegistered(_human), "The submission is still registered in Proof Of Humanity.");
    require(accruedSince[_human] != 0, "The submission is not accruing UBI.");
    uint256 newSupply = accruedPerSecond.mul(block.timestamp.sub(accruedSince[_human]));

    accruedSince[_human] = 0;

    ubiBalance[msg.sender] = ubiBalance[msg.sender].add(newSupply);
    totalSupply = totalSupply.add(newSupply);

    for(uint256 i = 0; i < delegatorImplementations.length; i++) {
      IUBIDelegator(delegatorImplementations[i]).onReportRemoval(msg.sender);
    }
    // If fUBI is set
    if(address(fubi) != address(0)) {
      // Get active flows of human
      uint256[] memory activeFlowIds = fubi.getFlowsOf(_human);
      // On each flow, withdraw and cancel the flow
      for(uint256 i = 0; i < activeFlowIds.length; i++) {
        uint256 flowId = activeFlowIds[i];
        
        cancelFlow(flowId);
          
      }
    }
  }

  /** @dev Changes `governor` to `_governor`.
  *  @param _governor The address of the new governor.
  */
  function changeGovernor(address _governor) external onlyByGovernor {
    governor = _governor;
  }

  /** @dev Changes `proofOfHumanity` to `_proofOfHumanity`.
  *  @param _proofOfHumanity Registry that meets interface of Proof of Humanity.
  */
  function changeProofOfHumanity(IProofOfHumanity _proofOfHumanity) external onlyByGovernor {
    proofOfHumanity = _proofOfHumanity;
  }

  /**
  * @dev Returns the domain separator used in the encoding of the signature for `permit`, as defined by {EIP712}.
  */
  function DOMAIN_SEPARATOR() external view returns (bytes32) {
    return _buildDomainSeparator();
  }

  /** @dev Transfers `_amount` to `_recipient` and withdraws accrued tokens.
  *  @param _recipient The entity receiving the funds.
  *  @param _amount The amount to tranfer in base units.
  */
  function transfer(address _recipient, uint256 _amount) public returns (bool) {
    updateBalance(msg.sender);
    ubiBalance[msg.sender] = ubiBalance[msg.sender].sub(_amount, "ERC20: transfer amount exceeds balance");
    ubiBalance[_recipient] = ubiBalance[_recipient].add(_amount);
    emit Transfer(msg.sender, _recipient, _amount);
    return true;
  }

  /** @dev Transfers `_amount` from `_sender` to `_recipient` and withdraws accrued tokens.
  *  @param _sender The entity to take the funds from.
  *  @param _recipient The entity receiving the funds.
  *  @param _amount The amount to tranfer in base units.
  */
  function transferFrom(address _sender, address _recipient, uint256 _amount) public returns (bool) {
    
    allowance[_sender][msg.sender] = allowance[_sender][msg.sender].sub(_amount, "ERC20: transfer amount exceeds allowance");
    updateBalance(_sender);
    ubiBalance[_sender] = ubiBalance[_sender].sub(_amount, "ERC20: transfer amount exceeds balance");
    ubiBalance[_recipient] = ubiBalance[_recipient].add(_amount);
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
    updateBalance(msg.sender);
    ubiBalance[msg.sender] = ubiBalance[msg.sender].sub(_amount, "ERC20: burn amount exceeds balance");
    totalSupply = totalSupply.sub(_amount);
    emit Transfer(msg.sender, address(0), _amount);
  }

  /** @dev Burns `_amount` of tokens from `_account` and withdraws accrued tokens.
  *  @param _account The entity to burn tokens from.
  *  @param _amount The quantity of tokens to burn in base units.
  */
  function burnFrom(address _account, uint256 _amount) public {
    allowance[_account][msg.sender] = allowance[_account][msg.sender].sub(_amount, "ERC20: burn amount exceeds allowance");
    updateBalance(_account);
    ubiBalance[_account] = ubiBalance[_account].sub(_amount, "ERC20: burn amount exceeds balance");
    totalSupply = totalSupply.sub(_amount);
    emit Transfer(_account, address(0), _amount);
  }

  /**
  * @dev Approves, through a message signed by the `_owner`, `_spender` to spend `_value` tokens from `_owner`.
  * @param _owner The address of the token owner.
  * @param _spender The address of the spender.
  * @param _value The amount of tokens to approve.
  * @param _deadline The expiration time until which the signature will be considered valid.
  * @param _v The signature v value.
  * @param _r The signature r value.
  * @param _s The signature s value.
  */
  function permit(address _owner, address _spender, uint256 _value, uint256 _deadline, uint8 _v, bytes32 _r, bytes32 _s) public {
    require(_owner != address(0), "ERC20Permit: invalid owner");
    require(block.timestamp <= _deadline, "ERC20Permit: expired deadline");
    bytes32 structHash = keccak256(abi.encode(permitTypehash, _owner, _spender, _value, nonces[_owner], _deadline));
    if (_getCurrentChainId() != chainId) {
      domainSeparator = _buildDomainSeparator();
    }
    bytes32 hash = keccak256(abi.encodePacked("\x19\x01", domainSeparator, structHash));
    address signer = ECDSA.recover(hash, _v, _r, _s);
    require(signer == _owner, "ERC20Permit: invalid signature");
    // Must be modified only here. Doesn't need SafeMath because can't reach overflow if incremented only here by one.
    // See: https://www.schneier.com/blog/archives/2009/09/the_doghouse_cr.html
    nonces[_owner]++;
    allowance[_owner][_spender] = _value;
    emit Approval(_owner, _spender, _value);
  }

  /**
  * @dev Builds and returns the domain separator used in the encoding of the signature for `permit` using the current
  * chain id.
  */
  function _buildDomainSeparator() internal view returns (bytes32) {
    string memory version = "2";
    return keccak256(
      abi.encode(
        keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"),
        keccak256(bytes(name)),
        keccak256(bytes(version)),
        _getCurrentChainId(),
        address(this)
      )
    ); 
  }

  /**
  * @dev Returns the current chain id.
  */
  function _getCurrentChainId() internal pure returns (uint256 currentChainId) {
    assembly {
      currentChainId := chainid()
    }
  }

  struct Delegator {
        bool isAllowed;
        bool implementsDelegator;
    }

  mapping(address => Delegator) public delegators;
  address[] delegatorImplementations;

  function setDelegator(address _implementation, bool allowed, bool implementsDelegator) public onlyGovernor {
    Delegator d = delegators[_implementation];
    d.isAllowed = allowed;
    
    // If the new implementation implements delegator, add it to the `delegatorImplementations` array.
    if(!d.implementsDelegator && implementsDelegator) {
      d.implementsDelegator = true;
      delegatorImplementations.push(_implementation);
    }
    // Else, if the old value implemented delegator but this is not, we remove the implementation from the `delegatorImplementations` array.
    else if(d.implementsDelegator && !implementsDelegator) {
      d.implementsDelegator = false;
      delegatorImplementations = delegatorImplementations.filter(x => x != _implementation);
    }  
    else if (d.implementsDelegator && !implementsDelegator) {
      d.implementsDelegator = false;
      delegatorImplementations = delegatorImplementations.filter(x => x != _implementation);
    }

    delegators[_implementation] = d;
  }

  function createDelegation(address implementation, address recipient, uint256 ubiPerSecond, uint256 startTime, uint256 stopTime, bool cancellable) public nonReentrant {
    require(proofOfHumanity.isRegistered(msg.sender) && accruedSince[msg.sender] > 0, "Only registered humans accruing UBI can stream UBI.");
    require(ubiPerSecond <= accruedPerSecond, "Cannot delegate a value higher than accruedPerSecond");
    require(isAllowedImplementation[implementation], "implementation not allowed");

    // Update sender and recipient balances.
    updateBalance(msg.sender);
    updateBalance(recipient);

    IUBIDelegator(implementation).createDelegation(msg.sender, recipient, ubiPerSecond, startTime, stopTime, cancellable);
  }

  function createStream(address recipient, uint256 ubiPerSecond, uint256 startTime, uint256 stopTime, bool cancellable) public nonReentrant {
    require(proofOfHumanity.isRegistered(msg.sender) && accruedSince[msg.sender] > 0, "Only registered humans accruing UBI can stream UBI.");
    require(ubiPerSecond <= accruedPerSecond, "Cannot delegate a value higher than accruedPerSecond");
    subi.createDelegation(msg.sender, recipient, ubiPerSecond, startTime, stopTime, cancellable);
  }

  function createFlow(address recipient, uint256 ubiPerSecond) public nonReentrant {
    require(proofOfHumanity.isRegistered(msg.sender) && accruedSince[msg.sender] > 0, "Only registered humans accruing UBI can flow UBI.");
    updateBalance(msg.sender);
    updateBalance(recipient);
    fubi.createDelegation(msg.sender, recipient, ubiPerSecond, 0, 0, false);
  }

    // /**
    //  * @notice Withdraws from the contract to the recipient's account.
    //  * @dev Throws if the id does not point to a valid stream.
    //  *  Throws if the caller is not the sender or the recipient of the stream.
    //  *  Throws if there is a token transfer failure.
    //  * @param streamId The id of the stream to withdraw tokens from.
    //  */
    // function withdrawFromStream(uint256 streamId)
    //     public
    //     nonReentrant {
    //   _withdrawFromStream(streamId,address(0));
    // }

    // function withdrawFromStreams(uint256[] calldata streamIds)
    //     public
    //     nonReentrant {
    //   for (uint256 i = 0; i < streamIds.length; i++)
    //   {
    //     _withdrawFromStream(streamIds[i], address(0));
    //   }
    // }


    /// @dev Withdraws from the contract to the recipient's account. If the recipient is address 0, it withdraws to the holder of the stream NFT token. 
    // function withdrawFromDelegation(address implementation, uint256 delegationId, address recipient) private {
    //   // Get stream

    //   (uint256 ratePerSecond, uint256 startTime,
    //     uint256 stopTime, address sender, 
    //     bool isActive, uint256 streamAccruedSince, bool isCancellable) = subi.getStream(streamId);

    //   require(isActive, "stream not active");
    //   // Make sure stream is active and has accrued UBI
    //   if(block.timestamp < startTime || stopTime < streamAccruedSince) return;
      
    //     uint256 streamBalance = subi.balanceOfStream(streamId);

    //     // Consolidate sender balance
    //     uint256 newSupplyFrom;
    //     uint256 humanAccruedSince = accruedSince[sender];
        
    //     if (humanAccruedSince > 0 && proofOfHumanity.isRegistered(sender)) {
            
    //         newSupplyFrom = getTotalDelegatedValue(sender);
    //         uint256 receivingDelegatedValue = ubiInflow[sender].mul(block.timestamp.sub(humanAccruedSince));

    //         totalSupply = totalSupply.add(newSupplyFrom).add(receivedAccruedValue);

    //         ubiBalance[sender] = balanceOf(sender);

    //         // Update accruedSince
    //         accruedSince[sender] = block.timestamp;
    //     }        
    //     // Consolidate stream balance.
    //     address realRecipient = recipient;
    //     if(recipient == address(0)) {
    //       realRecipient = subi.ownerOf(streamId);
    //     }

    //     ubiBalance[realRecipient] = ubiBalance[realRecipient].add(streamBalance);
    //     subi.onWithdrawnFromStream(streamId);
    // }

    // function getTotalDelegatedValue(address _human) public view returns(uint256) {

    //   uint256 totalDelegatedRate;
    //   for(uint256 i = 0; i < delegatorImplementations.length; i++) {
    //       totalDelegatedRate += IUBIDelegator(delegatorImplementations[i]).getTotalDelegatedRate(_human, accruedSince[_human], block.timestamp);
    //   }
      
    //   return totalDelegatedRate;
    // }

    /**
     * @notice Stops the stream
     * @dev Throws if the id does not point to a valid stream.
     *  Throws if the caller is not the sender or the recipient of the stream.
     *  Throws if there is a token transfer failure.
     * @param delegatorImpl the adddress of the UBI Delegator contract
     * @param delegationId The id of the delegation to cancel.
     */
    function cancelDelegation(address delegatorImpl, uint256 delegationId) public nonReentrant 
    {
      require(delegators[delegatorImpl].implementsDelegator, "implementation not allowed");
      IUBIDelegator delegator = IUBIDelegator(delegatorImpl);
      // Get delegation
      (address sender, address recipient) = delegator.getDelegationNodes(delegationId);
      updateBalance(sender);
      updateBalance(recipient);
      // TODO: add permissions (allow to cancel if implementation is not active).
      delegator.cancelDelegation(delegationId);
      
      // (uint256 ratePerSecond, uint256 startTime,
      // uint256 stopTime, address sender, 
      // bool isActive, uint256 streamAccruedSince, bool isCancellable) = subi.getStream(streamId);
      // require(msg.sender == sender, "only sender can cancel stream");
      // require(isCancellable, "stream not cancellable");
      
      // // Withdraw funds from the stream and delete it
      // _withdrawFromStream(streamId, address(0));
      // if(isActive) {
      //   // Delete the stream
      //   subi.onCancelStream(streamId);
      // }
    }

    function onDelegationTransfer(address _oldOwner, address _newOwner, uint256 ratePerSecond) public onlyDelegator(msg.sender) {
      require(isAllowedImplementation[msg.sender], "delegator not allowed");
      updateBalance(_oldOwner);
      updateBalance(_newOwner);
    }

    /* Setters */
    function setSUBI(address _subi) public onlyByGovernor {
      subi = ISUBI(_subi);
    }
  /* Getters */

  /** @dev Calculates how much UBI a submission has accrued and is pending consolidation..
  *  @param _human The submission ID.
  *  @return accrued The available UBI for withdrawal.
  */
  function getAccruedValue(address _human) public view returns (uint256 accrued) {

    uint256 totalAccrued = proofOfHumanity.isRegistered(_human) && accruedSince[_human] > 0 ?
      accruedPerSecond.mul(block.timestamp.sub(accruedSince[_human])) :
      0;

    // Get the new supply from the delegations.
    for(uint256 i = 0; i < delegatorImplementations.length; i++) {
      if(!isAllowedImplementation[delegatorImplementations[i]]) continue;
      IUBIDelegator delegator = IUBIDelegator(delegatorImplementations[i]);
      totalAccrued = totalAccrued
        .sub(delegator.outgoingTotalAccruedValue(_human))
        .add(delegator.incomingTotalAccruedValue(_human));
    }

    return totalAccrued;
  }

  /// @dev Utility function to avoid error "Stack too deep"
  function getStream(uint256 streamId) private view returns (Types.Stream memory) {
    (uint256 ratePerSecond, uint256 startTime,
      uint256 stopTime, address sender, 
      bool isActive, uint256 streamAccruedSince, bool isCancellable) = subi.getStream(streamId);

      return Types.Stream({
        ratePerSecond: ratePerSecond,
        startTime: startTime,
        stopTime: stopTime,
        sender: sender,
        isActive: isActive,
        accruedSince: streamAccruedSince,
        isCancellable: isCancellable
      });
  }

  /**
  * @dev Calculates the current user accrued balance.
  * @param _human The submission ID.
  * @return The current balance including accrued Universal Basic Income of the user.
  **/
  function balanceOf(address _human) public view returns (uint256) {
    return ubiBalance[_human].add(getAccruedValue(_human));

    // if(address(subi) != address(0)) {

    //   uint256[] memory streamIdsOf = subi.getStreamsOf(_human);
    //   // Subtract pending value already consolidated
    //   for(uint256 i = 0; i < streamIdsOf.length; i++) {
    //     Types.Stream memory stream = getStream(streamIdsOf[i]);
    //     if(!stream.isActive) continue; // Stream Exists
    //     if(!proofOfHumanity.isRegistered(stream.sender)) continue; // Sender is a registered human

    //     // If stream has not started, or it has been accrued all.
    //     if(block.timestamp < stream.startTime) continue;

    //     // Time delegated to the stream
    //     uint256 streamAccumulatedTime = subi.accruedTime(streamIdsOf[i]);

    //     // // If there is accumulated time and the human accrued after the stream started, subtract delta of accrued since and startTime
    //     uint256 streamAccruingStart = Math.max(stream.startTime, stream.accruedSince);
    //     if(streamAccumulatedTime > 0 && accruedSince[_human] >= streamAccruingStart) {
    //       uint256 streamAccruingStop = Math.min(accruedSince[_human],Math.min(block.timestamp, stream.stopTime));
    //       uint256 toSubtract = streamAccruingStop.sub(streamAccruingStart);
    //       // Subtract time already accounted for
    //       streamAccumulatedTime = streamAccumulatedTime.sub(Math.min(toSubtract,streamAccumulatedTime));
    //     }   
    //     // Stream's total accrued value is the accumulated time * stream's ratePerSecond
    //     pendingDelegatedAccruedValue += streamAccumulatedTime.mul(stream.ratePerSecond);
    //   }  
        
    // }

      // Total balance is: Last balance + (accrued balance - delegated accrued balance) + received accrued balance
    
  }
    
  function getAccruedSince(address _human) public view returns (uint256) {
    return accruedSince[_human];
  }

  function getProofOfHumanity() public view returns (address) {
    return address(proofOfHumanity);
  }

  function getAccruedPerSecond() public view returns (uint256) {
    return accruedPerSecond;
  }
  

  function updateBalance(address _human) internal {
    uint256 newSupplyFrom = accruedPerSecond.mul(block.timestamp.sub(accruedSince[_human]));

    // Subtract delegated supply
    for(uint256 i = 0; i < delegatorImplementations.length; i++) {
      if(!isAllowedImplementation[delegatorImplementations[i]]) continue;
      IUBIDelegator delegator = IUBIDelegator(delegatorImplementations[i]);
      newSupplyFrom = newSupplyFrom
        .add(delegator.incomingTotalAccruedValue(_human))
        .sub(delegator.outgoingTotalAccruedValue(_human));
    }

    ubiBalance[_human] = ubiBalance[_human].add(newSupplyFrom);
    accruedSince[_human] = block.timestamp;
    // uint256 receivedAccruedValue = ubiInflow[_human].mul(block.timestamp.sub(lastTimeAccrued));
    // totalSupply = totalSupply.add(newSupplyFrom).add(receivedAccruedValue);
    // ubiBalance[_human] = ubiBalance[_human].add(newSupplyFrom).sub(pendingDelegatedAccruedValue).add(receivedAccruedValue);
  }
}
