// SPDX-License-Identifier: MIT
pragma solidity 0.7.3;

/**
 * This code contains elements of ERC20BurnableUpgradeable.sol https://github.com/OpenZeppelin/openzeppelin-contracts-upgradeable/blob/master/contracts/token/ERC20/ERC20BurnableUpgradeable.sol
 * Those have been inlined for the purpose of gas optimization.
 */

import "@openzeppelin/contracts-upgradeable/proxy/Initializable.sol";
import "@openzeppelin/contracts/math/SafeMath.sol";
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
 * @title Poster Interface
 * @dev See https://github.com/auryn-macmillan/poster
 */
interface IPoster {
  event NewPost(bytes32 id, address user, string content);

  function post(string memory content) external;
}

/**
 * @title Sablier Types
 * @author Sablier
 */
library Types {
    struct Stream {
        uint256 deposit; // This will be autocalculated based on the start and stop time
        uint256 ratePerSecond; // The rate of UBI to drip to this stream from the current accrued value
        uint256 remainingBalance;
        uint256 startTime;
        uint256 stopTime;
        address recipient;
        address sender;
        address tokenAddress;
        bool isEntity;
        uint256 accruedSince;
    }
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

  /**
     * @notice Emits when a stream is successfully created.
     */
    event CreateStream(
        uint256 indexed streamId,
        address indexed sender,
        address indexed recipient,
        uint256 deposit,
        address tokenAddress,
        uint256 startTime,
        uint256 stopTime
    );

   /**
     * @notice Emits when the recipient of a stream withdraws a portion or all their pro rata share of the stream.
     */
    event WithdrawFromStream(uint256 indexed streamId, address indexed recipient, uint256 amount);

    /**
     * @notice Emits when a stream is successfully cancelled and tokens are transferred back on a pro rata basis.
     */
    event CancelStream(
        uint256 indexed streamId,
        address indexed sender,
        address indexed recipient,
        uint256 senderBalance,
        uint256 recipientBalance
    );


  using SafeMath for uint256;

  /* Storage */

  mapping (address => uint256) private balance;

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
    totalSupply = _initialSupply;
    prevStreamId = 0;
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

    balance[msg.sender] = balance[msg.sender].add(newSupply);
    totalSupply = totalSupply.add(newSupply);
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

  /** @dev Transfers `_amount` to `_recipient` and withdraws accrued tokens.
  *  @param _recipient The entity receiving the funds.
  *  @param _amount The amount to tranfer in base units.
  */
  function transfer(address _recipient, uint256 _amount) public returns (bool) {
    uint256 newSupplyFrom;
    if (accruedSince[msg.sender] != 0 && proofOfHumanity.isRegistered(msg.sender)) {
        newSupplyFrom = accruedPerSecond.mul(block.timestamp.sub(accruedSince[msg.sender]));
        totalSupply = totalSupply.add(newSupplyFrom);
        accruedSince[msg.sender] = block.timestamp;
    }
    balance[msg.sender] = balance[msg.sender].add(newSupplyFrom).sub(_amount, "ERC20: transfer amount exceeds balance");
    balance[_recipient] = balance[_recipient].add(_amount);
    emit Transfer(msg.sender, _recipient, _amount);
    return true;
  }

  /** @dev Transfers `_amount` from `_sender` to `_recipient` and withdraws accrued tokens.
  *  @param _sender The entity to take the funds from.
  *  @param _recipient The entity receiving the funds.
  *  @param _amount The amount to tranfer in base units.
  */
  function transferFrom(address _sender, address _recipient, uint256 _amount) public returns (bool) {
    uint256 newSupplyFrom;
    allowance[_sender][msg.sender] = allowance[_sender][msg.sender].sub(_amount, "ERC20: transfer amount exceeds allowance");
    if (accruedSince[_sender] != 0 && proofOfHumanity.isRegistered(_sender)) {
        newSupplyFrom = accruedPerSecond.mul(block.timestamp.sub(accruedSince[_sender]));
        totalSupply = totalSupply.add(newSupplyFrom);
        accruedSince[_sender] = block.timestamp;
    }
    balance[_sender] = balance[_sender].add(newSupplyFrom).sub(_amount, "ERC20: transfer amount exceeds balance");
    balance[_recipient] = balance[_recipient].add(_amount);
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
    uint256 newSupplyFrom;
    if(accruedSince[msg.sender] != 0 && proofOfHumanity.isRegistered(msg.sender)) {
      newSupplyFrom = accruedPerSecond.mul(block.timestamp.sub(accruedSince[msg.sender]));
      accruedSince[msg.sender] = block.timestamp;
    }
    balance[msg.sender] = balance[msg.sender].add(newSupplyFrom).sub(_amount, "ERC20: burn amount exceeds balance");
    totalSupply = totalSupply.add(newSupplyFrom).sub(_amount);
    emit Transfer(msg.sender, address(0), _amount);
  }

  /** @dev Burns `_amount` of tokens and posts content in a Poser contract.
  *  @param _amount The quantity of tokens to burn in base units.
  *  @param _poster the address of the poster contract.
  *  @param content bit of strings to signal.
  */
  function burnAndPost(uint256 _amount, address _poster, string memory content) public {
    burn(_amount);
    IPoster poster = IPoster(_poster);
    poster.post(content);
  }

  /** @dev Burns `_amount` of tokens from `_account` and withdraws accrued tokens.
  *  @param _account The entity to burn tokens from.
  *  @param _amount The quantity of tokens to burn in base units.
  */
  function burnFrom(address _account, uint256 _amount) public {
    uint256 newSupplyFrom;
    allowance[_account][msg.sender] = allowance[_account][msg.sender].sub(_amount, "ERC20: burn amount exceeds allowance");
    if (accruedSince[_account] != 0 && proofOfHumanity.isRegistered(_account)) {
        newSupplyFrom = accruedPerSecond.mul(block.timestamp.sub(accruedSince[_account]));
        accruedSince[_account] = block.timestamp;
    }
    balance[_account] = balance[_account].add(newSupplyFrom).sub(_amount, "ERC20: burn amount exceeds balance");
    totalSupply = totalSupply.add(newSupplyFrom).sub(_amount);
    emit Transfer(_account, address(0), _amount);
  }

  /* Getters */

  /** @dev Calculates how much UBI a submission has available for withdrawal.
  *  @param _human The submission ID.
  *  @return accrued The available UBI for withdrawal.
  */
  function getAccruedValue(address _human) public view returns (uint256 accrued) {
    // If this human have not started to accrue, or is not registered, return 0.
    if (accruedSince[_human] == 0 || !proofOfHumanity.isRegistered(_human)) return 0;

    else return accruedPerSecond.mul(block.timestamp.sub(accruedSince[_human]));
  }

  /**
  * @dev Calculates the current user accrued balance.
  * @param _human The submission ID.
  * @return The current balance including accrued Universal Basic Income of the user.
  **/
  function balanceOf(address _human) public view returns (uint256) {
    uint256 delegatedBalance;
    for(uint256 i = 0; i < streamIdsOf[_human].length; i++) {
      uint256 streamId = streamIdsOf[_human][i];
      Types.Stream memory stream = streams[streamId];
      delegatedBalance = balanceOf(streamId, stream.recipient);
    }

    return getAccruedValue(_human).add(balance[_human]).sub(delegatedBalance);
  }

  /**
   * EIP-1620 (from sablier)
   */
   /*** Storage Properties ***/

    /**
     * @dev Counter for new stream ids. Stores the last used stream id.
	 * @notice 0 is an invalid stream. it's used to check for empty streams on `streamIds` mapping
     */
    uint256 public prevStreamId;

    /**
     * @dev The stream objects identifiable by their unsigned integer ids.
     */
    mapping(uint256 => Types.Stream) private streams;

	/// @dev Get the streamId from human and recipient addresses.
  	mapping (address => mapping(address => uint256)) public streamIds;

			
	/// @dev A mapping containing UNORDERED lists of the stream ids of each sender.
	/// @notice This does not guarantee to contain valid streams (may have ended).
	mapping (address => uint256[]) public streamIdsOf;


    /*** Modifiers ***/

    /**
     * @dev Throws if the caller is not the sender or the recipient of the stream.
     */
    modifier onlySenderOrRecipient(uint256 streamId) {
        require(
            msg.sender == streams[streamId].sender || msg.sender == streams[streamId].recipient,
            "caller is not the sender or the recipient of the stream"
        );
        _;
    }

    /**
     * @dev Throws if the provided id does not point to a valid stream.
     */
    modifier streamExists(uint256 streamId) {
        require(streams[streamId].isEntity, "stream does not exist");
        _;
    }

    /*** Contract Logic Starts Here */

    /*** View Functions ***/

    /**
     * @notice Returns the stream with all its properties.
     * @dev Throws if the id does not point to a valid stream.
     * @param streamId The id of the stream to query.
     */
    function getStream(uint256 streamId)
        external
        view
        streamExists(streamId)
        returns (
            address sender,
            address recipient,
            uint256 deposit,
            address tokenAddress,
            uint256 startTime,
            uint256 stopTime,
            uint256 remainingBalance,
            uint256 ratePerSecond
        )
    {
        sender = streams[streamId].sender;
        recipient = streams[streamId].recipient;
        deposit = streams[streamId].deposit;
        tokenAddress = streams[streamId].tokenAddress;
        startTime = streams[streamId].startTime;
        stopTime = streams[streamId].stopTime;
        remainingBalance = streams[streamId].remainingBalance;
        ratePerSecond = streams[streamId].ratePerSecond;
    }

    /**
     * @notice Returns either the delta in seconds between `block.timestamp` and `startTime` or
     *  between `stopTime` and `startTime, whichever is smaller. If `block.timestamp` is before
     *  `startTime`, it returns 0.
     * @dev Throws if the id does not point to a valid stream.
     * @param streamId The id of the stream for which to query the delta.
     */
    function deltaOf(uint256 streamId) public view streamExists(streamId) returns (uint256 delta) {
        Types.Stream memory stream = streams[streamId];
        if (block.timestamp <= stream.startTime) return 0;
        if (block.timestamp < stream.stopTime) return block.timestamp - stream.startTime;
        return stream.stopTime - stream.startTime;
    }

    struct BalanceOfLocalVars {
        uint256 recipientBalance;
        uint256 withdrawalAmount;
        uint256 senderBalance;
    }

    /**
     * @notice Returns the available funds for the given stream id and address.
     * @dev Throws if the id does not point to a valid stream.
     * @param streamId The id of the stream for which to query the balance.
     * @param who The address for which to query the balance.
     */
    function balanceOf(uint256 streamId, address who) public view streamExists(streamId) returns (uint256) {
        Types.Stream memory stream = streams[streamId];
        BalanceOfLocalVars memory vars;

        if(!proofOfHumanity.isRegistered(stream.sender)) return 0;

        // Time accumulated by the stream
        uint256 streamAccumulatedTime = deltaOf(streamId);
        if(stream.accruedSince > 0) {
          streamAccumulatedTime = streamAccumulatedTime.sub(block.timestamp.sub(stream.accruedSince));
        }

        // Stream accumulated balance. This is not the real balcne of the stream but the amount that should have been accrued since the stream started.
        uint256 streamAccruedValue = streamAccumulatedTime.mul(stream.ratePerSecond);  
        
        // Real remaining balance on the stream
        uint256 realTimeRemainingBalance = stream.remainingBalance.add(streamAccruedValue);
        
        /*
         * If the stream `balance` does not equal `deposit`, it means there have been withdrawals.
         * We have to subtract the total amount withdrawn from the amount of money that has been
         * streamed until now.
         */
		    

        assert(realTimeRemainingBalance <= streamAccruedValue);

        if (who == stream.recipient) return realTimeRemainingBalance;
        if (who == stream.sender) {
            vars.senderBalance = stream.deposit - realTimeRemainingBalance;
            return vars.senderBalance;
        }
        return 0;
    }

    /*** Public Effects & Interactions Functions ***/

    struct CreateStreamLocalVars {
        uint256 duration;
        uint256 ubiPerSecond;
    }

    /**
     * @notice Creates a new stream funded by `msg.sender` and paid towards `recipient`.
     * @dev Throws if the recipient is the zero address, the contract itself or the caller.
     *  Throws if the deposit is 0.
     *  Throws if the start time is before `block.timestamp`.
     *  Throws if the stop time is before the start time.
     *  Throws if the duration calculation has a math error.
     *  Throws if the deposit is smaller than the duration.
     *  Throws if the deposit is not a multiple of the duration.
     *  Throws if the rate calculation has a math error.
     *  Throws if the next stream id calculation has a math error.
     *  Throws if the contract is not allowed to transfer enough tokens.
     *  Throws if there is a token transfer failure.
     * @param recipient The address towards which the money is streamed.
     * @param ubiPerSecond The amount of UBI to be streamed every second. MUST be <= accruedPerSecond
     * @param tokenAddress The ERC20 token to use as streaming currency.
     * @param startTime The unix timestamp for when the stream starts.
     * @param stopTime The unix timestamp for when the stream stops.
     * @return The uint256 id of the newly created stream.
     */
    function createStream(address recipient, uint256 ubiPerSecond, address tokenAddress, uint256 startTime, uint256 stopTime)
        public
        returns (uint256)
    {
        require(recipient != address(0x00), "stream to the zero address");
        require(recipient != address(this), "stream to the contract itself");
        require(recipient != msg.sender, "stream to the caller");
        require(tokenAddress == address(this),"token address can only be UBI");
        require(ubiPerSecond > 0, "UBI per second is zero");
        require(startTime >= block.timestamp, "start time before block.timestamp");
        require(stopTime > startTime, "stop time before the start time");
        require(ubiPerSecond <= accruedPerSecond, "Cannot delegate a value higher than accruedPerSecond");
		uint256 existingStreamId = streamIds[msg.sender][recipient];
     	require(existingStreamId == 0 || streams[existingStreamId].stopTime <= block.timestamp, "Account is already a recipient on an active stream.");
		
        CreateStreamLocalVars memory vars;
        vars.duration = stopTime.sub(startTime);

        /* Create and store the stream object. */
        uint256 newStreamId = prevStreamId.add(1);
		// Create the stream
        streams[newStreamId] = Types.Stream({
			// Total deposit is calculated from duration and ubiPerSecond
            deposit: accruedPerSecond.mul(vars.duration).mul(ubiPerSecond.div(accruedPerSecond)),
            ratePerSecond: ubiPerSecond, // how many UBI to delegate per second.
            remainingBalance: 0, // Starts with 0. Accumulates as time passes.
            isEntity: true,
            recipient: recipient,
            sender: msg.sender,
            startTime: startTime,
            stopTime: stopTime,
            tokenAddress: tokenAddress,
            accruedSince: 0
        });

		streamIds[msg.sender][recipient] = newStreamId;

		// Clear previous streamId if existed
		if(existingStreamId > 0) {
			// This looks for the element that contains the existingStreamId
			// and replaces the newStreamId. This makes the list's order unreliable.
			for(uint256 i = 0; i < streamIdsOf[msg.sender].length; i++) {
				
				// If it's existing stream id, demove it from the array and replace it with the new
				if(streamIdsOf[msg.sender][i] == existingStreamId) {
					streamIdsOf[msg.sender][i] = newStreamId;
					break;
				} 
			}
		} else {
			// If id didn't exist, just add it.
			streamIdsOf[msg.sender].push(newStreamId);
		}

        /* Increment the next stream id. */
        prevStreamId = newStreamId;

        emit CreateStream(newStreamId, msg.sender, recipient, ubiPerSecond, tokenAddress, startTime, stopTime);
        return newStreamId;
    }

    /**
     * @notice Withdraws from the contract to the recipient's account.
     * @dev Throws if the id does not point to a valid stream.
     *  Throws if the caller is not the sender or the recipient of the stream.
     *  Throws if the amount exceeds the available balance.
     *  Throws if there is a token transfer failure.
     * @param streamId The id of the stream to withdraw tokens from.
     * @param amount The amount of tokens to withdraw.
     */
    function withdrawFromStream(uint256 streamId, uint256 amount)
        external
        streamExists(streamId)
        onlySenderOrRecipient(streamId)
        returns (bool)
    {
        require(amount > 0, "amount is zero");
        Types.Stream memory stream = streams[streamId];

        uint256 recipientBalance = balanceOf(streamId, stream.recipient);
        require(recipientBalance >= amount, "amount exceeds the available balance");

        streams[streamId].remainingBalance = stream.remainingBalance.sub(amount);

        if (streams[streamId].remainingBalance == 0) delete streams[streamId];

        transfer(stream.recipient, amount);
        emit WithdrawFromStream(streamId, stream.recipient, amount);
        return true;
    }

    /**
     * @notice Cancels the stream and transfers the tokens back on a pro rata basis.
     * @dev Throws if the id does not point to a valid stream.
     *  Throws if the caller is not the sender or the recipient of the stream.
     *  Throws if there is a token transfer failure.
     * @param streamId The id of the stream to cancel.
     * @return bool true=success, otherwise false.
     */
    function cancelStream(uint256 streamId)
        external
        streamExists(streamId)
        onlySenderOrRecipient(streamId)
        returns (bool)
    {
        Types.Stream memory stream = streams[streamId];
        uint256 senderBalance = balanceOf(streamId, stream.sender);
        uint256 recipientBalance = balanceOf(streamId, stream.recipient);

        delete streams[streamId];

        if (recipientBalance > 0) transfer(stream.recipient, recipientBalance);
        if (senderBalance > 0) transfer(stream.sender, senderBalance);

        emit CancelStream(streamId, stream.sender, stream.recipient, senderBalance, recipientBalance);
        return true;
    }

    function getAccruedPerSecond() public view returns (uint256) {
      return accruedPerSecond;
    }
}
